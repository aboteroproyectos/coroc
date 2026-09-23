import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { chromium, type Browser } from 'playwright-core';
import { CONFIG, type AppConfig } from '../config.js';

/**
 * PDF con Chromium sin interfaz (§4.2, ADR-033). Un solo navegador por proceso y un contexto nuevo por documento,
 * sin JavaScript y sin red: la plantilla ya trae fuentes, logo y QR incrustados, así que nada sale del servidor
 * aunque un dato del cliente intentara cargar un recurso externo.
 */
@Injectable()
export class PdfRenderer implements OnModuleDestroy {
  private readonly log = new Logger('PDF');
  private browser: Promise<Browser> | null = null;
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private static readonly MAX_PAGES = 3;

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  private launch(): Promise<Browser> {
    if (!this.browser) {
      this.browser = chromium
        .launch({ executablePath: this.config.chromiumPath ?? undefined, args: ['--disable-dev-shm-usage', '--font-render-hinting=none'] })
        .then((b) => {
          b.on('disconnected', () => {
            this.browser = null;
          });
          return b;
        })
        .catch((e) => {
          this.browser = null;
          this.log.error(`No se pudo iniciar Chromium: ${(e as Error).message}`);
          throw e;
        });
    }
    return this.browser;
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= PdfRenderer.MAX_PAGES) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  async render(html: string, opts: { footer?: string } = {}): Promise<Buffer> {
    return this.slot(async () => {
      const browser = await this.launch();
      const ctx = await browser.newContext({ javaScriptEnabled: false, offline: true });
      try {
        await ctx.route('**/*', (r) => (r.request().url().startsWith('data:') ? r.continue() : r.abort()));
        const page = await ctx.newPage();
        await page.setContent(html, { waitUntil: 'load' });
        return await page.pdf({
          preferCSSPageSize: true,
          printBackground: true,
          displayHeaderFooter: !!opts.footer,
          headerTemplate: '<span></span>',
          footerTemplate: opts.footer ?? '<span></span>',
          tagged: true,
        });
      } finally {
        await ctx.close();
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    const b = await this.browser?.catch(() => null);
    await b?.close().catch(() => undefined);
  }
}
