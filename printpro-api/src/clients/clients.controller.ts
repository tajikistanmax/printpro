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
import { ClientType } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';
import { ClientsService } from './clients.service';
import { DOCUMENT_UPLOAD_OPTIONS } from '../uploads/image-upload.options';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('clients')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Post()
  @RequirePermissions('clients.manage')
  create(
    @Body() dto: CreateClientDto,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.clients.create({ ...dto, companyId: user.companyId });
  }

  @Patch(':id')
  @RequirePermissions('clients.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateClientDto,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.clients.update(id, dto, user.companyId);
  }

  @Get()
  @RequirePermissions('clients.view')
  findAll(
    @CurrentUser() user: { sub: string; companyId: string },
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('type') type?: ClientType,
    @Query('status') status?: 'active' | 'inactive',
  ) {
    return this.clients.findAll(user.companyId, {
      search,
      type,
      status,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 25,
    });
  }

  // Сводка по клиентам (карточки на странице)
  @Get('stats')
  @RequirePermissions('clients.view')
  stats(@CurrentUser() user: { sub: string; companyId: string }) {
    return this.clients.stats(user.companyId);
  }

  @Get(':id')
  @RequirePermissions('clients.view')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.clients.findOne(id, user.companyId);
  }

  // Загрузить файл клиента (документ/договор/макет)
  @Post(':id/files')
  @RequirePermissions('clients.manage')
  @UseInterceptors(FileInterceptor('file', DOCUMENT_UPLOAD_OPTIONS))
  uploadFile(
    @Param('id') id: string,
    @UploadedFile() file: any,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.clients.addFile(
      id,
      `/uploads/${file.filename}`,
      user.companyId,
      file.originalname,
      file.mimetype,
    );
  }

  // Удалить файл клиента
  @Delete('files/:fileId')
  @RequirePermissions('clients.manage')
  removeFile(
    @Param('fileId') fileId: string,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.clients.removeFile(fileId, user.companyId);
  }
}
