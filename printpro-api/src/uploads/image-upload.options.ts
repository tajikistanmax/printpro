import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';

// Единый каталог загрузок — согласован с main.ts (UPLOADS_DIR или ./uploads).
// Коробка передаёт UPLOADS_DIR=userData/uploads; облако — постоянный диск/S3-mount.
const UPLOADS_DEST = process.env.UPLOADS_DIR || join(process.cwd(), 'uploads');

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
    destination: UPLOADS_DEST,
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
    destination: UPLOADS_DEST,
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

// Документы клиента (договоры/макеты/сканы): изображения + PDF + офисные форматы.
// HTML/SVG/JS/исполняемые НЕ допускаются — файлы раздаются статикой с origin API,
// активный контент дал бы stored-XSS. Office-типы безопасны (не исполняются в браузере).
const DOCUMENT_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const DOCUMENT_EXT = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
]);

export const DOCUMENT_UPLOAD_OPTIONS = {
  storage: diskStorage({
    destination: UPLOADS_DEST,
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
    if (DOCUMENT_MIME.has(file.mimetype) && DOCUMENT_EXT.has(ext)) {
      cb(null, true);
    } else {
      cb(
        new BadRequestException(
          'Разрешены только изображения (JPEG/PNG/WebP/GIF), PDF или документы Word/Excel',
        ),
        false,
      );
    }
  },
  limits: { fileSize: 25 * 1024 * 1024 }, // до 25 МБ
};
