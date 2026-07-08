import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('settings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  // companyId — строго из токена: нельзя читать/перезаписывать настройки чужой компании.
  @Get()
  @RequirePermissions('settings.manage')
  getAll(@CurrentUser() user: { companyId: string }) {
    return this.settings.getAll(user.companyId);
  }

  // Платёжные реквизиты для чека/кассы. Только вход (без settings.manage),
  // чтобы кассир мог их получить, но НЕ анонимно (защита от утечки по companyId).
  @Get('receipt-info')
  getReceiptInfo(@CurrentUser() user: { companyId: string }) {
    return this.settings.getReceiptInfo(user.companyId);
  }

  @Put()
  @RequirePermissions('settings.manage')
  setMany(
    @CurrentUser() user: { companyId: string },
    @Body() body: { values: Record<string, string> },
  ) {
    return this.settings.setMany(user.companyId, body.values ?? {});
  }
}
