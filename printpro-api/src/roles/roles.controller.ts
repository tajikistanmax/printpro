import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CreateRoleDto, SetPermissionsDto } from './dto/role.dto';
import { RolesService } from './roles.service';

interface JwtUser {
  sub: string;
  companyId: string;
}

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermissions('roles.manage')
  allPermissions() {
    return this.roles.allPermissions();
  }

  @Get('roles')
  @RequirePermissions('roles.manage')
  findRoles(@CurrentUser() user: JwtUser) {
    return this.roles.findRoles(user.companyId);
  }

  @Post('roles')
  @RequirePermissions('roles.manage')
  createRole(@Body() dto: CreateRoleDto, @CurrentUser() user: JwtUser) {
    return this.roles.createRole(
      { ...dto, companyId: user.companyId },
      user.sub,
    );
  }

  @Put('roles/:id/permissions')
  @RequirePermissions('roles.manage')
  setPermissions(
    @Param('id') id: string,
    @Body() dto: SetPermissionsDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.roles.setPermissions(
      id,
      user.companyId,
      dto.permissionCodes,
      user.sub,
    );
  }
}
