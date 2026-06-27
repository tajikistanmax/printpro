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

// Быстрая продажа (POS): создать заказ + сразу оплатить + выдать
export class QuickSaleDto {
  @IsString() companyId: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() clientPhone?: string;
  @IsOptional() @IsString() clientName?: string;
  @IsOptional() @IsNumber() @Min(0) discount?: number; // скидка, абсолютная
  @IsEnum(PaymentMethod) method: PaymentMethod;

  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderItemDto)
  items: OrderItemDto[];
}
