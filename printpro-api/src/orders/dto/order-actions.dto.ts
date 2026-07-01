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

// Возврат по чеку/заказу (частичный): какие позиции и сколько вернуть
export class ReturnItemDto {
  @IsString() orderItemId: string;
  @IsNumber() @Min(0.001) quantity: number;
}

export class CreateReturnDto {
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ReturnItemDto)
  items: ReturnItemDto[];
}

// Сменить статус заказа
export class UpdateStatusDto {
  @IsEnum(OrderStatus) status: OrderStatus;
  @IsOptional() @IsString() reason?: string;
}

// Часть смешанной оплаты
export class PaymentPartDto {
  @IsEnum(PaymentMethod) method: PaymentMethod;
  @IsNumber() @Min(0.01) amount: number;
}

// Отложенный чек (held): сохранить корзину, чтобы вернуться позже
export class HoldSaleDto {
  @IsString() companyId: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsNumber() total?: number;
  items: any; // снимок корзины (JSON)
}

// Быстрая продажа (POS): создать заказ + сразу оплатить + выдать
export class QuickSaleDto {
  @IsString() companyId: string;
  @IsOptional() @IsString() branchId?: string;
  // Ключ идемпотентности (POS присылает uuid на каждую попытку оплаты)
  @IsOptional() @IsString() idempotencyKey?: string;
  @IsOptional() @IsString() clientPhone?: string;
  @IsOptional() @IsString() clientName?: string;
  @IsOptional() @IsNumber() @Min(0) discount?: number; // скидка, абсолютная
  @IsOptional() @IsString() promoCode?: string; // промокод
  @IsOptional() @IsNumber() @Min(0) useBonus?: number; // списать бонусов
  @IsOptional() @IsString() note?: string; // примечание к заказу
  @IsOptional() @IsString() debtDueDate?: string; // срок погашения долга (для «в долг»)

  // Один способ оплаты…
  @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  // …или смешанная оплата несколькими способами
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PaymentPartDto)
  payments?: PaymentPartDto[];

  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderItemDto)
  items: OrderItemDto[];
}
