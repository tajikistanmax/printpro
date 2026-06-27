import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ClientsService } from './clients.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';

@Controller('clients')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Post()
  @RequirePermissions('clients.manage')
  create(
    @Body() body: { companyId: string; phone: string; fullName?: string; note?: string },
  ) {
    return this.clients.create(body.companyId, body.phone, body.fullName, body.note);
  }

  @Get()
  @RequirePermissions('clients.view')
  findAll(@Query('companyId') companyId: string, @Query('search') search?: string) {
    return this.clients.findAll(companyId, search);
  }

  @Get(':id')
  @RequirePermissions('clients.view')
  findOne(@Param('id') id: string) {
    return this.clients.findOne(id);
  }
}
