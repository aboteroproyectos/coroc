import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { CONFIG, type AppConfig } from '../config.js';

/** Palabra leída con su caja, en fracciones de la página (0–1) para resaltarla sobre la imagen (§13.6). */
export interface Word {
  text: string;
  line: number;
  x: number;
  y: number;
  w: number;
  h: number;
  conf: number;
}

export interface Page {
  words: Word[];
}

export interface Reading {
  method: 'text' | 'ocr' | 'none';
  text: string;
  pages: Page[];
  /** Confianza media del OCR (0–1); 1 para la capa de texto del PDF. */
  confidence: number;
  /** Señales de posible alteración (§13.4): nunca permiten la aplicación automática. */
  tamperSignals: string[];
  error?: string;
}

const EDITORS = /photoshop|gimp|illustrator|canva|picsart|snapseed|lightroom|pixlr|affinity|paint\.net|inkscape|pdfescape|sejda|smallpdf|ilovepdf|pdffiller|foxit phantom|nitro pro|pdf-xchange editor|acrobat pro|infix/i;
const PDF_MIN_TEXT = 40;

/** Ejecuta un programa con la entrada dada y devuelve la salida estándar; falla con el error del programa. */
function run(cmd: string, args: string[], input: Buffer | null, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Un hilo por proceso: con varias lecturas a la vez, los hilos de OpenMP de Tesseract compiten y se bloquean.
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, OMP_THREAD_LIMIT: '1' } });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (d: Buffer) => out.push(d));
    p.stderr.on('data', (d: Buffer) => err.push(d));
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${path.basename(cmd)} ${signal ?? code}: ${Buffer.concat(err).toString().trim().slice(0, 300)}`));
    });
    p.stdin.on('error', () => undefined);
    p.stdin.end(input ?? undefined);
  });
}

/** Salida TSV de Tesseract → palabras con caja y líneas. */
export function parseTsv(tsv: string): Page {
  let width = 1;
  let height = 1;
  const words: Word[] = [];
  const lineIds = new Map<string, number>();
  for (const row of tsv.split('\n').slice(1)) {
    const c = row.split('\t');
    if (c.length < 12) continue;
    const [level, , block, par, line, , left, top, w, h, conf] = c.map((x, i) => (i < 11 ? Number(x) : 0)) as number[];
    if (level === 1) {
      width = w! || 1;
      height = h! || 1;
      continue;
    }
    if (level !== 5) continue;
    const text = c[11]!.trim();
    if (!text) continue;
    const key = `${block}.${par}.${line}`;
    if (!lineIds.has(key)) lineIds.set(key, lineIds.size);
    words.push({ text, line: lineIds.get(key)!, x: left! / width, y: top! / height, w: w! / width, h: h! / height, conf: Math.max(0, conf!) / 100 });
  }
  return { words };
}

const pageText = (p: Page) => {
  const lines: string[][] = [];
  for (const w of p.words) (lines[w.line] ??= []).push(w.text);
  return lines.filter(Boolean).map((l) => l.join(' ')).join('\n');
};

/** Metadatos de edición en JPEG (EXIF «Software») y PNG (texto «Software»). */
export function imageSoftware(b: Buffer): string | null {
  if (b[0] === 0x89 && b[1] === 0x50) {
    let i = 8;
    while (i + 8 < b.length) {
      const len = b.readUInt32BE(i);
      const type = b.subarray(i + 4, i + 8).toString('latin1');
      if (type === 'tEXt' || type === 'iTXt') {
        const data = b.subarray(i + 8, i + 8 + len).toString('latin1');
        const [k, ...v] = data.split('\0');
        if (/software|creator/i.test(k ?? '')) return v.join(' ').replace(/\0/g, ' ').trim();
      }
      if (type === 'IEND') break;
      i += 12 + len;
    }
    return null;
  }
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const marker = b[i + 1]!;
    const len = b.readUInt16BE(i + 2);
    if (marker === 0xe1 && b.subarray(i + 4, i + 10).toString('latin1') === 'Exif\0\0') {
      const t = i + 10;
      const le = b.subarray(t, t + 2).toString('latin1') === 'II';
      const u16 = (o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
      const u32 = (o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
      const ifd = t + u32(t + 4);
      const n = u16(ifd);
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (u16(e) === 0x0131) {
          const count = u32(e + 4);
          const off = count > 4 ? t + u32(e + 8) : e + 8;
          return b.subarray(off, off + count).toString('latin1').replace(/\0/g, '').trim();
        }
      }
      return null;
    }
    if (marker === 0xda) break;
    i += 2 + len;
  }
  return null;
}

/**
 * Lectura del comprobante (§13.2): la capa de texto del PDF si la tiene; si no (imagen o PDF escaneado), OCR con
 * Tesseract, con detección de orientación. El texto completo se guarda para la búsqueda del repositorio.
 */
@Injectable()
export class ReceiptReader {
  private readonly log = new Logger('Lectura');
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  async read(body: Buffer, mime: string): Promise<Reading> {
    try {
      if (mime === 'application/pdf') return await this.pdf(body);
      if (mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp') {
        const soft = imageSoftware(body);
        const r = await this.ocrImage(body);
        return { ...r, tamperSignals: soft && EDITORS.test(soft) ? [`software:${soft}`] : [] };
      }
      return { method: 'none', text: '', pages: [], confidence: 0, tamperSignals: [], error: 'UNSUPPORTED_FORMAT' };
    } catch (e) {
      this.log.warn(`No se pudo leer el archivo: ${(e as Error).message}`);
      return { method: 'none', text: '', pages: [], confidence: 0, tamperSignals: [], error: (e as Error).message.slice(0, 300) };
    }
  }

  private async pdf(body: Buffer): Promise<Reading> {
    const task = getDocument({ data: new Uint8Array(body), useSystemFonts: false });
    const doc = await task.promise;
    const signals: string[] = [];
    try {
      const meta = (await doc.getMetadata()).info as Record<string, any>;
      const tool = `${meta?.Producer ?? ''} ${meta?.Creator ?? ''}`.trim();
      if (EDITORS.test(tool)) signals.push(`software:${tool}`);
      const created = pdfDate(meta?.CreationDate);
      const modified = pdfDate(meta?.ModDate);
      if (created && modified && modified.getTime() - created.getTime() > 10 * 60_000) signals.push('modified_after_creation');
      const pages: Page[] = [];
      for (let n = 1; n <= Math.min(doc.numPages, this.config.ocr.maxPages); n++) {
        const page = await doc.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const items = content.items.filter((x): x is Extract<typeof x, { str: string }> => 'str' in x && x.str.trim() !== '');
        // Agrupa por renglón: misma altura (con tolerancia), de arriba abajo y de izquierda a derecha.
        const rows: { y: number; items: typeof items }[] = [];
        for (const it of items) {
          const y = it.transform[5]!;
          const row = rows.find((r) => Math.abs(r.y - y) < Math.max(2, Math.abs(it.transform[3]!) * 0.5));
          if (row) row.items.push(it);
          else rows.push({ y, items: [it] });
        }
        rows.sort((a, b) => b.y - a.y);
        const words: Word[] = [];
        rows.forEach((r, line) => {
          r.items.sort((a, b) => a.transform[4]! - b.transform[4]!);
          for (const it of r.items) {
            const h = Math.abs(it.transform[3]!) || 10;
            words.push({ text: it.str.trim(), line, x: it.transform[4]! / vp.width, y: (vp.height - it.transform[5]! - h) / vp.height, w: it.width / vp.width, h: h / vp.height, conf: 1 });
          }
        });
        pages.push({ words });
      }
      const text = pages.map(pageText).join('\n');
      if (text.replace(/\s/g, '').length >= PDF_MIN_TEXT) return { method: 'text', text, pages, confidence: 1, tamperSignals: signals };
    } finally {
      await task.destroy();
    }
    // PDF escaneado: se convierte cada página en imagen y se lee con OCR.
    const r = await this.ocrScannedPdf(body);
    return { ...r, tamperSignals: signals };
  }

  private async ocrImage(body: Buffer): Promise<Reading> {
    if (this.config.ocr.provider === 'none') return { method: 'none', text: '', pages: [], confidence: 0, tamperSignals: [], error: 'OCR_DISABLED' };
    const page = await this.tesseract(body);
    const words = page.words;
    return { method: 'ocr', text: pageText(page), pages: [page], confidence: words.length ? words.reduce((s, w) => s + w.conf, 0) / words.length : 0, tamperSignals: [] };
  }

  private async ocrScannedPdf(body: Buffer): Promise<Reading> {
    if (this.config.ocr.provider === 'none') return { method: 'none', text: '', pages: [], confidence: 0, tamperSignals: [], error: 'OCR_DISABLED' };
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coroc-ocr-'));
    try {
      const src = path.join(dir, 'in.pdf');
      await fs.writeFile(src, body);
      await run(this.config.ocr.pdftoppm, ['-r', '200', '-png', '-f', '1', '-l', String(this.config.ocr.maxPages), src, path.join(dir, 'p')], null, 60_000);
      const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.png')).sort();
      const pages: Page[] = [];
      for (const f of files) pages.push(await this.tesseract(await fs.readFile(path.join(dir, f))));
      const words = pages.flatMap((p) => p.words);
      return { method: 'ocr', text: pages.map(pageText).join('\n'), pages, confidence: words.length ? words.reduce((s, w) => s + w.conf, 0) / words.length : 0, tamperSignals: [] };
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  private async tesseract(image: Buffer): Promise<Page> {
    // --psm 1: segmentación automática con detección de orientación (fotos giradas de consignaciones en papel).
    const out = await run(this.config.ocr.tesseract, ['stdin', 'stdout', '-l', this.config.ocr.langs, '--psm', '1', 'tsv'], image, 90_000);
    return parseTsv(out.toString('utf8'));
  }
}

function pdfDate(s: unknown): Date | null {
  const m = /^D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(String(s ?? ''));
  if (!m) return null;
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)));
}
