import { Module } from '@nestjs/common';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

// Публичный (без входа) эндпоинт: companyId ЭТОЙ установки. Нужен фронту для
// рантайм-резолва арендатора — коробка у каждого клиента генерирует свой
// companyId при первом запуске (см. src/bootstrap/seed.ts, BOX_MODE), а фронт
// один и тот же. В облаке возвращает единственную компанию (поведение как было).
@Controller('system')
class PublicSystemController {
  constructor(private readonly prisma: PrismaService) {}

  @SkipThrottle()
  @Get('company-id')
  async companyId() {
    const company = await this.prisma.company.findFirst({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return { companyId: company?.id ?? null };
  }
}

@Controller('system')
@UseGuards(JwtAuthGuard)
class SystemController {
  constructor(private readonly prisma: PrismaService) {}

  // Реальная информация о системе для страницы «Настройки → О системе».
  @Get('info')
  async info() {
    // Версия приложения — из package.json backend'а.
    let appVersion = '—';
    try {
      const pkg = JSON.parse(
        readFileSync(join(process.cwd(), 'package.json'), 'utf-8'),
      );
      appVersion = pkg.version ?? '—';
    } catch {
      // package.json недоступен — оставляем прочерк
    }

    // Версия СУБД — реальный запрос к PostgreSQL.
    let dbVersion = 'PostgreSQL';
    try {
      const rows = await this.prisma.$queryRaw<{ version: string }[]>`SELECT version()`;
      const full = rows?.[0]?.version ?? '';
      const m = full.match(/PostgreSQL\s+([\d.]+)/i);
      dbVersion = m ? `PostgreSQL ${m[1]}` : full || 'PostgreSQL';
    } catch {
      dbVersion = 'недоступна';
    }

    const uptimeSeconds = Math.floor(process.uptime());

    return {
      appVersion,
      dbVersion,
      uptimeSeconds,
      startedAt: new Date(Date.now() - uptimeSeconds * 1000).toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
    };
  }
}

@Module({
  controllers: [PublicSystemController, SystemController],
})
export class SystemModule {}
