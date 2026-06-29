import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateProductDto {
  @IsString() companyId: string;
  @IsString() name: string;

  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() unitId?: string;

  @IsOptional() @IsNumber() salePrice?: number;
  @IsOptional() @IsNumber() @Min(0) purchasePrice?: number; // закупочная цена / себестоимость

  // Порог оповещения: если остаток <= minStock — система предупредит
  @IsOptional() @IsNumber() @Min(0) minStock?: number;

  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() size?: string;
  @IsOptional() @IsString() weight?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
