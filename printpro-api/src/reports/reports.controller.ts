import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { ReportsService } from './reports.service';

interface JwtUser {
  sub: string;
  companyId: string;
}

@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  @RequirePermissions('reports.view')
  summary(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('compare') compare?: string,
  ) {
    return this.reports.summary(
      user.companyId,
      from,
      to,
      branchId,
      compare === '1' || compare === 'true',
    );
  }

  @Get('timeseries')
  @RequirePermissions('reports.view')
  timeseries(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('groupBy') groupBy?: string,
  ) {
    return this.reports.timeseries(
      user.companyId,
      from,
      to,
      branchId,
      this.parseGroupBy(groupBy),
    );
  }

  @Get('daily')
  @RequirePermissions('reports.view')
  daily(@CurrentUser() user: JwtUser, @Query('days') days?: string) {
    return this.reports.daily(user.companyId, days ? Number(days) : 14);
  }

  @Get('sales-by-item')
  @RequirePermissions('reports.view')
  salesByItem(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('type') type?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.reports.salesByItem(
      user.companyId,
      from,
      to,
      branchId,
      this.parseType(type),
      categoryId,
    );
  }

  @Get('sales-by-category')
  @RequirePermissions('reports.view')
  salesByCategory(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('type') type?: string,
  ) {
    return this.reports.salesByCategory(
      user.companyId,
      from,
      to,
      branchId,
      this.parseType(type),
    );
  }

  @Get('sales-by-client')
  @RequirePermissions('reports.view')
  salesByClient(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reports.salesByClient(
      user.companyId,
      from,
      to,
      branchId,
      limit ? Number(limit) : 100,
    );
  }

  @Get('abc')
  @RequirePermissions('reports.view')
  abc(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('type') type?: string,
  ) {
    return this.reports.abc(
      user.companyId,
      from,
      to,
      branchId,
      this.parseType(type),
    );
  }

  @Get('profit')
  @RequirePermissions('reports.view')
  profit(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.reports.profit(user.companyId, from, to, branchId);
  }

  @Get('expenses')
  @RequirePermissions('reports.view')
  expenses(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.reports.expenses(user.companyId, from, to, branchId);
  }

  @Get('cashflow')
  @RequirePermissions('reports.view')
  cashflow(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('groupBy') groupBy?: string,
  ) {
    return this.reports.cashflow(
      user.companyId,
      from,
      to,
      branchId,
      this.parseGroupBy(groupBy),
    );
  }

  @Get('receivables')
  @RequirePermissions('reports.view')
  receivables(
    @CurrentUser() user: JwtUser,
    @Query('branchId') branchId?: string,
  ) {
    return this.reports.receivables(user.companyId, branchId);
  }

  @Get('debts')
  @RequirePermissions('reports.view')
  debts(@CurrentUser() user: JwtUser) {
    return this.reports.debts(user.companyId);
  }

  @Get('payables')
  @RequirePermissions('reports.view')
  payables(@CurrentUser() user: JwtUser) {
    return this.reports.payables(user.companyId);
  }

  @Get('purchasing')
  @RequirePermissions('reports.view')
  purchasing(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('supplierId') supplierId?: string,
  ) {
    return this.reports.purchasing(
      user.companyId,
      from,
      to,
      branchId,
      supplierId,
    );
  }

  @Get('inventory')
  @RequirePermissions('reports.view')
  inventory(
    @CurrentUser() user: JwtUser,
    @Query('branchId') branchId?: string,
  ) {
    return this.reports.inventory(user.companyId, branchId);
  }

  @Get('stock-movements')
  @RequirePermissions('reports.view')
  stockMovements(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('productId') productId?: string,
    @Query('type') type?: string,
  ) {
    return this.reports.stockMovements(
      user.companyId,
      from,
      to,
      branchId,
      productId,
      type,
    );
  }

  @Get('production')
  @RequirePermissions('reports.view')
  production(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.reports.production(user.companyId, from, to, branchId);
  }

  @Get('equipment-load')
  @RequirePermissions('reports.view')
  equipmentLoad(
    @CurrentUser() user: JwtUser,
    @Query('branchId') branchId?: string,
  ) {
    return this.reports.equipmentLoad(user.companyId, branchId);
  }

  @Get('staff')
  @RequirePermissions('reports.view')
  staff(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.reports.staffPerformance(user.companyId, from, to, branchId);
  }

  @Get('orders')
  @RequirePermissions('reports.view')
  orders(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('urgency') urgency?: string,
    @Query('clientId') clientId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reports.ordersRegistry(
      user.companyId,
      from,
      to,
      branchId,
      status,
      type,
      paymentStatus,
      urgency,
      clientId,
      limit ? Number(limit) : 500,
    );
  }

  private parseGroupBy(g?: string): 'day' | 'week' | 'month' {
    return g === 'week' || g === 'month' ? g : 'day';
  }

  private parseType(t?: string): 'SERVICE' | 'PRODUCT' | 'all' {
    return t === 'SERVICE' || t === 'PRODUCT' ? t : 'all';
  }
}
