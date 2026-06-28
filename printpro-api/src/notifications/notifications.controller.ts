import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { TelegramService } from '../telegram/telegram.service';
import { EmailService } from '../email/email.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly telegram: TelegramService,
    private readonly email: EmailService,
  ) {}

  // Достаточно быть авторизованным сотрудником
  @Get()
  list(@Query('companyId') companyId: string) {
    return this.notifications.list(companyId);
  }

  // Проверка Telegram: отправляет тестовое сообщение по настройкам компании
  @Post('telegram/test')
  async telegramTest(@Body() body: { companyId: string }) {
    const ok = await this.telegram.send(
      body.companyId,
      '🔔 PrintPro: проверка уведомлений прошла успешно.',
    );
    return { ok };
  }

  // Проверка Email: отправляет тестовое письмо на указанный адрес
  @Post('email/test')
  async emailTest(@Body() body: { companyId: string; to: string }) {
    return this.email.send(
      body.companyId,
      body.to,
      'PrintPro — проверка почты',
      'Проверка email-уведомлений прошла успешно. Это тестовое письмо PrintPro.',
    );
  }
}
