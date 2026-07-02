import {
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IMAGE_UPLOAD_OPTIONS } from './image-upload.options';

// Загрузка изображений (фото товаров/услуг, QR оплаты).
// Файлы кладутся в ./uploads и раздаются статикой по /uploads/<имя> (см. main.ts).
@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  // POST /api/uploads/image — принимает поле `file`, возвращает { url }.
  // Принимаем только растровые изображения (см. IMAGE_UPLOAD_OPTIONS) — SVG/HTML
  // с исполняемым содержимым отклоняются (защита от stored-XSS).
  @Post('image')
  @UseInterceptors(FileInterceptor('file', IMAGE_UPLOAD_OPTIONS))
  uploadImage(@UploadedFile() file: any) {
    if (!file) {
      // Файл отсеян фильтром или не передан
      return { url: null };
    }
    return {
      url: `/uploads/${file.filename}`,
      name: file.originalname,
      size: file.size,
    };
  }
}
