import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac } from 'crypto';
import { SyncService } from './sync.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Юнит-тесты оркестратора синхронизации SyncService.runNow() и клиентской
 * подписи (callCloud).
 *
 * runNow() — это ОДИН цикл облако↔локал. Его нетривиальная бизнес-логика (та,
 * из-за которой раньше терялись данные):
 *   1) курсор двигается ТОЛЬКО если весь батч применился без ошибок
 *      (cloudFailed===0 / localFailed===0). Иначе упавшие строки, исключённые
 *      `updatedAt > cursor`, были бы потеряны навсегда — на следующем цикле
 *      окно перечитывается (P0-13).
 *   2) курсор ставится НЕ на серверный `until`, а на `until − 5 мин`
 *      (overlap-окно). Строки долгих транзакций получают updatedAt в момент
 *      statement'а, ДО коммита; wall-clock `until` мог бы исключить их. Перекрытие
 *      + идемпотентный upsert ловят их на следующем цикле (P0-14).
 *
 * pull/push/heartbeat здесь заспаены — их собственная логика к решениям runNow
 * отношения не имеет; проверяем именно КОНТРАКТ runNow: какой курсор он сдвигает
 * и на какую метку. Реальный побочный эффект — запись в SyncCursor — проверяем
 * на настоящем моке prisma.syncCursor.upsert.
 *
 * callCloud (клиент) подписывает запрос так же, как сервер (SyncController.check)
 * его проверяет: HMAC-SHA256(secret) над `node.ts.nonce.sha256(body)` + одноразовый
 * nonce. Здесь доказываем КЛИЕНТСКУЮ половину: подпись привязана к телу и nonce, а
 * nonce уникален на каждый запрос. Серверную половину и их совместимость проверяет
 * sync.controller.spec.ts (там реальная подпись этого клиента принимается сервером).
 */

const OVERLAP_MS = 5 * 60 * 1000; // −5 мин, как в sync.service.ts
const T_CLOUD = '2026-07-23T10:00:00.000Z';
const T_LOCAL = '2026-07-23T11:30:00.000Z';

type SyncCursorMock = {
  findUnique: jest.Mock;
  upsert: jest.Mock;
};

function makePrisma(): { syncCursor: SyncCursorMock } {
  return {
    syncCursor: {
      // getCursor: курсора ещё нет → since = epoch
      findUnique: jest.fn(async () => null),
      // setCursor + heartbeat
      upsert: jest.fn(async () => ({})),
    },
  };
}

// Метка времени, записанная в курсор для данного peer (или undefined, если
// setCursor для него не вызывался — значит курсор НЕ сдвинут).
function cursorWrittenFor(
  upsert: jest.Mock,
  peer: string,
): Date | undefined {
  const call = upsert.mock.calls
    .map((c) => c[0])
    .find((arg) => arg?.where?.peer === peer);
  if (!call) return undefined;
  // create.lastPullAt и update.lastPullAt равны new Date(ts)
  return call.update?.lastPullAt ?? call.create?.lastPullAt;
}

const realFetch = global.fetch;
const ORIG_ENV = { ...process.env };

describe('SyncService.runNow — курсор/overlap/guard (без потери данных)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: SyncService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new SyncService(prisma as unknown as PrismaService);
    process.env.CLOUD_API = 'https://cloud.test';
    process.env.SYNC_SECRET = 'legacy-secret';
    process.env.NODE_ID = 'K1';
    delete process.env.SYNC_NODE_SECRET; // без клиентской подписи — проще заголовки
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
    (global as unknown as { fetch: typeof fetch }).fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('всё применилось (failed=0): оба курсора сдвигаются РОВНО на until − 5 мин (overlap)', async () => {
    // Облако отдало 1 строку; локальный push применил её без ошибок.
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(
      async (url: string) => {
        if (url.endsWith('/sync/pull')) {
          return {
            ok: true,
            json: async () => ({
              until: T_CLOUD,
              changes: { order: [{ id: 'o1', updatedAt: T_CLOUD }] },
            }),
          };
        }
        throw new Error('unexpected fetch ' + url);
      },
    );
    const pushSpy = jest
      .spyOn(service, 'push')
      .mockResolvedValue({ applied: 1, skipped: 0, failed: 0 });
    // Локальных изменений нет → callCloud('/sync/push') не дёргается.
    jest
      .spyOn(service, 'pull')
      .mockResolvedValue({ until: T_LOCAL, changes: {} } as never);

    const res = await service.runNow();

    // down = применённые из облака; up = 0 (локальных не было).
    expect(res).toEqual(
      expect.objectContaining({ ok: true, up: 0, down: 1 }),
    );
    expect(pushSpy).toHaveBeenCalledWith(
      { order: [{ id: 'o1', updatedAt: T_CLOUD }] },
      'CLOUD',
    );

    // Курсоры сдвинуты на серверный until МИНУС 5 минут (а не на until).
    const cloudCursor = cursorWrittenFor(prisma.syncCursor.upsert, 'cloudPull');
    const localCursor = cursorWrittenFor(prisma.syncCursor.upsert, 'localPull');
    expect(cloudCursor?.toISOString()).toBe(
      new Date(new Date(T_CLOUD).getTime() - OVERLAP_MS).toISOString(),
    );
    expect(localCursor?.toISOString()).toBe(
      new Date(new Date(T_LOCAL).getTime() - OVERLAP_MS).toISOString(),
    );
    // heartbeat отметился отдельным peer'ом.
    expect(cursorWrittenFor(prisma.syncCursor.upsert, 'heartbeat')).toBeDefined();
  });

  it('overlap смотрит строго НАЗАД: записанная метка < until ровно на 5 мин (поздние коммиты перечитаются)', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(
      async () => ({
        ok: true,
        json: async () => ({ until: T_CLOUD, changes: {} }),
      }),
    );
    jest
      .spyOn(service, 'pull')
      .mockResolvedValue({ until: T_CLOUD, changes: {} } as never);

    await service.runNow();

    const written = cursorWrittenFor(prisma.syncCursor.upsert, 'cloudPull');
    expect(written).toBeDefined();
    const delta = new Date(T_CLOUD).getTime() - (written as Date).getTime();
    expect(delta).toBe(OVERLAP_MS); // строго 5 минут назад
    expect((written as Date).getTime()).toBeLessThan(new Date(T_CLOUD).getTime());
  });

  it('облачный push с failed>0: курсор cloudPull НЕ двигается (упавшие строки не теряются)', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(
      async (url: string) => {
        if (url.endsWith('/sync/pull')) {
          return {
            ok: true,
            json: async () => ({
              until: T_CLOUD,
              changes: { order: [{ id: 'o1', updatedAt: T_CLOUD }] },
            }),
          };
        }
        throw new Error('unexpected fetch ' + url);
      },
    );
    // 2 строки не применились (FK-каскад/дедлок/конфликт).
    jest
      .spyOn(service, 'push')
      .mockResolvedValue({ applied: 0, skipped: 0, failed: 2 });
    jest
      .spyOn(service, 'pull')
      .mockResolvedValue({ until: T_LOCAL, changes: {} } as never);

    await service.runNow();

    // Ключевое: cloudPull НЕ сдвинут → окно перечитается на следующем цикле.
    expect(
      cursorWrittenFor(prisma.syncCursor.upsert, 'cloudPull'),
    ).toBeUndefined();
    // localPull (там ошибок нет) сдвинулся штатно — независимая ветка.
    expect(
      cursorWrittenFor(prisma.syncCursor.upsert, 'localPull'),
    ).toBeDefined();
  });

  it('локальный push в облако с failed>0: курсор localPull НЕ двигается (cloudPull при этом сдвинут)', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(
      async (url: string) => {
        if (url.endsWith('/sync/pull')) {
          // из облака ничего → cloudFailed=0 → cloudPull сдвинется
          return {
            ok: true,
            json: async () => ({ until: T_CLOUD, changes: {} }),
          };
        }
        if (url.endsWith('/sync/push')) {
          // облако не приняло часть строк
          return { ok: true, json: async () => ({ applied: 1, failed: 3 }) };
        }
        throw new Error('unexpected fetch ' + url);
      },
    );
    jest.spyOn(service, 'pull').mockResolvedValue({
      until: T_LOCAL,
      changes: { order: [{ id: 'o2', updatedAt: T_LOCAL }] },
    } as never);

    const res = await service.runNow();

    expect(res).toEqual(expect.objectContaining({ up: 1 }));
    // localPull НЕ сдвинут (up-направление частично упало).
    expect(
      cursorWrittenFor(prisma.syncCursor.upsert, 'localPull'),
    ).toBeUndefined();
    // cloudPull сдвинут: его ветка отработала чисто.
    expect(
      cursorWrittenFor(prisma.syncCursor.upsert, 'cloudPull'),
    ).toBeDefined();
  });

  it('не настроено (нет CLOUD_API) → BadRequest, ни одного курсора не трогаем', async () => {
    delete process.env.CLOUD_API;
    await expect(service.runNow()).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.syncCursor.upsert).not.toHaveBeenCalled();
  });

  it('облако ответило не-2xx → ServiceUnavailable (цикл прерван, курсор не двигаем)', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({}),
    }));
    await expect(service.runNow()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(
      cursorWrittenFor(prisma.syncCursor.upsert, 'cloudPull'),
    ).toBeUndefined();
  });
});

describe('SyncService.callCloud — клиентская HMAC-подпись (тело + одноразовый nonce)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: SyncService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new SyncService(prisma as unknown as PrismaService);
    process.env.CLOUD_API = 'https://cloud.test';
    process.env.SYNC_SECRET = 'legacy-secret';
    process.env.NODE_ID = 'K7';
    process.env.SYNC_NODE_SECRET = 'node-secret-xyz'; // включает подпись
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
    (global as unknown as { fetch: typeof fetch }).fetch = realFetch;
    jest.restoreAllMocks();
  });

  // Перехватываем ПЕРВЫЙ исходящий запрос (callCloud('/sync/pull', …)) и рвём
  // цикл (503), чтобы не мокать весь runNow. Возвращаем заголовки этого запроса.
  async function captureFirstCall(): Promise<{
    url: string;
    headers: Record<string, string>;
    body: unknown;
  }> {
    let captured: {
      url: string;
      headers: Record<string, string>;
      body: unknown;
    } | null = null;
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(
      async (url: string, init: { headers: Record<string, string>; body: string }) => {
        captured = {
          url,
          headers: init.headers,
          body: JSON.parse(init.body),
        };
        return { ok: false, status: 503, json: async () => ({}) };
      },
    );
    await expect(service.runNow()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    if (!captured) throw new Error('fetch не был вызван');
    return captured;
  }

  it('подпись = HMAC-SHA256(secret) над `node.ts.nonce.sha256(body)` и жёстко привязана к телу', async () => {
    const { url, headers, body } = await captureFirstCall();

    expect(url).toBe('https://cloud.test/sync/pull');
    expect(headers['x-sync-node']).toBe('K7');
    expect(headers['x-sync-nonce']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(headers['x-sync-timestamp']).toMatch(/^\d+$/);

    // Независимо пересобираем ожидаемую подпись по протоколу.
    const bodyHash = createHash('sha256')
      .update(JSON.stringify(body))
      .digest('hex');
    const expected = createHmac('sha256', 'node-secret-xyz')
      .update(
        `K7.${headers['x-sync-timestamp']}.${headers['x-sync-nonce']}.${bodyHash}`,
      )
      .digest('hex');
    expect(headers['x-sync-signature']).toBe(expected);

    // Привязка к телу: та же ts/nonce, но другое тело → другая подпись.
    const tamperedHash = createHash('sha256')
      .update(JSON.stringify({ since: 'tampered' }))
      .digest('hex');
    const tamperedSig = createHmac('sha256', 'node-secret-xyz')
      .update(
        `K7.${headers['x-sync-timestamp']}.${headers['x-sync-nonce']}.${tamperedHash}`,
      )
      .digest('hex');
    expect(headers['x-sync-signature']).not.toBe(tamperedSig);
  });

  it('nonce одноразовый: два подряд запроса используют РАЗНЫЕ nonce', async () => {
    const first = await captureFirstCall();
    const second = await captureFirstCall();
    expect(first.headers['x-sync-nonce']).not.toBe(
      second.headers['x-sync-nonce'],
    );
    // и подписи, соответственно, тоже разные
    expect(first.headers['x-sync-signature']).not.toBe(
      second.headers['x-sync-signature'],
    );
  });
});
