import { Controller, Get, Inject, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CONFIG, type AppConfig } from '../config.js';
import { Op, Public } from '../common/decorators.js';
import { LANGS, pickLang, type Lang } from '../common/i18n.js';
import { esc } from '../pdf/templates.js';
import { page, PORTAL_CSP } from '../intake/portal.js';
import { PRIVACY_VERSION, privacyPolicy } from './privacy.js';

/** Política de privacidad pública (§20.4): la enlazan las fichas de Google Play y App Store, la app y el portal. */
@Controller('public')
export class PrivacyController {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  @Get('privacy')
  @Public()
  @Op('privacyPolicy')
  privacy(@Req() req: Request, @Res() res: Response, @Query('lang') q?: string) {
    const lang: Lang = LANGS.includes(q as Lang) ? (q as Lang) : pickLang(null, req.headers['accept-language']);
    const p = privacyPolicy(lang, this.config.privacyContact);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (req.accepts(['html', 'json']) === 'json') return res.json({ version: PRIVACY_VERSION, lang, ...p });
    const body = `<div class="card"><h1>${esc(p.title)}</h1><p class="muted">${esc(p.updated)}</p><p>${esc(p.intro)}</p></div>${p.sections
      .map((s) => `<section class="card"><h2>${esc(s.h)}</h2>${s.p.map((x) => `<p>${esc(x)}</p>`).join('')}</section>`)
      .join('')}`;
    res.status(200).type('html').setHeader('Content-Security-Policy', PORTAL_CSP).send(page(lang, p.title, body, '/v1/public/privacy', { index: true }));
  }
}
