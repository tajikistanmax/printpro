import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DiscountType } from '@prisma/client';
import { PromocodesService } from './promocodes.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';

@Controller('promocodes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PromocodesController {
  constructor(private readonly promo: PromocodesService) {}

  @Get()
  @RequirePermissions('orders.view')
  findAll(@Query('companyId') companyId: string) {
    return this.promo.findAll(companyId);
  }

  @Post()
  @RequirePermissions('orders.manage')
  create(
    @Body()
    dto: {
      companyId: string;
      code: string;
      discountType?: DiscountType;
      value: number;
      maxUses?: number | null;
      validUntil?: string;
    },
  ) {
    return this.promo.create(dto);
  }

  // Проверить промокод (для кассы) — без списания
  @Post('validate')
  @RequirePermissions('cash.operate')
  validate(
    @Body() body: { companyId: string; code: string; subtotal: number },
  ) {
    return this.promo.validate(body.companyId, body.code, body.subtotal);
  }

  @Delete(':id')
  @RequirePermissions('orders.manage')
  remove(@Param('id') id: string) {
    return this.promo.remove(id);
  }
}
