import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { SyncService } from './sync.service';

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

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

  private safeEqual(a: string, b: string) {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  }

  private check(
    secret?: string,
    node?: string,
    timestamp?: string,
    signature?: string,
  ) {
    const nodeSecrets = this.nodeSecrets();
    if (nodeSecrets.size > 0) {
      const nodeSecret = node ? nodeSecrets.get(node) : undefined;
      const ts = timestamp ? Number(timestamp) : NaN;
      const ageMs = Math.abs(Date.now() - ts);
      if (
        !node ||
        !nodeSecret ||
        !signature ||
        !Number.isFinite(ts) ||
        ageMs > 300_000
      ) {
        throw new ForbiddenException('Invalid sync signature');
      }
      const expected = createHmac('sha256', nodeSecret)
        .update(`${node}.${timestamp}`)
        .digest('hex');
      if (!this.safeEqual(signature, expected)) {
        throw new ForbiddenException('Invalid sync signature');
      }
      return node;
    }

    const expected = process.env.SYNC_SECRET;
    if (!expected || secret !== expected) {
      throw new ForbiddenException('Invalid sync secret');
    }
    return 'legacy';
  }

  @Post('pull')
  pull(
    @Headers('x-sync-secret') secret: string,
    @Headers('x-sync-node') node: string,
    @Headers('x-sync-timestamp') timestamp: string,
    @Headers('x-sync-signature') signature: string,
    @Body() body: { since?: string },
  ) {
    const peer = this.check(secret, node, timestamp, signature);
    return this.sync.pull(body?.since, peer);
  }

  @Post('push')
  push(
    @Headers('x-sync-secret') secret: string,
    @Headers('x-sync-node') node: string,
    @Headers('x-sync-timestamp') timestamp: string,
    @Headers('x-sync-signature') signature: string,
    @Body() body: { changes: Record<string, any[]>; peer?: string },
  ) {
    const peer = this.check(secret, node, timestamp, signature);
    return this.sync.push(body?.changes ?? {}, peer === 'legacy' ? body?.peer : peer);
  }

  @Post('heartbeat')
  heartbeat(
    @Headers('x-sync-secret') secret: string,
    @Headers('x-sync-node') node: string,
    @Headers('x-sync-timestamp') timestamp: string,
    @Headers('x-sync-signature') signature: string,
  ) {
    this.check(secret, node, timestamp, signature);
    return this.sync.heartbeat();
  }

  @Get('status')
  status() {
    return this.sync.status();
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('settings.manage')
  @Post('run')
  run() {
    return this.sync.runNow();
  }
}
