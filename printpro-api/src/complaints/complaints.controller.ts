import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ComplaintStatus } from '@prisma/client';
import { ComplaintsService } from './complaints.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('complaints')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Get()
  @RequirePermissions('clients.view')
  findAll(
    @CurrentUser() user: { companyId: string },
    @Query('status') status?: ComplaintStatus,
  ) {
    return this.complaints.findAll(user.companyId, status);
  }

  @Post()
  @RequirePermissions('clients.view')
  create(
    @Body()
    dto: {
      companyId: string;
      title: string;
      description?: string;
      orderId?: string;
      clientId?: string;
    },
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.complaints.create({
      ...dto,
      companyId: user.companyId,
      createdById: user.sub,
    });
  }

  @Patch(':id/status')
  @RequirePermissions('clients.manage')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: { status: ComplaintStatus; resolution?: string },
    @CurrentUser() user: { companyId: string },
  ) {
    return this.complaints.updateStatus(
      id,
      user.companyId,
      dto.status,
      dto.resolution,
    );
  }

  @Delete(':id')
  @RequirePermissions('clients.manage')
  remove(@Param('id') id: string, @CurrentUser() user: { companyId: string }) {
    return this.complaints.remove(id, user.companyId);
  }
}
