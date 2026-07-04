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
import { EquipmentService } from './equipment.service';
import { CreateEquipmentDto, UpdateEquipmentDto } from './dto/equipment.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

interface JwtUser {
  sub: string;
  companyId: string;
}

// companyId только из токена — чужое оборудование недоступно
@Controller('equipment')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EquipmentController {
  constructor(private readonly equipment: EquipmentService) {}

  // Список оборудования (для производства достаточно права просмотра)
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
    return this.equipment.create(dto, user.companyId);
  }

  @Patch(':id')
  @RequirePermissions('settings.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEquipmentDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.equipment.update(id, dto, user.companyId);
  }

  @Delete(':id')
  @RequirePermissions('settings.manage')
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.equipment.remove(id, user.companyId);
  }
}
