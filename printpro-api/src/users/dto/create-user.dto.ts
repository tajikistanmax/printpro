import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsString() companyId: string;
  @IsString() fullName: string;
  @IsString() login: string;
  @IsString() @MinLength(4) password: string;

  // PIN кассира (4–6 цифр) для быстрого входа на кассе — необязателен
  @IsOptional() @IsString() @Matches(/^\d{4,6}$/, { message: 'PIN — 4–6 цифр' })
  pin?: string;

  @IsOptional() @IsString() roleId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
