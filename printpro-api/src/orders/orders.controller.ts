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
import { AddPaymentDto, UpdateStatusDto } from './dto/order-actions.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';

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

  // Список заказов
  @Get()
  @RequirePermissions('orders.view')
  findAll(
    @Query('companyId') companyId: string,
    @Query('status') status?: OrderStatus,
  ) {
    return this.orders.findAll(companyId, status);
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
  addPayment(@Param('id') id: string, @Body() dto: AddPaymentDto) {
    return this.orders.addPayment(id, dto);
  }

  // Смена статуса
  @Patch(':id/status')
  @RequirePermissions('orders.manage')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto) {
    return this.orders.updateStatus(id, dto.status);
  }
}
