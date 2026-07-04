import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Ключ настройки: латиница/цифры/точка/дефис/подчёркивание, до 64 символов
const KEY_RE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
// Числовые настройки с допустимыми диапазонами (иначе bonusAccrualPercent=1000
// раздал бы бонусов больше чека)
const NUMERIC_LIMITS: Record<string, [number, number]> = {
  bonusAccrualPercent: [0, 100],
  bonusMaxRedeemPercent: [0, 100],
  orderDefaultLeadDays: [0, 365],
};

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
      'customerDisplayLayout',
      'displayQr',
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
      if (
        k.startsWith('feature.') ||
        k.startsWith('display.') ||
        k.startsWith('escpos.')
      )
        out[k] = v;
    }
    return out;
  }

  // Сохранить пачку настроек (с валидацией ключей/значений/диапазонов)
  async setMany(companyId: string, values: Record<string, unknown>) {
    const raw = Object.entries(values ?? {});
    if (raw.length > 200) {
      throw new BadRequestException('Слишком много настроек за один запрос');
    }
    const entries: [string, string][] = [];
    for (const [key, v] of raw) {
      if (!KEY_RE.test(key)) {
        throw new BadRequestException(`Недопустимый ключ настройки: «${key}»`);
      }
      // Значение — только скаляр; объекты/массивы в настройках не храним
      if (v !== null && typeof v === 'object') {
        throw new BadRequestException(`Недопустимое значение настройки «${key}»`);
      }
      const value = v == null ? '' : String(v);
      if (value.length > 100_000) {
        // data-URL картинок (QR оплаты) бывают большими, но не безграничными
        throw new BadRequestException(`Значение «${key}» слишком длинное`);
      }
      const lim = NUMERIC_LIMITS[key];
      if (lim && value !== '') {
        const n = Number(value);
        if (!Number.isFinite(n) || n < lim[0] || n > lim[1]) {
          throw new BadRequestException(
            `«${key}»: допустимо число от ${lim[0]} до ${lim[1]}`,
          );
        }
      }
      entries.push([key, value]);
    }
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
