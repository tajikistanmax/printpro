import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';

// Маршруты (API) для услуг: /services
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  // POST /services — создать услугу
  @Post()
  create(@Body() dto: CreateServiceDto) {
    return this.servicesService.create(dto);
  }

  // GET /services?companyId=... — список услуг
  @Get()
  findAll(@Query('companyId') companyId: string) {
    return this.servicesService.findAll(companyId);
  }

  // GET /services/:id — одна услуга
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.servicesService.findOne(id);
  }

  // PATCH /services/:id — изменить услугу (в т.ч. себестоимость)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateServiceDto>) {
    return this.servicesService.update(id, dto);
  }

  // POST /services/:id/materials — добавить/обновить норму расхода материала
  @Post(':id/materials')
  addMaterial(
    @Param('id') id: string,
    @Body() body: { productId: string; qtyPerUnit: number },
  ) {
    return this.servicesService.addMaterial(id, body.productId, body.qtyPerUnit);
  }

  // DELETE /services/materials/:materialId — убрать материал из спецификации
  @Delete('materials/:materialId')
  removeMaterial(@Param('materialId') materialId: string) {
    return this.servicesService.removeMaterial(materialId);
  }

  // DELETE /services/:id — удалить услугу
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.servicesService.remove(id);
  }
}
