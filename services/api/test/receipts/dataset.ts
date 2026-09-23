// Conjunto sintético de comprobantes para CA-19 (§13.3): 18 formatos de Colombia, Brasil y EE. UU., cada uno como
// captura de pantalla (PNG), como PDF con capa de texto y, en algunos, como foto de papel (girada, con ruido y sombra).
// Imitan la estructura y los rótulos de los comprobantes reales, con datos inventados. No reemplazan el conjunto de
// 40 o más comprobantes reales anonimizados que pide la especificación (pregunta P-3): sirven para medir el lector y
// para que la CI detecte regresiones.
import { chromium, type Browser } from 'playwright-core';

export type Currency = 'COP' | 'BRL' | 'USD';
export type Variant = 'png' | 'pdf' | 'photo';

export interface Truth {
  amount: number; // unidades mínimas
  currency: Currency;
  date: string; // AAAA-MM-DD
  payer: string | null; // nombre impreso (null si el formato no lo imprime)
  receiver: string;
  reference: string | null;
}

export interface Sample {
  id: string;
  format: string;
  country: 'CO' | 'BR' | 'US';
  variant: Variant;
  html: string;
  truth: Truth;
}

const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parts = (d: string) => d.split('-').map(Number) as [number, number, number];
const dmy = (d: string) => {
  const [y, m, dd] = parts(d);
  return `${String(dd).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
};
const cop = (minor: number) => `$ ${minor.toLocaleString('es-CO').replace(/,/g, '.')}`;
const copCents = (minor: number) => `${cop(minor)},00`;
const brl = (minor: number) => `R$ ${(minor / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
const usd = (minor: number) => `$${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

const RECEIVER: Record<'CO' | 'BR' | 'US', string> = { CO: 'Inversiones Coroc SAS', BR: 'Coroc Participacoes Ltda', US: 'Coroc Lending LLC' };

/** Tarjeta de comprobante: encabezado de color de la entidad y filas rótulo/valor. */
function card(o: { brand: string; color: string; ink?: string; title: string; rows: [string, string][]; width?: number; font?: string; note?: string }): string {
  const rows = o.rows.map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join('');
  return `<html><head><meta charset="utf-8"><style>
body{margin:0;background:#fff;font-family:${o.font ?? 'Arial, Helvetica, sans-serif'};color:#1f1f1f;width:${o.width ?? 440}px}
.h{background:${o.color};color:${o.ink ?? '#fff'};padding:18px 22px;font-weight:700;font-size:24px}
.b{padding:20px 24px}.t{font-size:21px;font-weight:700;margin-bottom:16px}.k{font-size:15px;color:#555;margin-top:12px}.v{font-size:19px;font-weight:600}
.n{font-size:13px;color:#777;margin-top:18px}</style></head><body><div class="h">${o.brand}</div><div class="b"><div class="t">${o.title}</div>${rows}${o.note ? `<div class="n">${o.note}</div>` : ''}</div></body></html>`;
}

/** Comprobante de papel (consignación) para fotografiar. */
function paper(o: { bank: string; rows: [string, string][]; title: string }): string {
  const rows = o.rows.map(([k, v]) => `<tr><td class="k">${k}</td><td class="v">${v}</td></tr>`).join('');
  return `<html><head><meta charset="utf-8"><style>
body{margin:0;background:#8d8a82;width:560px;height:620px;display:flex;align-items:center;justify-content:center}
.p{background:#f4f1e6;width:470px;padding:24px 26px;transform:rotate(-1.6deg);box-shadow:6px 8px 14px rgba(0,0,0,.35);font-family:'Courier New',monospace;color:#222;
background-image:radial-gradient(rgba(0,0,0,.05) 1px,transparent 1px);background-size:5px 5px;filter:contrast(.92) blur(.35px)}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:0 0 14px;font-weight:400}td{padding:6px 4px;font-size:16px;vertical-align:top;white-space:nowrap}.k{color:#444;width:40%}.v{font-weight:700}
</style></head><body><div class="p"><h1>${o.bank}</h1><h2>${o.title}</h2><table>${rows}</table></div></body></html>`;
}

type Maker = (t: Truth, time: string) => string;

const FORMATS: { name: string; country: 'CO' | 'BR' | 'US'; photo?: boolean; make: Maker }[] = [
  {
    name: 'Nequi', country: 'CO',
    make: (t, time) => { const [y, m, d] = parts(t.date); return card({ brand: 'Nequi', color: '#200020', title: '¡Listo! Enviaste plata', rows: [['Para', t.receiver], ['De', t.payer!], ['¿Cuánto?', copCents(t.amount)], ['Fecha', `${d} de ${MONTHS_ES[m - 1]} de ${y} a las ${time}`], ['Referencia', t.reference!]] }); },
  },
  {
    name: 'Daviplata', country: 'CO',
    make: (t, time) => card({ brand: 'DaviPlata', color: '#ED1C27', title: 'Pasaste plata', rows: [['Destinatario', t.receiver], ['Remitente', t.payer!], ['Valor', cop(t.amount)], ['Fecha', `${dmy(t.date)} ${time}`], ['Número de aprobación', t.reference!]] }),
  },
  {
    name: 'Bancolombia', country: 'CO',
    make: (t, time) => { const [y, m, d] = parts(t.date); return card({ brand: 'Bancolombia', color: '#FDDA24', ink: '#2C2A29', title: '¡Transferencia exitosa!', rows: [['Comprobante No.', t.reference!], ['Fecha', `${d} ${MES[m - 1]} ${y} - ${time}`], ['Valor enviado', copCents(t.amount)], ['Producto destino', 'Ahorros *4455'], ['Nombre del destinatario', t.receiver], ['Nombre del pagador', t.payer!], ['Costo de la transacción', '$ 0']] }); },
  },
  {
    name: 'Bancolombia QR', country: 'CO',
    make: (t, time) => card({ brand: 'Bancolombia', color: '#FDDA24', ink: '#2C2A29', title: 'Pago con código QR', rows: [['Valor pagado', cop(t.amount)], ['Beneficiario', t.receiver], ['Pagado por', t.payer!], ['Fecha y hora', `${dmy(t.date)} ${time}`], ['Referencia', t.reference!]] }),
  },
  {
    name: 'Bre-B', country: 'CO',
    make: (t, time) => card({ brand: 'Bre-B', color: '#0B3D91', title: 'Transferencia inmediata', rows: [['Llave destino', '@coroc'], ['Para', t.receiver], ['De', t.payer!], ['Monto', cop(t.amount)], ['Fecha', `${dmy(t.date)} ${time}`], ['Código de transacción', t.reference!]] }),
  },
  {
    name: 'Davivienda', country: 'CO',
    make: (t, time) => card({ brand: 'Davivienda', color: '#E1111C', title: 'Transferencia exitosa', rows: [['Número de comprobante', t.reference!], ['Beneficiario', t.receiver], ['Cuenta destino', '****7788'], ['Ordenante', t.payer!], ['Valor', copCents(t.amount)], ['Fecha', `${dmy(t.date)} ${time}`]] }),
  },
  {
    name: 'BBVA', country: 'CO',
    make: (t, time) => card({ brand: 'BBVA', color: '#072146', title: 'Operación exitosa', rows: [['Importe', cop(t.amount)], ['Beneficiario', t.receiver], ['Titular origen', t.payer!], ['Fecha', `${dmy(t.date)} ${time}`], ['Referencia', t.reference!]] }),
  },
  {
    name: 'Banco de Bogotá', country: 'CO',
    make: (t, time) => { const [y, m, d] = parts(t.date); return card({ brand: 'Banco de Bogotá', color: '#003B71', title: 'Transferencia realizada', rows: [['Destinatario', t.receiver], ['Nombre del remitente', t.payer!], ['Monto', copCents(t.amount)], ['Fecha', `${d} de ${MONTHS_ES[m - 1]} de ${y}, ${time}`], ['Número de aprobación', t.reference!]] }); },
  },
  {
    name: 'PSE', country: 'CO',
    make: (t, time) => card({ brand: 'PSE · Pagos Seguros en Línea', color: '#005AA7', title: 'Transacción aprobada', rows: [['Beneficiario', t.receiver], ['Pagador', t.payer!], ['Valor', cop(t.amount)], ['Fecha', `${dmy(t.date)} ${time}`], ['CUS / Referencia', t.reference!]] }),
  },
  {
    name: 'Efecty', country: 'CO', photo: true,
    make: (t, time) => card({ brand: 'Efecty', color: '#FFD200', ink: '#222', title: 'Giro nacional', rows: [['Remitente', t.payer!], ['Destinatario', t.receiver], ['Valor del giro', cop(t.amount)], ['Fecha', `${dmy(t.date)} ${time}`], ['Número de giro', t.reference!]], font: "'Courier New', monospace" }),
  },
  {
    name: 'Corresponsal', country: 'CO', photo: true,
    make: (t, time) => card({ brand: 'Corresponsal Bancario', color: '#3D3D3D', title: 'Comprobante de depósito', rows: [['Titular destino', t.receiver], ['Nombre del remitente', t.payer!], ['Valor', cop(t.amount)], ['Fecha', `${dmy(t.date)} ${time}`], ['Aprobación', t.reference!]], font: "'Courier New', monospace", width: 380 }),
  },
  {
    name: 'Consignación', country: 'CO', photo: true,
    make: (t) => paper({ bank: 'BANCO DE BOGOTÁ', title: 'Comprobante de consignación', rows: [['Beneficiario', t.receiver], ['Remitente', t.payer!], ['Valor', cop(t.amount)], ['Fecha', dmy(t.date)], ['Número de comprobante', t.reference!]] }),
  },
  {
    name: 'PIX', country: 'BR',
    make: (t, time) => { const [y, m, d] = parts(t.date); return card({ brand: 'Pix', color: '#32BCAD', title: 'Comprovante de transferência', rows: [['Valor', brl(t.amount)], ['Data', `${d} de ${MONTHS_PT[m - 1]} de ${y}, às ${time}`], ['Quem recebeu', t.receiver], ['Quem pagou', t.payer!], ['ID da transação', t.reference!]] }); },
  },
  {
    name: 'TED', country: 'BR',
    make: (t, time) => card({ brand: 'Banco do Brasil', color: '#F9DD16', ink: '#003A70', title: 'Comprovante de TED', rows: [['Favorecido', t.receiver], ['Remetente', t.payer!], ['Valor', brl(t.amount)], ['Data', `${dmy(t.date)} ${time}`], ['Autenticação', t.reference!]] }),
  },
  {
    name: 'Zelle', country: 'US',
    make: (t) => { const [y, m, d] = parts(t.date); return card({ brand: 'Zelle', color: '#6D1ED4', title: 'Payment sent', rows: [['Sent to', t.receiver], ['From', t.payer!], ['Amount', usd(t.amount)], ['Date', `${MONTHS_EN[m - 1]} ${d}, ${y}`], ['Confirmation', t.reference!]] }); },
  },
  {
    name: 'Venmo', country: 'US',
    make: (t) => { const [y, m, d] = parts(t.date); return card({ brand: 'venmo', color: '#008CFF', title: 'Payment complete', rows: [['Paid to', t.receiver], ['Paid by', t.payer!], ['Amount', usd(t.amount)], ['Date', `${MONTHS_EN[m - 1]} ${d}, ${y}`], ['Transaction ID', t.reference!]] }); },
  },
  {
    name: 'Cash App', country: 'US',
    make: (t) => card({ brand: 'Cash App', color: '#00D632', ink: '#111', title: 'Payment completed', rows: [['Recipient', t.receiver], ['Sender', t.payer!], ['Amount', usd(t.amount)], ['Date', `${String(parts(t.date)[1]).padStart(2, '0')}/${String(parts(t.date)[2]).padStart(2, '0')}/${parts(t.date)[0]}`], ['Transaction ID', t.reference!]] }),
  },
  {
    name: 'US bank transfer', country: 'US',
    make: (t) => { const [y, m, d] = parts(t.date); return card({ brand: 'Chase', color: '#117ACA', title: 'Transfer confirmation', rows: [['Payee', t.receiver], ['From', t.payer!], ['Amount', usd(t.amount)], ['Date', `${MONTHS_EN[m - 1]} ${d}, ${y}`], ['Reference number', t.reference!]] }); },
  },
];

const PAYERS: Record<'CO' | 'BR' | 'US', string[]> = {
  CO: ['María José Pérez Gómez', 'Andrés Felipe Rodríguez', 'Luz Ángela Martínez Rojas', 'Carlos Eduardo Gómez Ruiz', 'Sandra Milena Castaño'],
  BR: ['João Carlos Almeida', 'Fernanda Souza Lima', 'Luiz Henrique Araújo'],
  US: ['Michael Johnson', 'Emily Davis', 'Robert Miller'],
};
const AMOUNTS: Record<Currency, number[]> = { COP: [60_000, 150_000, 38_000, 472_798, 1_250_000], BRL: [6_000, 25_050, 180_000], USD: [15_000, 6_050, 120_000] };
const CUR: Record<'CO' | 'BR' | 'US', Currency> = { CO: 'COP', BR: 'BRL', US: 'USD' };
const DATES = ['2026-09-14', '2026-09-21', '2026-10-02', '2026-10-07'];
const TIMES = ['09:15', '10:41', '14:07', '17:32'];

/** Variantes por formato: captura y PDF; foto del papel en los formatos que suelen llegar impresos; una captura más con otros datos en los más usados. */
const EXTRA_PNG = new Set(['Nequi', 'Daviplata', 'Bancolombia', 'PIX', 'Zelle']);

export function dataset(): Sample[] {
  const out: Sample[] = [];
  let k = 0;
  for (const f of FORMATS) {
    const variants: Variant[] = f.name === 'Consignación' ? ['photo', 'pdf'] : [...(f.photo ? ['png', 'photo', 'pdf'] : ['png', 'pdf']), ...(EXTRA_PNG.has(f.name) ? ['png'] : [])] as Variant[];
    for (const variant of variants) {
      const i = k++;
      const currency = CUR[f.country];
      const payers = PAYERS[f.country];
      const amounts = AMOUNTS[currency];
      const truth: Truth = {
        amount: amounts[i % amounts.length]!,
        currency,
        date: DATES[i % DATES.length]!,
        payer: payers[i % payers.length]!,
        receiver: RECEIVER[f.country],
        reference: `${['M', 'A', 'T', 'R'][i % 4]}${String(100_000_000 + i * 7_919_311).slice(0, 9)}`,
      };
      const screen = f.make(truth, TIMES[i % TIMES.length]!);
      const html = variant === 'photo' && f.name !== 'Consignación' ? photoOf(screen) : screen;
      out.push({ id: `${String(i + 1).padStart(2, '0')}-${f.name.replace(/\W+/g, '-').toLowerCase()}-${variant}`, format: f.name, country: f.country, variant, html, truth });
    }
  }
  return out;
}

/** Envuelve un comprobante de pantalla como si fuera una foto del papel impreso: girado, con ruido y desenfoque leve. */
function photoOf(html: string): string {
  const body = /<body>([\s\S]*)<\/body>/.exec(html)![1]!;
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!.replace(/body\{[^}]*\}/, '');
  return `<html><head><meta charset="utf-8"><style>${style}
body{margin:0;background:#77746c;width:560px;height:700px;display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif;color:#1f1f1f}
.photo{background:#fbfaf5;width:440px;transform:rotate(1.4deg);box-shadow:5px 7px 14px rgba(0,0,0,.4);filter:contrast(.9) brightness(.97) blur(.3px);
background-image:radial-gradient(rgba(0,0,0,.05) 1px,transparent 1px);background-size:4px 4px}</style></head>
<body><div class="photo">${body}</div></body></html>`;
}

/** Convierte las muestras en archivos: PNG (captura o foto) o PDF con capa de texto. */
export async function render(samples: Sample[], chromiumPath?: string | null): Promise<Map<string, { body: Buffer; mime: string }>> {
  const browser: Browser = await chromium.launch({ executablePath: chromiumPath ?? undefined, args: ['--disable-dev-shm-usage', '--font-render-hinting=none'] });
  const out = new Map<string, { body: Buffer; mime: string }>();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    for (const s of samples) {
      await page.setContent(s.html, { waitUntil: 'load' });
      if (s.variant === 'pdf') {
        out.set(s.id, { body: Buffer.from(await page.pdf({ width: '120mm', height: '190mm', printBackground: true })), mime: 'application/pdf' });
      } else {
        const el = await page.$('body');
        out.set(s.id, { body: Buffer.from(await el!.screenshot({ type: 'png' })), mime: 'image/png' });
      }
    }
  } finally {
    await browser.close();
  }
  return out;
}

/** Un comprobante de un formato con datos dados, para las pruebas de los canales (CA-07 a CA-09). */
export function receiptHtml(format: string, truth: Truth, time = '10:41'): string {
  const f = FORMATS.find((x) => x.name === format);
  if (!f) throw new Error(`Formato desconocido: ${format}`);
  return f.make(truth, time);
}

export async function renderOne(html: string, as: 'png' | 'pdf', chromiumPath?: string | null): Promise<Buffer> {
  const files = await render([{ id: 'x', format: 'x', country: 'CO', variant: as, html, truth: {} as Truth }], chromiumPath);
  return files.get('x')!.body;
}
