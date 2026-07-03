import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

interface JwtUser {
  sub: string;
  companyId: string;
}

// companyId берём ТОЛЬКО из токена — иначе можно смотреть отчёты чужой компании.
@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  // Финансовая сводка за период
  @Get('summary')
  @RequirePermissions('reports.view')
  summary(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.summary(user.companyId, from, to);
  }

  // Выручка по дням (график)
  @Get('daily')
  @RequirePermissions('reports.view')
  daily(@CurrentUser() user: JwtUser, @Query('days') days?: string) {
    return this.reports.daily(user.companyId, days ? Number(days) : 14);
  }

  // Продажи по услугам/товарам
  @Get('sales-by-item')
  @RequirePermissions('reports.view')
  salesByItem(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.salesByItem(user.companyId, from, to);
  }

  // Прибыль по заказам (выручка − себестоимость)
  @Get('profit')
  @RequirePermissions('reports.view')
  profit(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.profit(user.companyId, from, to);
  }

  // Расходы кассы по категориям
  @Get('expenses')
  @RequirePermissions('reports.view')
  expenses(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.expenses(user.companyId, from, to);
  }

  // Загрузка оборудования
  @Get('equipment-load')
  @RequirePermissions('reports.view')
  equipmentLoad(@CurrentUser() user: JwtUser) {
    return this.reports.equipmentLoad(user.companyId);
  }

  // Долги клиентов
  @Get('debts')
  @RequirePermissions('reports.view')
  debts(@CurrentUser() user: JwtUser) {
    return this.reports.debts(user.companyId);
  }

  // Эффективность сотрудников
  @Get('staff')
  @RequirePermissions('reports.view')
  staff(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.staffPerformance(user.companyId, from, to);
  }
}
