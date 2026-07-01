import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

// Все действия с сотрудниками требуют входа и права users.manage / users.view
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @RequirePermissions('users.manage')
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.users.create({ ...dto, companyId: user.companyId });
  }

  @Get()
  @RequirePermissions('users.view')
  findAll(@CurrentUser() user: { sub: string; companyId: string }) {
    return this.users.findAll(user.companyId);
  }

  @Patch(':id/active')
  @RequirePermissions('users.manage')
  setActive(
    @Param('id') id: string,
    @Body('isActive') isActive: boolean,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.users.setActive(id, isActive, user.companyId);
  }

  // Сбросить пароль сотрудника
  @Patch(':id/password')
  @RequirePermissions('users.manage')
  resetPassword(
    @Param('id') id: string,
    @Body('password') password: string,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.users.resetPassword(id, password, user.companyId);
  }

  // Установить / сбросить PIN кассира (пустое значение — убрать PIN)
  @Patch(':id/pin')
  @RequirePermissions('users.manage')
  setPin(
    @Param('id') id: string,
    @Body('pin') pin: string | null,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.users.setPin(id, pin ?? null, user.companyId);
  }
}
