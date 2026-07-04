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
import { ProofStatus } from '@prisma/client';
import { DesignService } from './design.service';
import {
  CreateProofDto,
  UpdateProofDto,
  UpdateProofStatusDto,
} from './dto/design.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

interface JwtUser {
  sub: string;
  companyId: string;
}

// companyId только из токена — чужие макеты недоступны
@Controller('design')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DesignController {
  constructor(private readonly design: DesignService) {}

  @Get()
  @RequirePermissions('design.view')
  findAll(
    @CurrentUser() user: JwtUser,
    @Query('status') status?: ProofStatus,
    @Query('orderId') orderId?: string,
  ) {
    return this.design.findAll(user.companyId, status, orderId);
  }

  @Post()
  @RequirePermissions('design.manage')
  create(@Body() dto: CreateProofDto, @CurrentUser() user: JwtUser) {
    return this.design.create(dto, user.companyId);
  }

  @Patch(':id')
  @RequirePermissions('design.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProofDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.design.update(id, dto, user.companyId);
  }

  // Смена статуса доступна и просмотрщику (клиентский менеджер согласует)
  @Patch(':id/status')
  @RequirePermissions('design.view')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateProofStatusDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.design.updateStatus(id, dto, user.companyId, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('design.manage')
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.design.remove(id, user.companyId);
  }
}
