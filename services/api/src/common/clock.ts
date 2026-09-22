import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config.js';

/** Reloj de la aplicación. En pruebas se fija con COROC_CLOCK_NOW o `set()` para verificar fechas exactas. */
@Injectable()
export class Clock {
  private fixed: Date | null;
  constructor(@Inject(CONFIG) config: AppConfig) {
    this.fixed = config.clockNow ? new Date(config.clockNow) : null;
  }
  now(): Date {
    return this.fixed ? new Date(this.fixed) : new Date();
  }
  set(iso: string | null): void {
    this.fixed = iso ? new Date(iso) : null;
  }
  /** Fecha civil YYYY-MM-DD en la zona horaria dada (§9.3: todo en la zona de la empresa). */
  today(timeZone: string): string {
    return localDate(this.now(), timeZone);
  }
  /** "YYYY-MM-DD HH:mm" local, para el recibo. */
  localStamp(timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(this.now());
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`;
  }
}

export function localDate(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
