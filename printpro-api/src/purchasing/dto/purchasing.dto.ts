import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
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
  @IsOptional() @IsString() inn?: string;
  @IsOptional() @IsString() note?: string;
}

export class UpdateSupplierDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() inn?: string;
  @IsOptional() @IsString() note?: string;
}

// Оплата долга поставщику
export class PaySupplierDebtDto {
  @IsNumber() @Min(0.01) amount: number;
  @IsOptional() @IsString() note?: string;
}

// ----- Приёмка товара -----
export class ReceiptItemDto {
  @IsString() productId: string;
  @IsNumber() @Min(0.001) quantity: number;
  // Закупочная цена за единицу
  @IsOptional() @IsNumber() @Min(0) cost?: number;
  // Новая цена продажи товара (если задана — обновит цену товара)
  @IsOptional() @IsNumber() @Min(0) salePrice?: number;
}

export class CreateReceiptDto {
  @IsString() companyId: string;
  @IsString() branchId: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() note?: string;
  // Сколько сразу оплатили поставщику. Если не указано — считаем оплаченным полностью.
  @IsOptional() @IsNumber() @Min(0) paidAmount?: number;
  // Срок оплаты долга поставщику (если приняли частично/в долг)
  @IsOptional() @IsDateString() dueDate?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiptItemDto)
  items: ReceiptItemDto[];
}
