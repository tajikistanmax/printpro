import { IsString } from 'class-validator';

export class LoginDto {
  @IsString() companyId: string;
  @IsString() login: string;
  @IsString() password: string;
}
