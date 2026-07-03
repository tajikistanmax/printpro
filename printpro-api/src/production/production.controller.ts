import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { ProductionStatus } from '@prisma/client';
import { ProductionService } from './production.service';
import {
  CreateProductionJobDto,
  UpdateProductionJobDto,
  UpdateProductionStatusDto,
} from './dto/production.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('production')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  // Доска производства (можно фильтровать по статусу)
  @Get()
  @RequirePermissions('production.view')
  findAll(
    @CurrentUser() user: { sub: string; companyId: string },
    @Query('status') status?: ProductionStatus,
  ) {
    return this.production.findAll(user.companyId, status);
  }

  // Создать задание из заказа
  @Post()
  @RequirePermissions('production.manage')
  create(
    @CurrentUser() user: { sub: string; companyId: string },
    @Body() dto: CreateProductionJobDto,
  ) {
    return this.production.create({ ...dto, companyId: user.companyId });
  }

  // Назначение/принтер/приоритет/заметка
  @Patch(':id')
  @RequirePermissions('production.manage')
  update(
    @CurrentUser() user: { sub: string; companyId: string },
    @Param('id') id: string,
    @Body() dto: UpdateProductionJobDto,
  ) {
    return this.production.update(id, user.companyId, dto);
  }

  // Сменить статус (исполнителю достаточно права просмотра)
  @Patch(':id/status')
  @RequirePermissions('production.view')
  updateStatus(
    @CurrentUser() user: { sub: string; companyId: string },
    @Param('id') id: string,
    @Body() dto: UpdateProductionStatusDto,
  ) {
    return this.production.updateStatus(
      id,
      user.companyId,
      dto.status,
      dto.defectReason,
      user.sub,
    );
  }

  // Загрузить фото готового результата
  @Post(':id/photo')
  @RequirePermissions('production.view')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (_req, file, cb) =>
          cb(null, randomUUID() + extname(file.originalname)),
      }),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  uploadPhoto(
    @CurrentUser() user: { sub: string; companyId: string },
    @Param('id') id: string,
    @UploadedFile() file: any,
  ) {
    return this.production.setResultPhoto(
      id,
      user.companyId,
      `/uploads/${file.filename}`,
    );
  }

  // Удалить задание
  @Delete(':id')
  @RequirePermissions('production.manage')
  remove(
    @CurrentUser() user: { sub: string; companyId: string },
    @Param('id') id: string,
  ) {
    return this.production.remove(id, user.companyId);
  }
}
