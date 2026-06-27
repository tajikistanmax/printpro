import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { OrderStatus, PaymentMethod } from '@prisma/client';

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
