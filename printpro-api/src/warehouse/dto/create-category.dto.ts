import { IsOptional, IsString } from 'class-validator';

export class CreateCategoryDto {
  @IsString() companyId: string;
  @IsString() name: string;
  // Родительская категория (для подкатегорий); пусто — верхний уровень
  @IsOptional() @IsString() parentId?: string;
}
