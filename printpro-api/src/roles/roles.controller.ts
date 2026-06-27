import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto, SetPermissionsDto } from './dto/role.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  // Справочник всех прав (для галочек)
  @Get('permissions')
  @RequirePermissions('roles.manage')
  allPermissions() {
    return this.roles.allPermissions();
  }

  // Роли компании
  @Get('roles')
  @RequirePermissions('roles.manage')
  findRoles(@Query('companyId') companyId: string) {
    return this.roles.findRoles(companyId);
  }

  // Создать роль
  @Post('roles')
  @RequirePermissions('roles.manage')
  createRole(@Body() dto: CreateRoleDto) {
    return this.roles.createRole(dto);
  }

  // Установить права роли (галочки)
  @Put('roles/:id/permissions')
  @RequirePermissions('roles.manage')
  setPermissions(@Param('id') id: string, @Body() dto: SetPermissionsDto) {
    return this.roles.setPermissions(id, dto.permissionCodes);
  }
}
