import { IsArray, IsString } from 'class-validator';

export class CreateRoleDto {
  @IsString() name: string;
}

// Установить набор прав роли (полная замена) — это и есть «галочки»
export class SetPermissionsDto {
  @IsArray()
  @IsString({ each: true })
  permissionCodes: string[];
}
