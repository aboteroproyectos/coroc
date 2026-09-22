/** Matriz de permisos por rol (§7.2). La base de datos además limita al Cobrador a sus clientes (ADR-022). */
export const PERMISSIONS = [
  'company.view', 'company.edit',
  'users.view', 'users.manage',
  'clients.view', 'clients.create', 'clients.edit',
  'loans.create',
  'payments.register', 'payments.reverse',
  'compliance.view', 'compliance.manage',
  'dashboard.view',
  'reports.view', 'audit.view',
  'backup.create', 'backup.restore', 'subscription.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export type Role = 'owner' | 'admin' | 'collector' | 'auditor';

const ALL = new Set<Permission>(PERMISSIONS);
export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: ALL,
  admin: new Set(PERMISSIONS.filter((p) => p !== 'backup.restore' && p !== 'subscription.manage')),
  // Solo sus clientes asignados; puede registrar y validar pagos; no reversa ni ve informes globales.
  collector: new Set<Permission>(['company.view', 'clients.view', 'payments.register', 'dashboard.view']),
  auditor: new Set<Permission>(['company.view', 'users.view', 'clients.view', 'compliance.view', 'dashboard.view', 'reports.view', 'audit.view']),
};

export const can = (role: Role, p: Permission): boolean => ROLE_PERMISSIONS[role]?.has(p) ?? false;
export const permissionsOf = (role: Role): Permission[] => [...(ROLE_PERMISSIONS[role] ?? [])];
