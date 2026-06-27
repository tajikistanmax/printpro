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
