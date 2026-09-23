import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from '../common/context.js';
import { Auth, Op, Requires } from '../common/decorators.js';
import { BackupService } from './backup.service.js';

@Controller('backups')
export class BackupsController {
  constructor(private readonly backups: BackupService) {}

  @Post()
  @HttpCode(202)
  @Requires('backup.create')
  @Op('createBackup')
  create(@Auth() a: AuthContext, @Body() b: { password: string }) {
    return this.backups.create(a, b.password);
  }

  @Get()
  @Requires('backup.create')
  @Op('listBackups')
  list(@Auth() a: AuthContext) {
    return this.backups.list(a);
  }

  @Get(':id')
  @Requires('backup.create')
  @Op('getBackup')
  get(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.backups.get(a, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Requires('backup.create')
  @Op('cancelBackup')
  cancel(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.backups.cancel(a, id);
  }

  @Post(':id/link')
  @HttpCode(200)
  @Requires('backup.create')
  @Op('createBackupLink')
  link(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.backups.link(a, id);
  }
}

/** Restauración: solo el Propietario (§7.2, §19). */
@Controller('restores')
export class RestoresController {
  constructor(private readonly backups: BackupService) {}

  @Post()
  @Requires('backup.restore')
  @Op('uploadRestore')
  upload(@Auth() a: AuthContext, @Req() req: Request) {
    return this.backups.upload(a, req, Number(req.headers['content-length'] ?? 0));
  }

  @Post(':id/verify')
  @HttpCode(200)
  @Requires('backup.restore')
  @Op('verifyRestore')
  verify(@Auth() a: AuthContext, @Param('id') id: string, @Body() b: { password: string }) {
    return this.backups.verify(a, id, b.password);
  }

  @Post(':id/apply')
  @HttpCode(200)
  @Requires('backup.restore')
  @Op('applyRestore')
  apply(@Auth() a: AuthContext, @Param('id') id: string, @Body() b: { password: string; confirmName: string }) {
    return this.backups.apply(a, id, b.password, b.confirmName);
  }
}
