import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

// Списание товара со склада (бой / брак / порча)
export class WriteOffDto {
  @IsString() companyId: string;
  @IsString() branchId: string;
  @IsString() productId: string;
  @IsNumber() @Min(0.001) quantity: number;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() idempotencyKey?: string;
}
