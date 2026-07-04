import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { TelegramService } from '../telegram/telegram.service';
import { EmailService } from '../email/email.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('notifications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly telegram: TelegramService,
    private readonly email: EmailService,
  ) {}

  // Достаточно быть авторизованным сотрудником. companyId — из токена.
  @Get()
  list(@CurrentUser() user: { companyId: string }) {
    return this.notifications.list(user.companyId);
  }

  // Проверка Telegram: отправляет тестовое сообщение по настройкам СВОЕЙ компании
  // (companyId из токена — нельзя слать через чужой Telegram/SMTP).
  // Требует право настроек — иначе любой сотрудник слал бы тест-сообщения.
  @Post('telegram/test')
  @RequirePermissions('settings.manage')
  async telegramTest(@CurrentUser() user: { companyId: string }) {
    const ok = await this.telegram.send(
      user.companyId,
      '🔔 PrintPro: проверка уведомлений прошла успешно.',
    );
    return { ok };
  }

  // Проверка Email: отправляет тестовое письмо на указанный адрес.
  // Требует право настроек — иначе через корпоративный SMTP можно было бы слать
  // письма на произвольные адреса (спам/бомбинг).
  @Post('email/test')
  @RequirePermissions('settings.manage')
  async emailTest(
    @CurrentUser() user: { companyId: string },
    @Body() body: { to: string },
  ) {
    return this.email.send(
      user.companyId,
      body.to,
      'PrintPro — проверка почты',
      'Проверка email-уведомлений прошла успешно. Это тестовое письмо PrintPro.',
    );
  }
}
