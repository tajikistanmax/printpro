import { IsEnum, IsOptional, IsString } from 'class-validator';
import { EquipmentStatus } from '@prisma/client';

export class CreateEquipmentDto {
  @IsOptional() @IsString() branchId?: string;
  @IsString() name: string;
  @IsOptional() @IsString() type?: string; // принтер, плоттер, ламинатор…
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() serial?: string;
  @IsOptional() @IsEnum(EquipmentStatus) status?: EquipmentStatus;
  @IsOptional() @IsString() note?: string;
}

export class UpdateEquipmentDto {
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() serial?: string;
  @IsOptional() @IsEnum(EquipmentStatus) status?: EquipmentStatus;
  @IsOptional() @IsString() note?: string;
}
