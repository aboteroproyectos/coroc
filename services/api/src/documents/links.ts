import crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { CONFIG, type AppConfig } from '../config.js';

export interface LinkClaims {
  /** Empresa */
  t: string;
  /** Qué se descarga */
  k: 'document' | 'backup';
  /** Identificador */
  i: string;
  /** Vencimiento (segundos Unix) */
  e: number;
}

/**
 * Enlaces firmados de corta duración (§4.2): permiten abrir un archivo en el visor o compartirlo sin la sesión, y
 * vencen en minutos. Solo llevan identificadores, nunca nombres ni datos del cliente (§2 regla 9: las URL terminan
 * en registros de acceso).
 */
@Injectable()
export class LinkSigner {
  private readonly key: Buffer;

  constructor(@Inject(CONFIG) private readonly config: AppConfig, private readonly clock: Clock) {
    this.key = Buffer.from(crypto.hkdfSync('sha256', config.jwtSecret, Buffer.alloc(0), 'coroc:download-links:v1', 32));
  }

  sign(claims: Omit<LinkClaims, 'e'>, ttlSeconds = this.config.linkTtlSeconds): { token: string; expiresAt: string } {
    const e = Math.floor(this.clock.now().getTime() / 1000) + ttlSeconds;
    const body = Buffer.from(JSON.stringify({ ...claims, e })).toString('base64url');
    const mac = crypto.createHmac('sha256', this.key).update(body).digest('base64url');
    return { token: `${body}.${mac}`, expiresAt: new Date(e * 1000).toISOString() };
  }

  verify(token: string): LinkClaims | null {
    const [body, mac] = token.split('.');
    if (!body || !mac) return null;
    const expected = crypto.createHmac('sha256', this.key).update(body).digest();
    const got = Buffer.from(mac, 'base64url');
    if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
    try {
      const c = JSON.parse(Buffer.from(body, 'base64url').toString()) as LinkClaims;
      if (typeof c.e !== 'number' || c.e * 1000 < this.clock.now().getTime()) return null;
      if (c.k !== 'document' && c.k !== 'backup') return null;
      return c;
    } catch {
      return null;
    }
  }

  url(token: string): string {
    return `${this.config.publicApiUrl}/v1/files/${token}`;
  }
}
