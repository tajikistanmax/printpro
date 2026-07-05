import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { EquipmentStatus } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CreateEquipmentDto, UpdateEquipmentDto } from './dto/equipment.dto';
import { EquipmentService } from './equipment.service';

interface JwtUser {
  sub: string;
  companyId: string;
}

@Controller('equipment')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EquipmentController {
  constructor(private readonly equipment: EquipmentService) {}

  @Get()
  @RequirePermissions('production.view')
  findAll(
    @CurrentUser() user: JwtUser,
    @Query('status') status?: EquipmentStatus,
  ) {
    return this.equipment.findAll(user.companyId, status);
  }

  @Post()
  @RequirePermissions('settings.manage')
  create(@Body() dto: CreateEquipmentDto, @CurrentUser() user: JwtUser) {
    return this.equipment.create({ ...dto, companyId: user.companyId });
  }

  @Patch(':id')
  @RequirePermissions('settings.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEquipmentDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.equipment.update(id, user.companyId, dto);
  }

  @Delete(':id')
  @RequirePermissions('settings.manage')
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.equipment.remove(id, user.companyId);
  }
}
