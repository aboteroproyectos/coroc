import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { OPERATION } from './decorators.js';
import { contract } from './openapi.js';

/** Valida cada petición contra su operación del contrato OpenAPI antes de llegar al controlador. */
@Injectable()
export class ContractInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const op = this.reflector.get<string>(OPERATION, ctx.getHandler());
    if (op) contract().check(op, ctx.switchToHttp().getRequest());
    return next.handle();
  }
}
