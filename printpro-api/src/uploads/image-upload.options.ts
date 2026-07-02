import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';

// Разрешаем только растровые изображения. SVG НЕ допускаем намеренно — он может
// содержать <script> и раздаётся статикой с того же origin (риск stored-XSS).
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

// Общие настройки загрузки изображений (используются в /uploads и /public/upload).
export const IMAGE_UPLOAD_OPTIONS = {
  storage: diskStorage({
    destination: './uploads',
    filename: (
      _req: unknown,
      file: { originalname: string },
      cb: (err: Error | null, name: string) => void,
    ) => {
      cb(null, randomUUID() + extname(file.originalname).toLowerCase());
    },
  }),
  fileFilter: (
    _req: unknown,
    file: { mimetype: string; originalname: string },
    cb: (err: Error | null, accept: boolean) => void,
  ) => {
    const ext = extname(file.originalname).toLowerCase();
    if (ALLOWED_MIME.has(file.mimetype) && ALLOWED_EXT.has(ext)) {
      cb(null, true);
    } else {
      cb(
        new BadRequestException(
          'Разрешены только изображения JPEG, PNG, WebP или GIF',
        ),
        false,
      );
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // до 10 МБ
};

// Загрузка макетов клиентом (публичный эндпоинт): изображения + PDF.
// Исполняемые/веб-типы (SVG, HTML, JS) отклоняются — публичная раздача с origin.
const LAYOUT_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);
const LAYOUT_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf']);

export const LAYOUT_UPLOAD_OPTIONS = {
  storage: diskStorage({
    destination: './uploads',
    filename: (
      _req: unknown,
      file: { originalname: string },
      cb: (err: Error | null, name: string) => void,
    ) => {
      cb(null, randomUUID() + extname(file.originalname).toLowerCase());
    },
  }),
  fileFilter: (
    _req: unknown,
    file: { mimetype: string; originalname: string },
    cb: (err: Error | null, accept: boolean) => void,
  ) => {
    const ext = extname(file.originalname).toLowerCase();
    if (LAYOUT_MIME.has(file.mimetype) && LAYOUT_EXT.has(ext)) {
      cb(null, true);
    } else {
      cb(
        new BadRequestException('Разрешены только изображения (JPEG/PNG/WebP/GIF) или PDF'),
        false,
      );
    }
  },
  limits: { fileSize: 25 * 1024 * 1024 }, // до 25 МБ
};
