import { Controller, Get, UseGuards } from '@nestjs/common';
import { BackupService } from './backup.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('backup')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  // Скачать полную резервную копию данных компании (JSON).
  // companyId — строго из токена: иначе можно выгрузить бэкап чужой компании.
  @Get('export')
  @RequirePermissions('settings.manage')
  export(@CurrentUser() user: { companyId: string }) {
    return this.backup.export(user.companyId);
  }
}
