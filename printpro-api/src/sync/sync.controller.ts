import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from './sync.service';

@Controller('sync')
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly prisma: PrismaService,
  ) {}

  private nodeSecrets() {
    const raw = process.env.SYNC_NODE_SECRETS ?? '';
    return new Map(
      raw
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const idx = part.indexOf(':');
          return idx > 0 ? [part.slice(0, idx), part.slice(idx + 1)] : null;
        })
        .filter((part): part is [string, string] => !!part?.[0] && !!part?.[1]),
    );
  }

  private nodeCompanies() {
    const raw = process.env.SYNC_NODE_COMPANIES ?? '';
    return new Map(
      raw
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const idx = part.indexOf(':');
          return idx > 0 ? [part.slice(0, idx), part.slice(idx + 1)] : null;
        })
        .filter((part): part is [string, string] => !!part?.[0] && !!part?.[1]),
    );
  }

  private safeEqual(a: string, b: string) {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  }

  // Одноразовые nonce в окне свежести (5 мин) — защита от повторного
  // проигрывания перехваченной подписи (P0-5). Хранятся в БД (SyncNonce):
  // переживают рестарт процесса и работают при нескольких инстансах.
  private async recordNonce(node: string, nonce: string): Promise<boolean> {
    // Опортунистически чистим просроченные (старше окна свежести).
    await this.prisma.syncNonce.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    try {
      await this.prisma.syncNonce.create({
        data: {
          node,
          nonce,
          expiresAt: new Date(Date.now() + 300_000),
        },
      });
      return true;
    } catch (e) {
      // Уникальность (node, nonce) нарушена → этот nonce уже использован (повтор).
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return false;
      }
      throw e;
    }
  }

  private async check(
    secret?: string,
    node?: string,
    timestamp?: string,
    signature?: string,
    nonce?: string,
    body?: unknown,
  ): Promise<{ peer: string; companyId: string }> {
    const nodeSecrets = this.nodeSecrets();
    if (nodeSecrets.size > 0) {
      const nodeSecret = node ? nodeSecrets.get(node) : undefined;
      const companyId = node ? this.nodeCompanies().get(node) : undefined;
      const ts = timestamp ? Number(timestamp) : NaN;
      const ageMs = Math.abs(Date.now() - ts);
      if (
        !node ||
        !nodeSecret ||
        !companyId ||
        !signature ||
        !nonce ||
        !Number.isFinite(ts) ||
        ageMs > 300_000
      ) {
        throw new ForbiddenException('Invalid sync signature');
      }
      // Подпись привязана к телу запроса и nonce — перехваченную подпись
      // нельзя переиграть с другим телом или повторно.
      const bodyHash = createHash('sha256')
        .update(JSON.stringify(body ?? {}))
        .digest('hex');
      const expected = createHmac('sha256', nodeSecret)
        .update(`${node}.${timestamp}.${nonce}.${bodyHash}`)
        .digest('hex');
      if (!this.safeEqual(signature, expected)) {
        throw new ForbiddenException('Invalid sync signature');
      }
      // Проверяем nonce ПОСЛЕ подписи, чтобы неверная подпись не «сжигала» nonce.
      if (!(await this.recordNonce(node, nonce))) {
        throw new ForbiddenException('Sync nonce replay');
      }
      return { peer: node, companyId };
    }

    const expected = process.env.SYNC_SECRET;
    if (!expected || !this.safeEqual(secret ?? '', expected)) {
      throw new ForbiddenException('Invalid sync secret');
    }
    return {
      peer: 'legacy',
      companyId: await this.sync.resolveCompanyScope(
        process.env.SYNC_COMPANY_ID,
      ),
    };
  }

  private normalizeLegacyPeer(peer?: string): string {
    const value = (peer ?? '').trim();
    if (!value) return 'legacy';
    if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(value)) {
      throw new ForbiddenException('Invalid legacy peer');
    }
    return value;
  }

  @Post('pull')
  async pull(
    @Headers('x-sync-secret') secret: string,
    @Headers('x-sync-node') node: string,
    @Headers('x-sync-timestamp') timestamp: string,
    @Headers('x-sync-signature') signature: string,
    @Headers('x-sync-nonce') nonce: string,
    @Body() body: { since?: string },
  ) {
    const context = await this.check(
      secret,
      node,
      timestamp,
      signature,
      nonce,
      body,
    );
    return this.sync.pull(body?.since, context.peer, context.companyId);
  }

  @Post('push')
  async push(
    @Headers('x-sync-secret') secret: string,
    @Headers('x-sync-node') node: string,
    @Headers('x-sync-timestamp') timestamp: string,
    @Headers('x-sync-signature') signature: string,
    @Headers('x-sync-nonce') nonce: string,
    @Body() body: { changes: Record<string, any[]>; peer?: string },
  ) {
    const context = await this.check(
      secret,
      node,
      timestamp,
      signature,
      nonce,
      body,
    );
    return this.sync.push(
      body?.changes ?? {},
      context.peer === 'legacy'
        ? this.normalizeLegacyPeer(body?.peer)
        : context.peer,
      context.companyId,
    );
  }

  @Post('heartbeat')
  async heartbeat(
    @Headers('x-sync-secret') secret: string,
    @Headers('x-sync-node') node: string,
    @Headers('x-sync-timestamp') timestamp: string,
    @Headers('x-sync-signature') signature: string,
    @Headers('x-sync-nonce') nonce: string,
    @Body() body: unknown,
  ) {
    const context = await this.check(
      secret,
      node,
      timestamp,
      signature,
      nonce,
      body,
    );
    return this.sync.heartbeat(context.companyId);
  }

  // Требуем вход: статус раскрывает cloud URL и флаги конфигурации sync —
  // не отдаём анонимно (medium).
  @UseGuards(JwtAuthGuard)
  @Get('status')
  status(@CurrentUser() user: { companyId: string }) {
    return this.sync.status(user.companyId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('settings.manage')
  @Post('run')
  run() {
    return this.sync.runNow();
  }
}
