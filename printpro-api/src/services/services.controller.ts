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

@Controller('services')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Post()
  @RequirePermissions('services.manage')
  create(@Body() dto: CreateServiceDto, @CurrentUser() user: JwtUser) {
    return this.servicesService.create({ ...dto, companyId: user.companyId });
  }

  @Get()
  @RequirePermissions('services.view')
  findAll(@CurrentUser() user: JwtUser) {
    return this.servicesService.findAll(user.companyId);
  }

  @Get(':id')
  @RequirePermissions('services.view')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.servicesService.findOne(id, user.companyId);
  }

  @Patch(':id')
  @RequirePermissions('services.manage')
  update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateServiceDto>,
    @CurrentUser() user: JwtUser,
  ) {
    return this.servicesService.update(id, user.companyId, dto);
  }

  @Post(':id/materials')
  @RequirePermissions('services.manage')
  addMaterial(
    @Param('id') id: string,
    @Body() body: { productId: string; qtyPerUnit: number },
    @CurrentUser() user: JwtUser,
  ) {
    return this.servicesService.addMaterial(
      id,
      user.companyId,
      body.productId,
      body.qtyPerUnit,
    );
  }

  @Delete('materials/:materialId')
  @RequirePermissions('services.manage')
  removeMaterial(
    @Param('materialId') materialId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.servicesService.removeMaterial(materialId, user.companyId);
  }

  @Delete(':id')
  @RequirePermissions('services.manage')
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.servicesService.remove(id, user.companyId);
  }
}
