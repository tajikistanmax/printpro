import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SyncService } from './sync.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';

// Синхронизация между узлами защищена общим секретом SYNC_SECRET
// (передаётся в заголовке x-sync-secret), а не входом пользователя.
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  private check(secret?: string) {
    const expected = process.env.SYNC_SECRET;
    if (!expected || secret !== expected) {
      throw new ForbiddenException('Неверный ключ синхронизации');
    }
  }

  @Post('pull')
  pull(
    @Headers('x-sync-secret') secret: string,
    @Body() body: { since?: string },
  ) {
    this.check(secret);
    return this.sync.pull(body?.since);
  }

  @Post('push')
  push(
    @Headers('x-sync-secret') secret: string,
    @Body() body: { changes: Record<string, any[]>; peer?: string },
  ) {
    this.check(secret);
    return this.sync.push(body?.changes ?? {}, body?.peer);
  }

  // Отметка синхронизатора (защищена секретом)
  @Post('heartbeat')
  heartbeat(@Headers('x-sync-secret') secret: string) {
    this.check(secret);
    return this.sync.heartbeat();
  }

  // Статус для панели — открытый (отдаёт только метку времени)
  @Get('status')
  status() {
    return this.sync.status();
  }

  // Ручной запуск синхронизации из панели (вход + право настроек)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('settings.manage')
  @Post('run')
  run() {
    return this.sync.runNow();
  }
}
