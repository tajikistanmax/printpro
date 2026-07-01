import {
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

// Загрузка изображений (фото товаров/услуг, QR оплаты).
// Файлы кладутся в ./uploads и раздаются статикой по /uploads/<имя> (см. main.ts).
@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  // POST /api/uploads/image — принимает поле `file`, возвращает { url }
  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (_req, file, cb) => {
          cb(null, randomUUID() + extname(file.originalname));
        },
      }),
      limits: { fileSize: 50 * 1024 * 1024 }, // до 50 МБ
    }),
  )
  uploadImage(@UploadedFile() file: any) {
    return {
      url: `/uploads/${file.filename}`,
      name: file.originalname,
      size: file.size,
    };
  }
}
