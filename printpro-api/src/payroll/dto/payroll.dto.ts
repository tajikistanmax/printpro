import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { SalaryType } from '@prisma/client';

export class SetSalaryDto {
  @IsOptional() @IsString() position?: string;
  @IsOptional() @IsEnum(SalaryType) salaryType?: SalaryType;
  @IsOptional() @IsNumber() @Min(0) rate?: number;
}

export class AddWorkTimeDto {
  @IsString() companyId: string;
  @IsString() userId: string;
  @IsOptional() @IsString() date?: string;
  @IsNumber() @Min(0) hours: number;
  @IsOptional() @IsString() note?: string;
}

export class AddAdvanceDto {
  @IsString() companyId: string;
  @IsString() userId: string;
  @IsNumber() @Min(0.01) amount: number;
  @IsOptional() @IsString() note?: string;
}

export class CreatePeriodDto {
  @IsString() companyId: string;
  @IsString() name: string;
  @IsString() startDate: string;
  @IsString() endDate: string;
}

export class UpdateRecordDto {
  @IsOptional() @IsNumber() @Min(0) bonus?: number;
  @IsOptional() @IsNumber() @Min(0) deduction?: number;
}
