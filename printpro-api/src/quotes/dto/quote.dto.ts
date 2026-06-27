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
import { ItemType, QuoteStatus } from '@prisma/client';

export class QuoteItemDto {
  @IsEnum(ItemType) itemType: ItemType;
  @IsOptional() @IsString() serviceId?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() @Min(0.001) quantity: number;
  @IsNumber() @Min(0) unitPrice: number;
}

export class CreateQuoteDto {
  @IsString() companyId: string;
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() clientPhone?: string;
  @IsOptional() @IsString() clientName?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() validUntil?: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => QuoteItemDto)
  items: QuoteItemDto[];
}

export class UpdateQuoteStatusDto {
  @IsEnum(QuoteStatus) status: QuoteStatus;
}
