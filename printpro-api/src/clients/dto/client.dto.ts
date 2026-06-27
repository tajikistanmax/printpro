import {
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ClientType } from '@prisma/client';

export class CreateClientDto {
  @IsString() companyId: string;
  @IsString() phone: string;
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsEnum(ClientType) type?: ClientType;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() inn?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) discount?: number;
  @IsOptional() @IsNumber() @Min(0) creditLimit?: number;
  @IsOptional() @IsString() note?: string;
}

export class UpdateClientDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEnum(ClientType) type?: ClientType;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() inn?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) discount?: number;
  @IsOptional() @IsNumber() @Min(0) creditLimit?: number;
  @IsOptional() @IsString() note?: string;
}
