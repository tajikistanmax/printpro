import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';

// Все действия с сотрудниками требуют входа и права users.manage / users.view
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @RequirePermissions('users.manage')
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Get()
  @RequirePermissions('users.view')
  findAll(@Query('companyId') companyId: string) {
    return this.users.findAll(companyId);
  }

  @Patch(':id/active')
  @RequirePermissions('users.manage')
  setActive(@Param('id') id: string, @Body('isActive') isActive: boolean) {
    return this.users.setActive(id, isActive);
  }

  // Сбросить пароль сотрудника
  @Patch(':id/password')
  @RequirePermissions('users.manage')
  resetPassword(@Param('id') id: string, @Body('password') password: string) {
    return this.users.resetPassword(id, password);
  }
}
