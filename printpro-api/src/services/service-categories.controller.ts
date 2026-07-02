import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ServicesService } from './services.service';

// Маршруты категорий услуг: /service-categories
@Controller('service-categories')
export class ServiceCategoriesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Post()
  create(@Body() dto: { companyId: string; name: string; parentId?: string }) {
    return this.servicesService.createCategory(dto);
  }

  @Get()
  findAll(@Query('companyId') companyId: string) {
    return this.servicesService.findCategories(companyId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: { name?: string; isDefault?: boolean; parentId?: string | null },
  ) {
    return this.servicesService.updateCategory(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.servicesService.removeCategory(id);
  }
}
