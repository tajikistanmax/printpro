import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('audit-log')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  // companyId — из токена: журнал аудита чужой компании читать нельзя.
  @Get()
  @RequirePermissions('audit.view')
  list(
    @CurrentUser() user: { companyId: string },
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.audit.list(
      user.companyId,
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 50,
    );
  }
}
