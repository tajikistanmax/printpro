import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

// Перемещение товара между филиалами
export class TransferStockDto {
  @IsString() companyId: string;
  @IsString() productId: string;
  @IsString() fromBranchId: string;
  @IsString() toBranchId: string;
  @IsNumber() @Min(0.001) quantity: number;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() idempotencyKey?: string;
}

// Инвентаризация: выставить фактический остаток
export class RecountStockDto {
  @IsString() companyId: string;
  @IsString() productId: string;
  @IsString() branchId: string;
  @IsNumber() @Min(0) countedQuantity: number;
  @IsOptional() @IsString() userId?: string;
}
