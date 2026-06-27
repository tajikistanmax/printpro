import { IsString } from 'class-validator';

export class CreateCategoryDto {
  @IsString() companyId: string;
  @IsString() name: string;
}
