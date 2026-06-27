import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ItemType, OrderType, OrderUrgency } from '@prisma/client';

// Позиция заказа — товар или услуга
export class OrderItemDto {
  @IsEnum(ItemType) itemType: ItemType;

  @IsOptional() @IsString() serviceId?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() description?: string;

  @IsNumber() @Min(0.001) quantity: number;
  @IsNumber() @Min(0) unitPrice: number;
  // Себестоимость за единицу. Если не передана — подставим из услуги.
  @IsOptional() @IsNumber() @Min(0) unitCost?: number;

  @IsOptional() options?: any; // выбранные опции/размер/тип бумаги
}

// Детали ремонта
class RepairDetailDto {
  @IsOptional() @IsString() deviceModel?: string;
  @IsOptional() @IsString() problem?: string;
  @IsOptional() @IsString() diagnosis?: string;
}

// Детали восстановления данных
class RecoveryDetailDto {
  @IsOptional() @IsString() deviceType?: string;
  @IsOptional() @IsString() mediaModel?: string;
  @IsOptional() @IsString() whatToRecover?: string;
}

export class CreateOrderDto {
  @IsString() companyId: string;
  @IsOptional() @IsString() branchId?: string;

  @IsEnum(OrderType) orderType: OrderType;

  // Клиент: либо существующий id, либо телефон (найдём/создадим)
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() clientPhone?: string;
  @IsOptional() @IsString() clientName?: string;

  @IsOptional() @IsString() assignedUserId?: string;
  @IsOptional() @IsString() createdById?: string;
  @IsOptional() @IsString() designerId?: string;
  @IsOptional() @IsString() operatorId?: string;

  // Характеристики заказа (п. 2.4 ТЗ)
  @IsOptional() @IsString() format?: string; // A4, A3, баннер 1x2м...
  @IsOptional() @IsString() colorMode?: string; // цветной / ч-б
  @IsOptional() @IsEnum(OrderUrgency) urgency?: OrderUrgency;

  @IsOptional() @IsString() deadline?: string; // ISO дата
  @IsOptional() @IsString() note?: string;

  // Списывать ли товары со склада (для продажи — да)
  @IsOptional() @IsBoolean() decrementStock?: boolean;

  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @IsOptional() @ValidateNested() @Type(() => RepairDetailDto)
  repairDetail?: RepairDetailDto;

  @IsOptional() @ValidateNested() @Type(() => RecoveryDetailDto)
  recoveryDetail?: RecoveryDetailDto;
}
