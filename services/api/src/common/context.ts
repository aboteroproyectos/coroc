import { AsyncLocalStorage } from 'node:async_hooks';
import type { Lang } from './i18n.js';

/** Datos de la petición en curso, disponibles para la bitácora sin pasarlos por cada función. */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  deviceId: string | null;
  lang: Lang;
}

export const requestMeta = new AsyncLocalStorage<RequestMeta>();
export const currentMeta = (): RequestMeta | undefined => requestMeta.getStore();

/** Sesión autenticada adjunta a la petición por el guardián de autenticación. */
export interface AuthContext {
  userId: string;
  tenantId: string;
  sessionId: string;
  role: 'owner' | 'admin' | 'collector' | 'auditor';
  lang: Lang;
  deviceId: string;
  mfa: 'ok' | 'enroll_required';
}
