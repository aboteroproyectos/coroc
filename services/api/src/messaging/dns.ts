import { promises as dns } from 'node:dns';
import { Injectable } from '@nestjs/common';

/** Consultas DNS del asistente de SPF, DKIM y DMARC (§11.2). Separado para poder reemplazarlo en las pruebas. */
@Injectable()
export class DnsResolver {
  async txt(host: string): Promise<string[]> {
    try {
      return (await dns.resolveTxt(host)).map((parts) => parts.join(''));
    } catch {
      return [];
    }
  }
}

export interface DnsCheck {
  spf: boolean;
  dkim: boolean;
  dmarc: boolean;
  records: { kind: 'spf' | 'dkim' | 'dmarc'; type: 'TXT'; host: string; expected: string; found: string | null; ok: boolean }[];
}

/**
 * Verifica los registros del dominio del remitente: SPF (`v=spf1`, con el `include` del proveedor si se conoce), DKIM
 * (la clave pública publicada en `<selector>._domainkey`, que entrega el proveedor) y DMARC (`v=DMARC1` en `_dmarc`).
 */
export async function checkDomain(resolver: DnsResolver, domain: string, selector: string | null, spfInclude: string | null): Promise<DnsCheck> {
  const spfRec = (await resolver.txt(domain)).find((r) => r.toLowerCase().startsWith('v=spf1')) ?? null;
  const spf = !!spfRec && (!spfInclude || spfRec.toLowerCase().includes(`include:${spfInclude.toLowerCase()}`));
  const dkimHost = selector ? `${selector}._domainkey.${domain}` : `<selector>._domainkey.${domain}`;
  const dkimRec = selector ? ((await resolver.txt(dkimHost)).find((r) => /(^|;)\s*p=[A-Za-z0-9+/=]{40,}/.test(r)) ?? null) : null;
  const dmarcRec = (await resolver.txt(`_dmarc.${domain}`)).find((r) => r.toUpperCase().startsWith('V=DMARC1')) ?? null;
  return {
    spf,
    dkim: !!dkimRec,
    dmarc: !!dmarcRec,
    records: [
      { kind: 'spf', type: 'TXT', host: domain, expected: `v=spf1 ${spfInclude ? `include:${spfInclude} ` : ''}~all`, found: spfRec, ok: spf },
      { kind: 'dkim', type: 'TXT', host: dkimHost, expected: 'k=rsa; p=…', found: dkimRec, ok: !!dkimRec },
      { kind: 'dmarc', type: 'TXT', host: `_dmarc.${domain}`, expected: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`, found: dmarcRec, ok: !!dmarcRec },
    ],
  };
}
