import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrderStatus, OrderType } from '@prisma/client';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  AddPaymentDto,
  QuickSaleDto,
  HoldSaleDto,
  CreateReturnDto,
  UpdateStatusDto,
} from './dto/order-actions.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

// Данные пользователя из токена (см. auth.service: payload)
interface JwtUser {
  sub: string;
  companyId: string;
}

@Controller('orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  // Создать заказ (продажа / печать / ремонт / восстановление).
  // companyId берём из токена, не из тела — иначе можно создать заказ в чужой компании.
  @Post()
  @RequirePermissions('orders.manage')
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: JwtUser) {
    return this.orders.create({ ...dto, companyId: user.companyId });
  }

  // Быстрая продажа (POS): создать + оплатить + выдать
  @Post('quick-sale')
  @RequirePermissions('cash.operate')
  quickSale(@Body() dto: QuickSaleDto, @CurrentUser() user: JwtUser) {
    return this.orders.quickSale({ ...dto, companyId: user.companyId }, user.sub);
  }

  // Отложенные чеки (POS) — объявлены ДО :id-маршрутов, чтобы 'held' не попал в :id
  @Post('held')
  @RequirePermissions('cash.operate')
  hold(@Body() dto: HoldSaleDto, @CurrentUser() user: JwtUser) {
    return this.orders.holdSale({ ...dto, companyId: user.companyId }, user.sub);
  }

  @Get('held')
  @RequirePermissions('cash.operate')
  listHeld(@CurrentUser() user: JwtUser) {
    return this.orders.listHeld(user.companyId);
  }

  @Delete('held/:id')
  @RequirePermissions('cash.operate')
  deleteHeld(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.orders.deleteHeld(id, user.companyId);
  }

  // Список возвратов (до :id-маршрутов)
  @Get('returns')
  @RequirePermissions('orders.view')
  listReturns(@CurrentUser() user: JwtUser) {
    return this.orders.listReturns(user.companyId);
  }

  // Частичный возврат по заказу
  @Post(':id/return')
  @RequirePermissions('cash.operate')
  createReturn(
    @Param('id') id: string,
    @Body() dto: CreateReturnDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.orders.createReturn(id, dto, user.sub, user.companyId);
  }

  // Возврат заказа
  @Post(':id/refund')
  @RequirePermissions('cash.operate')
  refund(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.orders.refund(id, user.sub, user.companyId);
  }

  // Повторить заказ (создать копию)
  @Post(':id/reorder')
  @RequirePermissions('orders.manage')
  reorder(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.orders.reorder(id, user.companyId);
  }

  // Список заказов (постранично, с фильтрами)
  @Get()
  @RequirePermissions('orders.view')
  findAll(
    @CurrentUser() user: JwtUser,
    @Query('status') status?: OrderStatus,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('orderType') orderType?: OrderType,
    @Query('managerId') managerId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.orders.findAll(user.companyId, {
      status,
      orderType,
      managerId,
      search,
      dateFrom,
      dateTo,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 25,
    });
  }

  // Сводка по статусам и суммам (карточки на странице «Заказы»)
  @Get('stats')
  @RequirePermissions('orders.view')
  stats(
    @CurrentUser() user: JwtUser,
    @Query('orderType') orderType?: OrderType,
    @Query('managerId') managerId?: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.orders.stats(user.companyId, {
      orderType,
      managerId,
      search,
      dateFrom,
      dateTo,
    });
  }

  // Долги (кто сколько должен)
  @Get('debts')
  @RequirePermissions('orders.view')
  debts(@CurrentUser() user: JwtUser) {
    return this.orders.debts(user.companyId);
  }

  // Один заказ
  @Get(':id')
  @RequirePermissions('orders.view')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.orders.findOne(id, user.companyId);
  }

  // Оплата (касса)
  @Post(':id/payments')
  @RequirePermissions('cash.operate')
  addPayment(
    @Param('id') id: string,
    @Body() dto: AddPaymentDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.orders.addPayment(id, dto, user.sub, user.companyId);
  }

  // Установить/изменить срок погашения долга
  @Patch(':id/debt-due')
  @RequirePermissions('cash.operate')
  setDebtDue(
    @Param('id') id: string,
    @Body() dto: { dueDate: string | null },
    @CurrentUser() user: JwtUser,
  ) {
    return this.orders.setDebtDue(id, dto.dueDate ?? null, user.companyId);
  }

  // Смена статуса
  @Patch(':id/status')
  @RequirePermissions('orders.manage')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.orders.updateStatus(id, dto.status, user.sub, dto.reason, user.companyId);
  }
}
