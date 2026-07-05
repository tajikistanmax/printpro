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
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import {
  CreateProofDto,
  UpdateProofDto,
  UpdateProofStatusDto,
} from './dto/design.dto';
import { DesignService } from './design.service';

interface JwtUser {
  sub: string;
  companyId: string;
}

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
    return this.design.create({ ...dto, companyId: user.companyId });
  }

  @Patch(':id')
  @RequirePermissions('design.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProofDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.design.update(id, user.companyId, dto);
  }

  @Patch(':id/status')
  @RequirePermissions('design.view')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateProofStatusDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.design.updateStatus(id, user.companyId, dto);
  }

  @Delete(':id')
  @RequirePermissions('design.manage')
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.design.remove(id, user.companyId);
  }
}
