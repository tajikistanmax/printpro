import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EmailService {
  private readonly logger = new Logger('Email');

  constructor(private readonly prisma: PrismaService) {}

  // Загрузить SMTP-настройки компании из ключ-значение
  private async config(companyId: string) {
    const rows = await this.prisma.setting.findMany({
      where: {
        companyId,
        key: {
          in: ['smtpHost', 'smtpPort', 'smtpUser', 'smtpPass', 'smtpFrom'],
        },
      },
    });
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value ?? '']));
    return {
      host: m.smtpHost,
      port: Number(m.smtpPort) || 587,
      user: m.smtpUser,
      pass: m.smtpPass,
      from: m.smtpFrom || m.smtpUser,
    };
  }

  // Отправить письмо. Никогда не роняет основную операцию.
  async send(
    companyId: string,
    to: string,
    subject: string,
    text: string,
  ): Promise<{ ok: boolean; message?: string }> {
    try {
      const c = await this.config(companyId);
      if (!c.host || !c.user || !c.pass) {
        return { ok: false, message: 'SMTP не настроен' };
      }
      if (!to) return { ok: false, message: 'Нет адреса получателя' };

      const transport = nodemailer.createTransport({
        host: c.host,
        port: c.port,
        secure: c.port === 465, // 465 = SSL, иначе STARTTLS
        auth: { user: c.user, pass: c.pass },
      });
      await transport.sendMail({ from: c.from, to, subject, text });
      return { ok: true };
    } catch (e: any) {
      this.logger.warn(`Не удалось отправить email: ${e?.message ?? e}`);
      return { ok: false, message: e?.message ?? 'Ошибка отправки' };
    }
  }
}
