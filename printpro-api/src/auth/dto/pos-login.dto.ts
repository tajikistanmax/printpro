import { IsString, Matches } from 'class-validator';

// Вход кассира по PIN (4–6 цифр)
export class PosLoginDto {
  @IsString() companyId: string;
  @IsString() @Matches(/^\d{4,6}$/, { message: 'PIN — 4–6 цифр' }) pin: string;
}
