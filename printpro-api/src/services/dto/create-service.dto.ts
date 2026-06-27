import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PricingType } from '@prisma/client';

// Тир цены по тиражу (например визитки: 100шт = X)
class PriceTierDto {
  @IsInt() @Min(1) minQty: number;
  @IsOptional() @IsInt() maxQty?: number;
  @IsNumber() price: number;
}

// Размер/формат (например фото 10x15)
class SizeDto {
  @IsString() label: string;
  @IsNumber() price: number;
}

// Опция/надбавка (тип бумаги, срочность)
class OptionDto {
  @IsString() name: string;
  @IsNumber() priceModifier: number;
}

// Норма расхода материала на единицу услуги
class MaterialDto {
  @IsString() productId: string;
  @IsNumber() @Min(0) qtyPerUnit: number;
}

export class CreateServiceDto {
  // Пока нет авторизации — компанию передаём явно. Позже возьмём из токена.
  @IsString() companyId: string;

  @IsString() name: string;

  @IsOptional() @IsString() categoryId?: string;

  // Тип расчёта цены: FIXED | QUANTITY_TIER | BY_SIZE | BY_AREA | MANUAL
  @IsEnum(PricingType) pricingType: PricingType;

  @IsOptional() @IsNumber() basePrice?: number;

  // Себестоимость — для отчёта «прибыль по заказам»
  @IsOptional() @IsNumber() @Min(0) costPrice?: number;

  // Время выполнения, минут
  @IsOptional() @IsInt() @Min(0) leadTimeMin?: number;

  // Доплата за дизайн, если у клиента нет готового макета
  @IsOptional() @IsNumber() designSurcharge?: number;

  @IsOptional() @IsInt() @Min(1) minQuantity?: number;

  @IsOptional() @IsBoolean() isActive?: boolean;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PriceTierDto)
  priceTiers?: PriceTierDto[];

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => SizeDto)
  sizes?: SizeDto[];

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OptionDto)
  options?: OptionDto[];

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => MaterialDto)
  materials?: MaterialDto[];
}
