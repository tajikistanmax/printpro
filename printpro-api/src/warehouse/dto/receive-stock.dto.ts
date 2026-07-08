import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

// Приём товара на склад (приход)
export class ReceiveStockDto {
  @IsString() companyId: string;
  @IsString() branchId: string; // на какой склад/филиал
  @IsString() productId: string;

  @IsNumber() @Min(0.001) quantity: number; // сколько пришло

  @IsOptional() @IsNumber() cost?: number; // закупочная цена за единицу
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() userId?: string;
  // Идемпотентность: повтор с тем же ключом (двойной клик/ретрай) не задваивает приход.
  @IsOptional() @IsString() idempotencyKey?: string;
}
