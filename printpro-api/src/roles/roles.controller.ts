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
import { CurrentUser } from '../auth/current-user.decorator';

interface JwtUser {
  sub: string;
  companyId: string;
}

// companyId только из токена — чужие роли недоступны
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
  findRoles(@CurrentUser() user: JwtUser) {
    return this.roles.findRoles(user.companyId);
  }

  // Создать роль
  @Post('roles')
  @RequirePermissions('roles.manage')
  createRole(@Body() dto: CreateRoleDto, @CurrentUser() user: JwtUser) {
    return this.roles.createRole(dto, user.companyId);
  }

  // Установить права роли (галочки)
  @Put('roles/:id/permissions')
  @RequirePermissions('roles.manage')
  setPermissions(
    @Param('id') id: string,
    @Body() dto: SetPermissionsDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.roles.setPermissions(id, dto.permissionCodes, user.companyId);
  }
}
