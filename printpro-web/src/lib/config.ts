// Настройки фронтенда PrintPro

// Адрес нашего бэкенда (NestJS API)
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3000/api';

// Корень бэкенда (для прямых ссылок на файлы /uploads/...)
export const SERVER_ORIGIN =
  process.env.NEXT_PUBLIC_SERVER_ORIGIN ?? 'http://localhost:3000';

// Пока нет выбора компании по поддомену — используем нашу тестовую компанию.
// Позже определим автоматически по адресу (dushanbeprint.printpro.app).
export const DEFAULT_COMPANY_ID =
  process.env.NEXT_PUBLIC_COMPANY_ID ??
  '7628001a-5f9c-45ec-8f6f-a80280d409c5';
