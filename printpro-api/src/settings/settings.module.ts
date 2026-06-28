import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { PublicSettingsController } from './public-settings.controller';

@Module({
  controllers: [SettingsController, PublicSettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
