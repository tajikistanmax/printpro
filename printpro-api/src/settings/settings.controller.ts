import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';

@Controller('settings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions('settings.manage')
  getAll(@Query('companyId') companyId: string) {
    return this.settings.getAll(companyId);
  }

  @Put()
  @RequirePermissions('settings.manage')
  setMany(
    @Body() body: { companyId: string; values: Record<string, string> },
  ) {
    return this.settings.setMany(body.companyId, body.values ?? {});
  }
}
