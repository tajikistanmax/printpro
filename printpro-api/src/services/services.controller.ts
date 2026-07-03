import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

interface JwtUser {
  sub: string;
  companyId: string;
}

// Маршруты (API) для услуг: /services — companyId только из токена
@Controller('services')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  // POST /services — создать услугу
  @Post()
  @RequirePermissions('services.manage')
  create(@Body() dto: CreateServiceDto, @CurrentUser() user: JwtUser) {
    return this.servicesService.create({ ...dto, companyId: user.companyId });
  }

  // GET /services — список услуг
  @Get()
  @RequirePermissions('services.view')
  findAll(@CurrentUser() user: JwtUser) {
    return this.servicesService.findAll(user.companyId);
  }

  // GET /services/:id — одна услуга
  @Get(':id')
  @RequirePermissions('services.view')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.servicesService.findOne(id, user.companyId);
  }

  // PATCH /services/:id — изменить услугу (в т.ч. себестоимость)
  @Patch(':id')
  @RequirePermissions('services.manage')
  update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateServiceDto>,
    @CurrentUser() user: JwtUser,
  ) {
    return this.servicesService.update(id, dto, user.companyId);
  }

  // POST /services/:id/materials — добавить/обновить норму расхода материала
  @Post(':id/materials')
  @RequirePermissions('services.manage')
  addMaterial(
    @Param('id') id: string,
    @Body() body: { productId: string; qtyPerUnit: number },
    @CurrentUser() user: JwtUser,
  ) {
    return this.servicesService.addMaterial(
      id,
      body.productId,
      body.qtyPerUnit,
      user.companyId,
    );
  }

  // DELETE /services/materials/:materialId — убрать материал из спецификации
  @Delete('materials/:materialId')
  @RequirePermissions('services.manage')
  removeMaterial(
    @Param('materialId') materialId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.servicesService.removeMaterial(materialId, user.companyId);
  }

  // DELETE /services/:id — удалить услугу
  @Delete(':id')
  @RequirePermissions('services.manage')
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.servicesService.remove(id, user.companyId);
  }
}
