import { Injectable } from '@nestjs/common';
import { Problem } from './problem.js';

/** Límite simple por clave (IP + ruta) para frenar ataques de fuerza bruta a /auth/*. */
@Injectable()
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  hit(key: string, limit: number, windowMs: number, now = Date.now()): void {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 50_000) this.hits.clear();
    if (arr.length > limit) throw new Problem(429, 'RATE_LIMITED');
  }
}
