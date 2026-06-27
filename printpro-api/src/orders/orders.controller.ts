import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  AddPaymentDto,
  QuickSaleDto,
  UpdateStatusDto,
} from './dto/order-actions.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  // Создать заказ (продажа / печать / ремонт / восстановление)
  @Post()
  @RequirePermissions('orders.manage')
  create(@Body() dto: CreateOrderDto) {
    return this.orders.create(dto);
  }

  // Быстрая продажа (POS): создать + оплатить + выдать
  @Post('quick-sale')
  @RequirePermissions('cash.operate')
  quickSale(@Body() dto: QuickSaleDto, @CurrentUser() user: { sub: string }) {
    return this.orders.quickSale(dto, user.sub);
  }

  // Возврат заказа
  @Post(':id/refund')
  @RequirePermissions('cash.operate')
  refund(@Param('id') id: string) {
    return this.orders.refund(id);
  }

  // Повторить заказ (создать копию)
  @Post(':id/reorder')
  @RequirePermissions('orders.manage')
  reorder(@Param('id') id: string) {
    return this.orders.reorder(id);
  }

  // Список заказов (постранично)
  @Get()
  @RequirePermissions('orders.view')
  findAll(
    @Query('companyId') companyId: string,
    @Query('status') status?: OrderStatus,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
  ) {
    return this.orders.findAll(
      companyId,
      status,
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 25,
      search,
    );
  }

  // Долги (кто сколько должен)
  @Get('debts')
  @RequirePermissions('orders.view')
  debts(@Query('companyId') companyId: string) {
    return this.orders.debts(companyId);
  }

  // Один заказ
  @Get(':id')
  @RequirePermissions('orders.view')
  findOne(@Param('id') id: string) {
    return this.orders.findOne(id);
  }

  // Оплата (касса)
  @Post(':id/payments')
  @RequirePermissions('cash.operate')
  addPayment(
    @Param('id') id: string,
    @Body() dto: AddPaymentDto,
    @CurrentUser() user: { sub: string },
  ) {
    return this.orders.addPayment(id, dto, user.sub);
  }

  // Смена статуса
  @Patch(':id/status')
  @RequirePermissions('orders.manage')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() user: { sub: string },
  ) {
    return this.orders.updateStatus(id, dto.status, user.sub, dto.reason);
  }
}
