import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { createHash, createHmac, randomUUID } from 'crypto';
import request from 'supertest';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';

/**
 * e2e-тесты защиты sync-эндпоинтов (SyncController.check): поднимаем НАСТОЯЩИЙ
 * контроллер + сервис в тестовом HTTP-сервере; подменяем только БД.
 *
 * Что доказываем на живом HTTP:
 *   • HMAC-подпись привязана к SHA-256 ТЕЛА и к nonce: подделка тела или nonce
 *     ⇒ 403, даже при валидном secret;
 *   • защита от replay: повтор того же nonce ⇒ 403 (durable через SyncNonce,
 *     уникальность (node, nonce) отклоняет повтор — эмулируем P2002);
 *   • неверная подпись НЕ «сжигает» nonce (проверка nonce идёт ПОСЛЕ подписи);
 *   • устаревший timestamp (>5 мин) ⇒ 403;
 *   • согласованность клиент↔сервер: РЕАЛЬНАЯ подпись, которую производит клиент
 *     SyncService.callCloud, принимается сервером (тем же алгоритмом check);
 *   • legacy-режим (общий x-sync-secret) при отсутствии node-секретов.
 *
 * Уникальность (node, nonce) здесь обеспечивает in-memory Set, отражающий
 * @@unique([node, nonce]) в schema.prisma. Настоящую durable-гарантию (переживает
 * рестарт/несколько инстансов) даёт БД — вынесено в it.todo ниже.
 */

const NODE = 'K1';
const SECRET = 'shared-node-secret';
const LEGACY_SECRET = 'legacy-plain-secret';

const ORIG_ENV = { ...process.env };
const realFetch = global.fetch;

// Реальный класс ошибки уникальности Prisma — как её ловит recordNonce (P2002).
function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`node`,`nonce`)',
    { code: 'P2002', clientVersion: '6.19.3' },
  );
}

// Серверный prisma-мок: SyncNonce с настоящей проверкой уникальности (node,nonce),
// SyncCursor для heartbeat, и generic-заглушка findMany/[] для всех таблиц pull().
function makeServerPrisma(nonceStore: Set<string>) {
  const base: Record<string, unknown> = {
    syncNonce: {
      deleteMany: jest.fn(async () => ({ count: 0 })),
      create: jest.fn(async ({ data }: { data: { node: string; nonce: string } }) => {
        const key = `${data.node}::${data.nonce}`;
        if (nonceStore.has(key)) throw uniqueViolation();
        nonceStore.add(key);
        return { id: 'nonce-' + nonceStore.size, ...data };
      }),
    },
    syncCursor: {
      findUnique: jest.fn(async () => null),
      upsert: jest.fn(async () => ({})),
    },
  };
  return new Proxy(base, {
    get(target, prop) {
      if (prop === 'then') return undefined; // не притворяемся thenable
      if (typeof prop === 'symbol') return (target as Record<symbol, unknown>)[prop];
      if (prop in target) return target[prop as string];
      // Любая таблица из реестра синхронизации: pull() зовёт только findMany.
      return {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => null),
      };
    },
  });
}

// Подпись запроса — ТОЧНОЕ зеркало клиента (SyncService.callCloud) и того, что
// проверяет сервер (check): HMAC-SHA256(secret) над `node.ts.nonce.sha256(body)`.
function sign(
  body: unknown,
  opts: { node?: string; secret?: string; ts?: number; nonce?: string } = {},
): Record<string, string> {
  const node = opts.node ?? NODE;
  const secret = opts.secret ?? SECRET;
  const ts = opts.ts ?? Date.now();
  const nonce = opts.nonce ?? randomUUID();
  const bodyHash = createHash('sha256')
    .update(JSON.stringify(body ?? {}))
    .digest('hex');
  const signature = createHmac('sha256', secret)
    .update(`${node}.${ts}.${nonce}.${bodyHash}`)
    .digest('hex');
  return {
    'x-sync-node': node,
    'x-sync-timestamp': String(ts),
    'x-sync-nonce': nonce,
    'x-sync-signature': signature,
  };
}

describe('SyncController — подпись/replay/согласованность (e2e)', () => {
  let app: INestApplication;
  const serverNonces = new Set<string>();

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [SyncController],
      providers: [
        SyncService,
        { provide: PrismaService, useValue: makeServerPrisma(serverNonces) },
      ],
    })
      // status/run защищены гвардами; здесь их не дёргаем, но глушим DI гвардов.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    // Без ValidationPipe: тело должно дойти до check() байт-в-байт (bodyHash).
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env = { ...ORIG_ENV };
    (global as unknown as { fetch: typeof fetch }).fetch = realFetch;
  });

  beforeEach(() => {
    serverNonces.clear();
    (global as unknown as { fetch: typeof fetch }).fetch = realFetch;
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
    (global as unknown as { fetch: typeof fetch }).fetch = realFetch;
  });

  // ─────────────── Режим node-секретов (HMAC-подпись) ───────────────
  describe('node-секреты: HMAC над телом + одноразовый nonce', () => {
    beforeEach(() => {
      process.env.SYNC_NODE_SECRETS = `${NODE}:${SECRET}`;
      process.env.SYNC_NODE_SECRET = SECRET; // для клиента callCloud
      process.env.NODE_ID = NODE;
      process.env.CLOUD_API = 'https://cloud.test';
      process.env.SYNC_SECRET = 'unused-when-node-secrets-set';
    });

    it('валидная подпись → 201 (pull проходит)', async () => {
      const body = { since: '2026-07-01T00:00:00.000Z' };
      const res = await request(app.getHttpServer())
        .post('/sync/pull')
        .set(sign(body))
        .send(body)
        .expect(201);
      // pull вернул конверт {until, changes}
      expect(res.body).toHaveProperty('until');
      expect(res.body).toHaveProperty('changes');
    });

    it('согласованность клиент↔сервер: РЕАЛЬНАЯ подпись callCloud принимается сервером, её повтор → 403', async () => {
      // Клиент — отдельный узел (свой prisma). Перехватываем первый исходящий
      // запрос callCloud('/sync/pull', …), рвём цикл (503) и берём заголовки.
      const clientPrisma = {
        syncCursor: {
          findUnique: jest.fn(async () => null),
          upsert: jest.fn(async () => ({})),
        },
      };
      const clientService = new SyncService(
        clientPrisma as unknown as PrismaService,
      );

      let captured: {
        url: string;
        headers: Record<string, string>;
        body: unknown;
      } | null = null;
      (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(
        async (url: string, init: { headers: Record<string, string>; body: string }) => {
          captured = { url, headers: init.headers, body: JSON.parse(init.body) };
          return { ok: false, status: 503, json: async () => ({}) };
        },
      );

      await expect(clientService.runNow()).rejects.toThrow();
      expect(captured).not.toBeNull();
      const cap = captured as unknown as {
        url: string;
        headers: Record<string, string>;
        body: unknown;
      };
      expect(cap.url).toBe('https://cloud.test/sync/pull');

      // Сервер принимает подпись, произведённую настоящим клиентом.
      await request(app.getHttpServer())
        .post('/sync/pull')
        .set(cap.headers)
        .send(cap.body as object)
        .expect(201);

      // Повтор того же (перехваченного) запроса → nonce уже сожжён → 403.
      await request(app.getHttpServer())
        .post('/sync/pull')
        .set(cap.headers)
        .send(cap.body as object)
        .expect(403);
    });

    it('replay: повтор того же nonce → второй запрос 403 «Sync nonce replay»', async () => {
      const body = { since: '2026-07-01T00:00:00.000Z' };
      const headers = sign(body, { nonce: 'fixed-nonce-1' });

      await request(app.getHttpServer())
        .post('/sync/pull')
        .set(headers)
        .send(body)
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/sync/pull')
        .set(headers)
        .send(body)
        .expect(403);
      expect(JSON.stringify(res.body)).toContain('replay');
    });

    it('подделка тела (подписано одно, отправлено другое) → 403', async () => {
      const signedBody = { since: '2026-07-01T00:00:00.000Z' };
      const sentBody = { since: '2020-01-01T00:00:00.000Z' }; // подменили после подписи
      await request(app.getHttpServer())
        .post('/sync/pull')
        .set(sign(signedBody))
        .send(sentBody)
        .expect(403);
    });

    it('подделка nonce (подпись привязана к nonce) → 403', async () => {
      const body = { since: '2026-07-01T00:00:00.000Z' };
      const headers = sign(body, { nonce: 'nonce-A' });
      headers['x-sync-nonce'] = 'nonce-B'; // подпись считалась над nonce-A
      await request(app.getHttpServer())
        .post('/sync/pull')
        .set(headers)
        .send(body)
        .expect(403);
    });

    it('чужой секрет → 403', async () => {
      const body = { since: '2026-07-01T00:00:00.000Z' };
      await request(app.getHttpServer())
        .post('/sync/pull')
        .set(sign(body, { secret: 'attacker-secret' }))
        .send(body)
        .expect(403);
    });

    it('устаревший timestamp (>5 мин) → 403', async () => {
      const body = { since: '2026-07-01T00:00:00.000Z' };
      await request(app.getHttpServer())
        .post('/sync/pull')
        .set(sign(body, { ts: Date.now() - 6 * 60 * 1000 }))
        .send(body)
        .expect(403);
    });

    it('нет подписи (только node/ts/nonce) → 403', async () => {
      const body = { since: '2026-07-01T00:00:00.000Z' };
      await request(app.getHttpServer())
        .post('/sync/pull')
        .set('x-sync-node', NODE)
        .set('x-sync-timestamp', String(Date.now()))
        .set('x-sync-nonce', randomUUID())
        .send(body)
        .expect(403);
    });

    it('неверная подпись НЕ сжигает nonce: тот же nonce с верной подписью потом проходит (201)', async () => {
      const body = { since: '2026-07-01T00:00:00.000Z' };
      const nonce = 'reused-nonce-42';

      // 1) верный nonce, но испорченная подпись → 403 (nonce не должен «сгореть»)
      const bad = sign(body, { nonce });
      bad['x-sync-signature'] = bad['x-sync-signature'].replace(/.$/, '0');
      // гарантируем, что подпись действительно изменилась
      const good = sign(body, { nonce });
      if (bad['x-sync-signature'] === good['x-sync-signature']) {
        bad['x-sync-signature'] = good['x-sync-signature'].replace(/^./, '0');
      }
      await request(app.getHttpServer())
        .post('/sync/pull')
        .set(bad)
        .send(body)
        .expect(403);

      // 2) тот же nonce с ВЕРНОЙ подписью → 201 (значит nonce не был записан)
      await request(app.getHttpServer())
        .post('/sync/pull')
        .set(good)
        .send(body)
        .expect(201);
    });

    it('push с валидной подписью → 201 и конверт {applied,skipped,failed}', async () => {
      // Пустой changes → push ничего не применяет, но маршрут/подпись отрабатывают.
      const body = { changes: {}, peer: NODE };
      const res = await request(app.getHttpServer())
        .post('/sync/push')
        .set(sign(body))
        .send(body)
        .expect(201);
      expect(res.body).toEqual(
        expect.objectContaining({ applied: 0, skipped: 0, failed: 0 }),
      );
    });
  });

  // ─────────────── Legacy-режим (общий секрет) ───────────────
  describe('legacy: общий x-sync-secret (node-секретов нет)', () => {
    beforeEach(() => {
      delete process.env.SYNC_NODE_SECRETS;
      delete process.env.SYNC_NODE_SECRET;
      process.env.SYNC_SECRET = LEGACY_SECRET;
      process.env.NODE_ID = NODE;
    });

    it('верный общий секрет → 201', async () => {
      const body = { since: '2026-07-01T00:00:00.000Z' };
      await request(app.getHttpServer())
        .post('/sync/pull')
        .set('x-sync-secret', LEGACY_SECRET)
        .send(body)
        .expect(201);
    });

    it('неверный общий секрет → 403', async () => {
      const body = { since: '2026-07-01T00:00:00.000Z' };
      await request(app.getHttpServer())
        .post('/sync/pull')
        .set('x-sync-secret', 'wrong')
        .send(body)
        .expect(403);
    });

    it('без секрета → 403', async () => {
      const body = { since: '2026-07-01T00:00:00.000Z' };
      await request(app.getHttpServer())
        .post('/sync/pull')
        .send(body)
        .expect(403);
    });
  });

  // ─────── Гарантии, честно проверяемые только на ЖИВОЙ БД (Postgres) ───────
  it.todo(
    'ЖИВАЯ БД: durable-replay — SyncNonce.@@unique(node,nonce) отклоняет повтор ПОСЛЕ рестарта процесса и на втором инстансе (реальный P2002, не мок)',
  );
  it.todo(
    'ЖИВАЯ БД: push атомарен — upsert строки и raw-UPDATE updatedAt/syncNode применяются вместе или никак (крах между шагами не оставляет строку-эхо)',
  );
  it.todo(
    'ЖИВАЯ БД: overlap-окно реально ловит строку долгой транзакции, чей updatedAt < until, но коммит произошёл после wall-clock until',
  );
});
