import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

// ----- Поставщики -----
export class CreateSupplierDto {
  @IsString() companyId: string;
  @IsString() name: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() note?: string;
}

export class UpdateSupplierDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() note?: string;
}

// ----- Приёмка товара -----
export class ReceiptItemDto {
  @IsString() productId: string;
  @IsNumber() @Min(0.001) quantity: number;
  // Закупочная цена за единицу
  @IsOptional() @IsNumber() @Min(0) cost?: number;
}

export class CreateReceiptDto {
  @IsString() companyId: string;
  @IsString() branchId: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() note?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiptItemDto)
  items: ReceiptItemDto[];
}
