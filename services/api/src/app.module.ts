import { Controller, Get, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { AuditService } from './audit/audit.service.js';
import { AuthController, MeController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { ClientsController } from './clients/clients.controller.js';
import { ClientsService } from './clients/clients.service.js';
import { AccessService } from './common/access.js';
import { Clock } from './common/clock.js';
import { requestMeta } from './common/context.js';
import { ContractInterceptor } from './common/contract.interceptor.js';
import { Public } from './common/decorators.js';
import { pickLang } from './common/i18n.js';
import { IdempotencyInterceptor } from './common/idempotency.interceptor.js';
import { Mailer, MemoryMailer } from './common/mailer.js';
import { ProblemFilter } from './common/problem.js';
import { RateLimiter } from './common/rate-limit.js';
import { CompanyController } from './company/company.controller.js';
import { TenantCache } from './company/tenant-cache.js';
import { RateCapsController, RateCapService } from './compliance/rate-caps.js';
import { CONFIG, loadConfig } from './config.js';
import { DashboardController, DashboardService } from './dashboard/dashboard.js';
import { EventBus } from './dashboard/event-bus.js';
import { DbService } from './db/db.service.js';
import { MaintenanceJobs } from './jobs/maintenance.js';
import { LoanStateService } from './loans/loan-state.service.js';
import { LoansController } from './loans/loans.controller.js';
import { LoansService } from './loans/loans.service.js';
import { PaymentsService } from './loans/payments.service.js';
import { UsersController } from './users/users.controller.js';
import { ClientDocumentsController, DocumentsController, FilesController, FolderController, LoanDocumentsController, PublicReceiptsController, TasksController } from './documents/documents.controller.js';
import { DocumentsService } from './documents/documents.service.js';
import { DocumentFactory } from './documents/factory.js';
import { LinkSigner } from './documents/links.js';
import { DocumentTasks } from './documents/tasks.js';
import { PdfRenderer } from './pdf/renderer.js';
import { ObjectStore } from './storage/object-store.js';
import { ReportsController } from './reports/reports.controller.js';
import { ReportsService } from './reports/reports.service.js';
import { BackupsController, RestoresController } from './backup/backup.controller.js';
import { BackupService } from './backup/backup.service.js';
import { IntakeController, PortalController, UploadLinksController, WebhooksController, WhatsAppAccountController } from './intake/intake.controller.js';
import { IntakeService } from './intake/intake.service.js';
import { ReceiptExtractor } from './intake/extractor.js';
import { ReceiptReader } from './intake/reader.js';
import { UploadLinksService } from './intake/upload-links.service.js';

@Controller('health')
class HealthController {
  constructor(private readonly db: DbService) {}
  @Public()
  @Get()
  async health() {
    await this.db.pool.query('SELECT 1');
    return { status: 'ok' };
  }
}

/** Datos de la petición para la bitácora (IP, dispositivo, idioma), sin registrar el cuerpo. */
function requestMetaMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const device = req.headers['x-coroc-device'];
  requestMeta.run(
    {
      ip: req.ip ?? null,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      deviceId: typeof device === 'string' ? device.slice(0, 120) : null,
      lang: pickLang(null, req.headers['accept-language']),
    },
    next,
  );
}

@Module({
  controllers: [HealthController, AuthController, MeController, UsersController, CompanyController, RateCapsController, ClientsController, LoansController, DashboardController,
    DocumentsController, ClientDocumentsController, LoanDocumentsController, TasksController, FolderController, FilesController, PublicReceiptsController, ReportsController, BackupsController, RestoresController,
    IntakeController, UploadLinksController, PortalController, WebhooksController, WhatsAppAccountController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    Clock,
    DbService,
    AuditService,
    EventBus,
    TenantCache,
    { provide: Mailer, useClass: MemoryMailer },
    RateLimiter,
    AccessService,
    AuthService,
    RateCapService,
    LoanStateService,
    LoansService,
    PaymentsService,
    ClientsService,
    DashboardService,
    MaintenanceJobs,
    ObjectStore,
    LinkSigner,
    PdfRenderer,
    DocumentTasks,
    DocumentsService,
    DocumentFactory,
    ReportsService,
    BackupService,
    ReceiptReader,
    ReceiptExtractor,
    IntakeService,
    UploadLinksService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ContractInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: ProblemFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestMetaMiddleware).forRoutes('*path');
  }
}
