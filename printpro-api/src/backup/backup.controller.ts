import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { BackupService } from './backup.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';

@Controller('backup')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  // Скачать полную резервную копию данных компании (JSON)
  @Get('export')
  @RequirePermissions('settings.manage')
  export(@Query('companyId') companyId: string) {
    return this.backup.export(companyId);
  }
}
