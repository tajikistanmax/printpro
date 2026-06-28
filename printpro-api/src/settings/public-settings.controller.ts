import { Controller, Get, Query } from '@nestjs/common';
import { SettingsService } from './settings.service';

// Публичные UI-настройки (без секретов, без права settings.manage).
// Нужны, например, кассиру — узнать выбранное оформление кассы.
@Controller('settings')
export class PublicSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('ui')
  getUi(@Query('companyId') companyId: string) {
    return this.settings.getUi(companyId);
  }
}
