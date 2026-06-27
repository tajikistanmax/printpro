import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger('Telegram');

  constructor(private readonly prisma: PrismaService) {}

  // Отправить сообщение в Telegram, если настроены токен и чат.
  // Никогда не роняет основную операцию.
  async send(companyId: string, text: string): Promise<boolean> {
    try {
      const rows = await this.prisma.setting.findMany({
        where: {
          companyId,
          key: { in: ['telegramBotToken', 'telegramChatId'] },
        },
      });
      const map = Object.fromEntries(rows.map((r) => [r.key, r.value ?? '']));
      const token = map.telegramBotToken;
      const chatId = map.telegramChatId;
      if (!token || !chatId) return false;

      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        },
      );
      if (!res.ok) {
        this.logger.warn(`Telegram ответил ${res.status}`);
        return false;
      }
      return true;
    } catch (e) {
      this.logger.warn(`Не удалось отправить в Telegram: ${e}`);
      return false;
    }
  }
}
