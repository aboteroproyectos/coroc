import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { Redis } from 'ioredis';
import { CONFIG, type AppConfig } from '../config.js';

/** Evento en tiempo real (§17): se difunde a todos los dispositivos conectados de la empresa. */
export interface CorocEvent {
  type: 'payment.posted' | 'payment.reversed' | 'loan.created' | 'client.updated' | 'dashboard.changed' | 'security.lockout';
  tenantId: string;
  /** Para filtrar lo que ve un Cobrador: solo eventos de sus clientes. */
  clientId?: string | null;
  collectorId?: string | null;
  data: Record<string, unknown>;
  at: string;
}

/**
 * Bus de eventos. Con REDIS_URL usa publicación/suscripción de Redis para que todas las instancias de la API
 * reciban los eventos; sin Redis (desarrollo y pruebas) funciona en memoria.
 */
@Injectable()
export class EventBus implements OnModuleDestroy {
  private readonly local = new EventEmitter().setMaxListeners(0);
  private pub: Redis | null = null;
  private sub: Redis | null = null;
  private readonly log = new Logger('EventBus');

  constructor(@Inject(CONFIG) config: AppConfig) {
    if (config.redisUrl) {
      this.pub = new Redis(config.redisUrl, { lazyConnect: false, maxRetriesPerRequest: 2 });
      this.sub = new Redis(config.redisUrl, { lazyConnect: false });
      void this.sub.psubscribe('coroc:events:*');
      this.sub.on('pmessage', (_p, _channel, msg) => {
        try {
          const ev = JSON.parse(msg) as CorocEvent;
          this.local.emit(ev.tenantId, ev);
        } catch {
          this.log.warn('Evento con formato no válido descartado');
        }
      });
    }
  }

  publish(ev: Omit<CorocEvent, 'at'>): void {
    const full: CorocEvent = { ...ev, at: new Date().toISOString() };
    if (this.pub) void this.pub.publish(`coroc:events:${ev.tenantId}`, JSON.stringify(full)).catch(() => this.local.emit(ev.tenantId, full));
    else this.local.emit(ev.tenantId, full);
  }

  subscribe(tenantId: string, fn: (ev: CorocEvent) => void): () => void {
    this.local.on(tenantId, fn);
    return () => this.local.off(tenantId, fn);
  }

  async onModuleDestroy(): Promise<void> {
    this.local.removeAllListeners();
    await Promise.all([this.pub?.quit(), this.sub?.quit()].filter(Boolean));
  }
}
