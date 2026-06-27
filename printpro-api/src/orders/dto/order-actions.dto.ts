import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OrderStatus, PaymentMethod } from '@prisma/client';
import { OrderItemDto } from './create-order.dto';

// Добавить оплату к заказу (касса)
export class AddPaymentDto {
  @IsNumber() @Min(0.01) amount: number;
  @IsEnum(PaymentMethod) method: PaymentMethod;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() shiftId?: string;
}

// Сменить статус заказа
export class UpdateStatusDto {
  @IsEnum(OrderStatus) status: OrderStatus;
}

// Часть смешанной оплаты
export class PaymentPartDto {
  @IsEnum(PaymentMethod) method: PaymentMethod;
  @IsNumber() @Min(0.01) amount: number;
}

// Быстрая продажа (POS): создать заказ + сразу оплатить + выдать
export class QuickSaleDto {
  @IsString() companyId: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() clientPhone?: string;
  @IsOptional() @IsString() clientName?: string;
  @IsOptional() @IsNumber() @Min(0) discount?: number; // скидка, абсолютная
  @IsOptional() @IsString() promoCode?: string; // промокод
  @IsOptional() @IsNumber() @Min(0) useBonus?: number; // списать бонусов

  // Один способ оплаты…
  @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  // …или смешанная оплата несколькими способами
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PaymentPartDto)
  payments?: PaymentPartDto[];

  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderItemDto)
  items: OrderItemDto[];
}
