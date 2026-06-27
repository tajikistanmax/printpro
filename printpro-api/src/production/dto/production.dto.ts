import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ProductionStatus } from '@prisma/client';

// Создать производственное задание из заказа
export class CreateProductionJobDto {
  @IsString() companyId: string;
  @IsString() orderId: string;
  @IsOptional() @IsString() assignedUserId?: string;
  @IsOptional() @IsString() printer?: string;
  @IsOptional() @IsInt() @Min(0) priority?: number;
  @IsOptional() @IsString() note?: string;
}

// Обновить задание (назначение/принтер/приоритет/заметка)
export class UpdateProductionJobDto {
  @IsOptional() @IsString() assignedUserId?: string;
  @IsOptional() @IsString() printer?: string;
  @IsOptional() @IsInt() @Min(0) priority?: number;
  @IsOptional() @IsString() note?: string;
}

// Сменить статус задания
export class UpdateProductionStatusDto {
  @IsEnum(ProductionStatus) status: ProductionStatus;
}
