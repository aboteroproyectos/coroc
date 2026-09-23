import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Texto de un PDF (todas las páginas), para verificar lo que el documento dice de verdad. */
export async function pdfText(buf: Buffer | Uint8Array): Promise<{ text: string; pages: number }> {
  const task = getDocument({ data: new Uint8Array(buf), useSystemFonts: false });
  const doc = await task.promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    text += `${c.items.map((x) => ('str' in x ? x.str : '')).join(' ')}\n`;
  }
  const pages = doc.numPages;
  await task.destroy();
  return { text: text.replace(/ | /g, ' ').replace(/\s+/g, ' '), pages };
}
