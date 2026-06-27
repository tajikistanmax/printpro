import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';

@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  // Финансовая сводка за период
  @Get('summary')
  @RequirePermissions('reports.view')
  summary(
    @Query('companyId') companyId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.summary(companyId, from, to);
  }

  // Выручка по дням (график)
  @Get('daily')
  @RequirePermissions('reports.view')
  daily(
    @Query('companyId') companyId: string,
    @Query('days') days?: string,
  ) {
    return this.reports.daily(companyId, days ? Number(days) : 14);
  }

  // Продажи по услугам/товарам
  @Get('sales-by-item')
  @RequirePermissions('reports.view')
  salesByItem(
    @Query('companyId') companyId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.salesByItem(companyId, from, to);
  }

  // Прибыль по заказам (выручка − себестоимость)
  @Get('profit')
  @RequirePermissions('reports.view')
  profit(
    @Query('companyId') companyId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.profit(companyId, from, to);
  }

  // Долги клиентов
  @Get('debts')
  @RequirePermissions('reports.view')
  debts(@Query('companyId') companyId: string) {
    return this.reports.debts(companyId);
  }

  // Эффективность сотрудников
  @Get('staff')
  @RequirePermissions('reports.view')
  staff(
    @Query('companyId') companyId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.staffPerformance(companyId, from, to);
  }
}
