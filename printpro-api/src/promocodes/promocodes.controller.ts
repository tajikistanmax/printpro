import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PromocodesService } from './promocodes.service';
import { CreatePromocodeDto } from './dto/create-promocode.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('promocodes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PromocodesController {
  constructor(private readonly promo: PromocodesService) {}

  @Get()
  @RequirePermissions('orders.view')
  findAll(@CurrentUser() user: { sub: string; companyId: string }) {
    return this.promo.findAll(user.companyId);
  }

  @Post()
  @RequirePermissions('orders.manage')
  create(
    @CurrentUser() user: { sub: string; companyId: string },
    @Body() dto: CreatePromocodeDto,
  ) {
    return this.promo.create(user.companyId, dto);
  }

  // Проверить промокод (для кассы) — без списания
  @Post('validate')
  @RequirePermissions('cash.operate')
  validate(
    @CurrentUser() user: { sub: string; companyId: string },
    @Body() body: { code: string; subtotal: number },
  ) {
    return this.promo.validate(user.companyId, body.code, body.subtotal);
  }

  @Delete(':id')
  @RequirePermissions('orders.manage')
  remove(
    @CurrentUser() user: { sub: string; companyId: string },
    @Param('id') id: string,
  ) {
    return this.promo.remove(user.companyId, id);
  }
}
