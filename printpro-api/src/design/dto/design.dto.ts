import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import { ProofStatus } from '@prisma/client';

export class CreateProofDto {
  @IsString() orderId: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() assignedUserId?: string;
  @IsOptional() @IsString() fileUrl?: string;
  @IsOptional() @IsString() fileName?: string;
}

export class UpdateProofDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() assignedUserId?: string;
  // Если передан новый файл — версия увеличится
  @IsOptional() @IsString() fileUrl?: string;
  @IsOptional() @IsString() fileName?: string;
  @IsOptional() @IsString() comment?: string;
  @IsOptional() @IsObject() checklist?: Record<string, boolean>;
}

export class UpdateProofStatusDto {
  @IsEnum(ProofStatus) status: ProofStatus;
  @IsOptional() @IsString() comment?: string;
}
