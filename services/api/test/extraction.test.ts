import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { nameSimilarity, stripAccents } from '@coroc/core';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { ReceiptExtractor, type ExtractionOutcome } from '../src/intake/extractor.js';
import { imageSoftware, ReceiptReader } from '../src/intake/reader.js';
import { dataset, render, type Sample } from './receipts/dataset.js';

const hasTesseract = (() => {
  try {
    execFileSync(process.env.COROC_TESSERACT_PATH || 'tesseract', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
// En CI el OCR es obligatorio; en un equipo sin Tesseract la prueba se omite con aviso.
const run = hasTesseract || process.env.COROC_REQUIRE_OCR ? describe : describe.skip;

const config = {
  ocr: { provider: 'tesseract', tesseract: process.env.COROC_TESSERACT_PATH || 'tesseract', pdftoppm: process.env.COROC_PDFTOPPM_PATH || 'pdftoppm', langs: 'spa+por+eng', maxPages: 3 },
  extraction: { provider: 'rules', model: 'claude-opus-5', apiKey: null, timeoutMs: 1000 },
} as unknown as AppConfig;

const norm = (s: string | null | undefined) => stripAccents(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const THRESHOLD = 0.95;

interface Row { s: Sample; ex: ExtractionOutcome; ms: number; method: string }

run('CA-19: lectura sobre el conjunto de comprobantes (§13.3)', () => {
  const samples = dataset();
  const rows: Row[] = [];

  beforeAll(async () => {
    const files = await render(samples, process.env.COROC_CHROMIUM_PATH);
    const reader = new ReceiptReader(config);
    const extractor = new ReceiptExtractor(config);
    // Cuatro lecturas a la vez: Tesseract usa un núcleo por proceso.
    const queue = [...samples];
    await Promise.all(Array.from({ length: 4 }, async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        const f = files.get(s.id)!;
        const t0 = Date.now();
        const reading = await reader.read(f.body, f.mime);
        const ex = await extractor.extract({ reading, body: f.body, mime: f.mime, receivedOn: '2026-10-09', defaultCurrency: s.truth.currency });
        rows.push({ s, ex, ms: Date.now() - t0, method: reading.method });
      }
    }));
    rows.sort((a, b) => a.s.id.localeCompare(b.s.id));
    if (process.env.COROC_CA19_REPORT) {
      const out = rows.map((r) => ({ id: r.s.id, method: r.method, ms: r.ms, truth: r.s.truth, got: { amount: r.ex.fields.amount, date: r.ex.fields.date, payer: r.ex.fields.payerName, receiver: r.ex.fields.receiverName, reference: r.ex.fields.reference } }));
      fs.writeFileSync(path.resolve(process.env.COROC_CA19_REPORT), JSON.stringify(out, null, 2));
    }
  }, 600_000);

  it('el conjunto cubre los formatos exigidos y tiene 40 o más comprobantes', () => {
    expect(samples.length).toBeGreaterThanOrEqual(40);
    const formats = new Set(samples.map((s) => s.format));
    for (const f of ['Nequi', 'Daviplata', 'Bancolombia', 'Bancolombia QR', 'Bre-B', 'Davivienda', 'BBVA', 'Banco de Bogotá', 'PSE', 'Efecty', 'Corresponsal', 'Consignación', 'PIX', 'TED', 'Zelle', 'Venmo', 'Cash App']) {
      expect(formats.has(f), f).toBe(true);
    }
    expect(samples.filter((s) => s.variant === 'photo').length).toBeGreaterThanOrEqual(3);
    expect(rows.filter((r) => r.method === 'ocr').length).toBeGreaterThan(20);
    expect(rows.filter((r) => r.method === 'text').length).toBeGreaterThan(15);
  });

  it('valor ≥ 98 % exacto, fecha ≥ 97 % y nombres ≥ 95 %', () => {
    const rate = (ok: number, n: number) => ok / n;
    const amountOk = rows.filter((r) => r.ex.fields.amount.value === r.s.truth.amount);
    const dateOk = rows.filter((r) => r.ex.fields.date.value === r.s.truth.date);
    const names = rows.flatMap((r) => [
      { ok: norm(r.ex.fields.receiverName.value) === norm(r.s.truth.receiver), id: `${r.s.id}:receptor` },
      ...(r.s.truth.payer ? [{ ok: norm(r.ex.fields.payerName.value) === norm(r.s.truth.payer), id: `${r.s.id}:pagador` }] : []),
    ]);
    const misses = [
      ...rows.filter((r) => r.ex.fields.amount.value !== r.s.truth.amount).map((r) => `${r.s.id} valor ${r.ex.fields.amount.value} ≠ ${r.s.truth.amount}`),
      ...rows.filter((r) => r.ex.fields.date.value !== r.s.truth.date).map((r) => `${r.s.id} fecha ${r.ex.fields.date.value} ≠ ${r.s.truth.date}`),
      ...names.filter((n) => !n.ok).map((n) => n.id),
    ];
    const summary = { valor: rate(amountOk.length, rows.length), fecha: rate(dateOk.length, rows.length), nombres: rate(names.filter((n) => n.ok).length, names.length) };
    console.info(`CA-19 · ${rows.length} comprobantes · valor ${(summary.valor * 100).toFixed(1)} % · fecha ${(summary.fecha * 100).toFixed(1)} % · nombres ${(summary.nombres * 100).toFixed(1)} %${misses.length ? `\n  ${misses.join('\n  ')}` : ''}`);
    expect(summary.valor).toBeGreaterThanOrEqual(0.98);
    expect(summary.fecha).toBeGreaterThanOrEqual(0.97);
    expect(summary.nombres).toBeGreaterThanOrEqual(0.95);
  });

  it('lo que no alcanza el umbral nunca se aplica solo: ningún campo errado llega con confianza ≥ 0,95', () => {
    const unsafe: string[] = [];
    for (const r of rows) {
      const f = r.ex.fields;
      if (f.amount.value !== r.s.truth.amount && f.amount.confidence >= THRESHOLD) unsafe.push(`${r.s.id} valor`);
      if (f.date.value !== r.s.truth.date && f.date.confidence >= THRESHOLD) unsafe.push(`${r.s.id} fecha`);
      if (f.receiverName.value && nameSimilarity(f.receiverName.value, r.s.truth.receiver) < 0.85 && f.receiverName.confidence >= THRESHOLD) unsafe.push(`${r.s.id} receptor`);
    }
    expect(unsafe).toEqual([]);
  });

  it('regiones para resaltar: el valor y la fecha se ubican sobre la imagen', () => {
    const located = rows.filter((r) => r.ex.fields.amount.value === r.s.truth.amount && r.ex.regions.amount);
    expect(located.length / rows.length).toBeGreaterThanOrEqual(0.9);
    for (const r of located) {
      const g = r.ex.regions.amount!;
      expect(g.x).toBeGreaterThanOrEqual(0);
      expect(g.x + g.w).toBeLessThanOrEqual(1.01);
      expect(g.h).toBeGreaterThan(0);
    }
  });
});

describe('Señales de alteración (§13.4)', () => {
  it('detecta el software de edición en los metadatos de una imagen PNG', () => {
    const chunk = (type: string, data: Buffer) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
    };
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('tEXt', Buffer.from('Software\0Adobe Photoshop 25.0', 'latin1')), chunk('IEND', Buffer.alloc(0))]);
    expect(imageSoftware(png)).toBe('Adobe Photoshop 25.0');
  });
});
