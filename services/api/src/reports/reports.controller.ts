import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import type { AuthContext } from '../common/context.js';
import { Auth, Op, Requires } from '../common/decorators.js';
import { taskJson } from '../documents/documents.controller.js';
import { ReportsService, type ReportRequest } from './reports.service.js';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Informe (§18) en segundo plano; queda en el repositorio (`_Informes`) y la app sigue la tarea. */
  @Post()
  @HttpCode(202)
  @Requires('reports.view')
  @Op('requestReport')
  async request(@Auth() a: AuthContext, @Body() b: ReportRequest) {
    return taskJson(await this.reports.request(a, b));
  }
}
