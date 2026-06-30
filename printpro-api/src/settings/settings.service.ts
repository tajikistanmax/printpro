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

  // Безопасные UI-настройки (без секретов) — доступны без права settings.manage,
  // чтобы касса/панель могли узнать выбранное оформление, валюту и т.п.
  async getUi(companyId: string): Promise<Record<string, string>> {
    const all = await this.getAll(companyId);
    const PUBLIC_KEYS = [
      'posLayout',
      'companyName',
      'currency',
      'language',
      // Контакты компании — для чека (не секреты)
      'companyAddress',
      'phone',
      'companyInn',
      // Оплата «Перевод» — QR и реквизит показываются клиенту на кассе (не секреты)
      'payTransferQr',
      'payTransferRequisite',
    ];
    const out: Record<string, string> = {};
    for (const k of PUBLIC_KEYS) if (all[k] != null) out[k] = all[k];
    // Тумблеры функций (feature.*) — публичные, чтобы меню и страницы
    // могли скрывать/показывать разделы без права settings.manage.
    // Настройки дисплея покупателя (display.*) — тоже публичные, чтобы касса
    // знала тип/протокол второго экрана без права settings.manage.
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith('feature.') || k.startsWith('display.')) out[k] = v;
    }
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
