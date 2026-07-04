import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { PricingService, type PriceInput } from './pricing.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

interface JwtUser {
  sub: string;
  companyId: string;
}

// Предпросчёт цены услуги. companyId — из токена (услугу считаем только свою).
// Только чтение/расчёт: заказ не создаётся, склад/касса не трогаются.
@Controller('pricing')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Post('preview')
  @RequirePermissions('orders.view', 'orders.manage', 'services.view')
  preview(
    @CurrentUser() user: JwtUser,
    @Body() body: PriceInput,
  ) {
    return this.pricing.preview(user.companyId, body);
  }
}
