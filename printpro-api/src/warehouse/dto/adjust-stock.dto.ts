import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { StockMovementType } from '@prisma/client';

// Списание / корректировка остатка
export class AdjustStockDto {
  @IsString() companyId: string;
  @IsString() branchId: string;
  @IsString() productId: string;

  @IsNumber() @Min(0.001) quantity: number;

  // WRITE_OFF — списание, ADJUST — корректировка
  @IsEnum(StockMovementType) type: StockMovementType;

  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() idempotencyKey?: string;
}
