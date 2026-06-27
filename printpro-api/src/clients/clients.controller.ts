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
import { ClientsService } from './clients.service';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';

@Controller('clients')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Post()
  @RequirePermissions('clients.manage')
  create(@Body() dto: CreateClientDto) {
    return this.clients.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('clients.manage')
  update(@Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.clients.update(id, dto);
  }

  @Get()
  @RequirePermissions('clients.view')
  findAll(
    @Query('companyId') companyId: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.clients.findAll(
      companyId,
      search,
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 25,
    );
  }

  @Get(':id')
  @RequirePermissions('clients.view')
  findOne(@Param('id') id: string) {
    return this.clients.findOne(id);
  }

  // Загрузить файл клиента (документ/договор/макет)
  @Post(':id/files')
  @RequirePermissions('clients.manage')
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
  uploadFile(@Param('id') id: string, @UploadedFile() file: any) {
    return this.clients.addFile(
      id,
      `/uploads/${file.filename}`,
      file.originalname,
      file.mimetype,
    );
  }

  // Удалить файл клиента
  @Delete('files/:fileId')
  @RequirePermissions('clients.manage')
  removeFile(@Param('fileId') fileId: string) {
    return this.clients.removeFile(fileId);
  }
}
