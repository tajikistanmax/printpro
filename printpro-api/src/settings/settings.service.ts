import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  // Все настройки компании как объект { key: value }
  async getAll(companyId: string): Promise<Record<string, string>> {
    const rows = await this.prisma.setting.findMany({ where: { companyId } });
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value ?? '';
    return map;
  }

  // Безопасные UI-настройки (без секретов) — доступны без права settings.manage
  // и БЕЗ авторизации (страница входа/меню), чтобы касса/панель могли узнать
  // выбранное оформление, валюту, брендинг компании. Платёжные реквизиты
  // (payTransferQr/payTransferRequisite) сюда НЕ входят — их отдаёт
  // getReceiptInfo только авторизованному пользователю (см. ниже).
  async getUi(companyId: string): Promise<Record<string, string>> {
    const all = await this.getAll(companyId);
    const PUBLIC_KEYS = [
      'posLayout',
      'customerDisplayLayout',
      'displayQr',
      'companyName',
      'logoDataUrl', // логотип компании — для чеков/ценников (не секрет)
      'currency',
      'language',
      // Контакты компании — печатаются на чеке (публичная бизнес-информация)
      'companyAddress',
      'phone',
      'companyInn',
    ];
    const out: Record<string, string> = {};
    for (const k of PUBLIC_KEYS) if (all[k] != null) out[k] = all[k];
    // Тумблеры функций (feature.*) — публичные, чтобы меню и страницы
    // могли скрывать/показывать разделы без права settings.manage.
    // Настройки дисплея покупателя (display.*) — тоже публичные, чтобы касса
    // знала тип/протокол второго экрана без права settings.manage.
    for (const [k, v] of Object.entries(all)) {
      if (
        k.startsWith('feature.') ||
        k.startsWith('display.') ||
        k.startsWith('escpos.')
      )
        out[k] = v;
    }
    return out;
  }

  // Платёжные реквизиты (куда клиент переводит деньги) — только для
  // авторизованного пользователя своей компании. НЕ публикуются анонимно,
  // иначе банковский реквизит/QR любой компании утекал бы по companyId.
  async getReceiptInfo(companyId: string): Promise<Record<string, string>> {
    const all = await this.getAll(companyId);
    const KEYS = ['payTransferQr', 'payTransferRequisite'];
    const out: Record<string, string> = {};
    for (const k of KEYS) if (all[k] != null) out[k] = all[k];
    return out;
  }

  // Сохранить пачку настроек
  async setMany(companyId: string, values: Record<string, string>) {
    const entries = Object.entries(values);
    await this.prisma.$transaction(
      entries.map(([key, value]) =>
        this.prisma.setting.upsert({
          where: { companyId_key: { companyId, key } },
          create: { companyId, key, value },
          update: { value },
        }),
      ),
    );
    return this.getAll(companyId);
  }
}
