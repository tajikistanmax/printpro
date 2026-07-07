import {
  Controller,
  Get,
  HttpCode,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

// Health-check для облака (Render healthCheckPath) и коробки (Electron ждёт
// готовности API перед показом окна). Публичный, без авторизации.
// @SkipThrottle — частые проверки платформы не должны упираться в rate-limit.
@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  // Liveness — процесс жив (без обращения к БД).
  @Get()
  @HttpCode(200)
  liveness() {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  // Readiness — БД доступна. 200 если SELECT 1 прошёл, иначе 503.
  @Get('ready')
  async readiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'up' };
    } catch {
      // 503 Service Unavailable — балансировщик/оркестратор поймёт, что инстанс
      // не готов обслуживать (упала БД), и не будет слать на него трафик.
      throw new ServiceUnavailableException({ status: 'error', db: 'down' });
    }
  }
}
