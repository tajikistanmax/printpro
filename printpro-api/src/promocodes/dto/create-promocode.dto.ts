import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { DiscountType } from '@prisma/client';

// Создание промокода. companyId берётся из токена (не из тела запроса).
export class CreatePromocodeDto {
  @IsString() @IsNotEmpty() code: string;

  @IsOptional()
  @IsEnum(DiscountType, {
    message: 'discountType должен быть PERCENT или FIXED',
  })
  discountType?: DiscountType;

  @IsNumber() @Min(0) value: number;

  @IsOptional() @IsInt() @Min(1) maxUses?: number | null;

  @IsOptional() @IsString() validFrom?: string;
  @IsOptional() @IsString() validUntil?: string;
}
