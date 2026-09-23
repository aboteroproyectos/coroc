import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthContext } from './context.js';
import type { Permission } from '../auth/permissions.js';

export const PUBLIC = 'coroc:public';
export const PERMISSION = 'coroc:permission';
export const OPERATION = 'coroc:operation';
export const IDEMPOTENT = 'coroc:idempotent';
export const DURING_ENROLLMENT = 'coroc:during-enrollment';

/** Ruta sin sesión (ingreso, renovación, recuperación). */
export const Public = () => SetMetadata(PUBLIC, true);
/** Permiso requerido según el rol (§7.2). */
export const Requires = (p: Permission) => SetMetadata(PERMISSION, p);
/** Operación del contrato OpenAPI: el cuerpo y los parámetros se validan contra su esquema. */
export const Op = (operationId: string) => SetMetadata(OPERATION, operationId);
/** Acepta el encabezado Idempotency-Key (operaciones que crean movimientos contables). */
export const Idempotent = () => SetMetadata(IDEMPOTENT, true);
/** Permitida mientras el Propietario aún no activa el segundo factor. */
export const DuringEnrollment = () => SetMetadata(DURING_ENROLLMENT, true);

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => ctx.switchToHttp().getRequest().auth);
