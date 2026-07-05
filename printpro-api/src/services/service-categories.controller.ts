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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

interface JwtUser {
  sub: string;
  companyId: string;
}

@Controller('service-categories')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ServiceCategoriesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Post()
  @RequirePermissions('services.manage')
  create(
    @Body() dto: { companyId: string; name: string; parentId?: string },
    @CurrentUser() user: JwtUser,
  ) {
    return this.servicesService.createCategory({
      ...dto,
      companyId: user.companyId,
    });
  }

  @Get()
  @RequirePermissions('services.view')
  findAll(@CurrentUser() user: JwtUser) {
    return this.servicesService.findCategories(user.companyId);
  }

  @Patch(':id')
  @RequirePermissions('services.manage')
  update(
    @Param('id') id: string,
    @Body() dto: { name?: string; isDefault?: boolean; parentId?: string | null },
    @CurrentUser() user: JwtUser,
  ) {
    return this.servicesService.updateCategory(id, user.companyId, dto);
  }

  @Delete(':id')
  @RequirePermissions('services.manage')
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.servicesService.removeCategory(id, user.companyId);
  }
}
