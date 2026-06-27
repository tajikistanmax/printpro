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

@Controller('equipment')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EquipmentController {
  constructor(private readonly equipment: EquipmentService) {}

  // Список оборудования (для производства достаточно права просмотра)
  @Get()
  @RequirePermissions('production.view')
  findAll(
    @Query('companyId') companyId: string,
    @Query('status') status?: EquipmentStatus,
  ) {
    return this.equipment.findAll(companyId, status);
  }

  @Post()
  @RequirePermissions('settings.manage')
  create(@Body() dto: CreateEquipmentDto) {
    return this.equipment.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('settings.manage')
  update(@Param('id') id: string, @Body() dto: UpdateEquipmentDto) {
    return this.equipment.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('settings.manage')
  remove(@Param('id') id: string) {
    return this.equipment.remove(id);
  }
}
