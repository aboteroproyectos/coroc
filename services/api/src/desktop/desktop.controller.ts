import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Op, Public } from '../common/decorators.js';
import { RateLimiter } from '../common/rate-limit.js';
import { DesktopService, type DesktopSetupInput } from './desktop.service.js';

/**
 * COROC Escritorio (ADR-062): rutas del asistente de primer uso. No llevan sesión porque aún no hay empresa, pero solo
 * existen en Escritorio y, como toda la API ahí, exigen la clave de la ejecución que solo tiene la app (`desktopGate`).
 */
@Controller('desktop')
export class DesktopController {
  constructor(private readonly desktop: DesktopService, private readonly limiter: RateLimiter) {}

  @Public()
  @Get('status')
  @Op('desktopStatus')
  status() {
    return this.desktop.status();
  }

  @Public()
  @Post('setup')
  @HttpCode(201)
  @Op('desktopSetup')
  setup(@Body() b: DesktopSetupInput) {
    this.limiter.hit('desktop:setup', 20, 60_000);
    return this.desktop.setup(b);
  }

  @Public()
  @Post('restore')
  @HttpCode(201)
  @Op('desktopRestoreUpload')
  upload(@Req() req: Request) {
    this.limiter.hit('desktop:restore', 10, 60_000);
    return this.desktop.restoreUpload(req, Number(req.headers['content-length'] ?? 0));
  }

  @Public()
  @Post('restore/:id/apply')
  @HttpCode(200)
  @Op('desktopRestoreApply')
  apply(@Param('id') id: string, @Body() b: { password: string }) {
    this.limiter.hit('desktop:apply', 10, 60_000);
    return this.desktop.restoreApply(id, b.password);
  }

  @Public()
  @Post('password')
  @HttpCode(204)
  @Op('desktopResetPassword')
  async reset(@Body() b: { username: string; password: string }): Promise<void> {
    this.limiter.hit('desktop:password', 10, 60_000);
    await this.desktop.resetPassword(b.username, b.password);
  }
}
