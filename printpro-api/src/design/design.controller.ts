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

@Controller('design')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DesignController {
  constructor(private readonly design: DesignService) {}

  @Get()
  @RequirePermissions('design.view')
  findAll(
    @Query('companyId') companyId: string,
    @Query('status') status?: ProofStatus,
    @Query('orderId') orderId?: string,
  ) {
    return this.design.findAll(companyId, status, orderId);
  }

  @Post()
  @RequirePermissions('design.manage')
  create(@Body() dto: CreateProofDto) {
    return this.design.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('design.manage')
  update(@Param('id') id: string, @Body() dto: UpdateProofDto) {
    return this.design.update(id, dto);
  }

  // Смена статуса доступна и просмотрщику (клиентский менеджер согласует)
  @Patch(':id/status')
  @RequirePermissions('design.view')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateProofStatusDto) {
    return this.design.updateStatus(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('design.manage')
  remove(@Param('id') id: string) {
    return this.design.remove(id);
  }
}
