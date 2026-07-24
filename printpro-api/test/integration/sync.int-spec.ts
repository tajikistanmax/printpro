import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SyncService } from '../../src/sync/sync.service';
import { makePrisma, truncateAll } from './_db';

/**
 * Интеграционные тесты SyncService на ЖИВОМ Postgres — гарантии УРОВНЯ БД,
 * которые моки проверить не могут. durable-replay (UNIQUE(node,nonce) под гонкой)
 * уже доказан в harness.int-spec.ts — здесь НЕ дублируется.
 *
 * Конструктор сервиса — только PrismaService (см. sync.service.spec.ts:
 *   new SyncService(prisma)). Внешних I/O-зависимостей у него нет: pull/push
 *   работают напрямую с БД, поэтому заглушки не нужны — берём настоящий Prisma.
 *
 * Подопытная модель — productCategory / таблица "ProductCategory":
 *   • НЕ в SENSITIVE_SYNC_MODELS → pull/push реально её обрабатывают (не skip);
 *   • минимум обязательных полей (companyId + name) → чистый seed;
 *   • есть @updatedAt и syncNode → ровно те столбцы, вокруг которых крутится
 *     двухшаговая транзакция push и overlap-окно pull.
 */

const OVERLAP_MS = 5 * 60 * 1000; // −5 мин, как в sync.service.ts (runNow/cursorFrom)

/** Родитель для FK: Company (обязательное поле — только name). */
async function seedCompany(prisma: PrismaService, name = 'Sync Test Co') {
  return prisma.company.create({ data: { name } });
}

type Row = { id: string };
const hasId = (rows: unknown[] | undefined, id: string): boolean =>
  (rows as Row[] | undefined)?.some((r) => r.id === id) ?? false;

describe('Интеграция (живой Postgres): SyncService — гарантии уровня БД', () => {
  let prisma: PrismaService;
  let service: SyncService;

  beforeAll(async () => {
    prisma = makePrisma();
    await prisma.$connect();
    service = new SyncService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  /**
   * push атомарен: upsert строки и raw-UPDATE (updatedAt + syncNode) выполняются
   * ОДНОЙ транзакцией (M-147) — вместе или никак.
   *
   * Как валим ИМЕННО второй шаг, не трогая первый: в push `data` для upsert — это
   * строка БЕЗ updatedAt (его удаляют перед upsert'ом), а исходный updatedAt
   * пишется только на втором шаге:
   *     UPDATE "ProductCategory" SET "updatedAt"=$1, "syncNode"=$2 WHERE id=$3
   * updatedAt берём вне диапазона timestamp, но валидный (finite) в JS: он проходит
   * guard Number.isFinite в push, но бросает при bind'е в этот raw-UPDATE. Бросок
   * случается ПОСЛЕ того, как upsert шага 1 реально отработал на сервере внутри той
   * же транзакции, — и БД откатывает его. upsert сам по себе успешен (доказано
   * позитивным контролем) → откат строки — заслуга транзакции, а не плохого upsert.
   */
  it('push атомарен: провал raw-UPDATE(updatedAt/syncNode) откатывает upsert строки (вместе или никак)', async () => {
    const company = await seedCompany(prisma);

    // --- Позитивный контроль: та же форма строки, но с ВАЛИДНЫМ updatedAt.
    // Оба шага коммитятся: строка есть, updatedAt = исходный, syncNode = peer.
    const okId = randomUUID();
    const okTs = new Date('2026-07-01T00:00:00.000Z');
    const okRes = await service.push({
      productCategory: [{ id: okId, companyId: company.id, name: 'OK cat', updatedAt: okTs }],
    });
    expect(okRes).toEqual({ applied: 1, skipped: 0, failed: 0 });

    const okRow = await prisma.productCategory.findUnique({ where: { id: okId } });
    expect(okRow).not.toBeNull();
    // Шаг 2 РЕАЛЬНО применился: syncNode ставится ТОЛЬКО на втором шаге (upsert
    // из шага 1 оставляет его NULL) → 'peer' доказывает, что raw-UPDATE отработал.
    expect(okRow!.syncNode).toBe('peer');
    // И updatedAt — это ПРИСЛАННАЯ метка (июль-01), а не авто-now() (сейчас июль-24).
    // Столбец — timestamp without time zone: raw-bind Date конвертируется через
    // session TZ БД, поэтому сравниваем инстант с допуском в пределах суток.
    expect(Math.abs(okRow!.updatedAt.getTime() - okTs.getTime())).toBeLessThan(24 * 60 * 60 * 1000);

    // --- Атомарность: НОВАЯ строка, updatedAt вне диапазона PG timestamp.
    // Шаг 1 (upsert без updatedAt) прошёл бы; шаг 2 (raw UPDATE updatedAt) падает.
    const badId = randomUUID();
    const extreme = new Date(-8_000_000_000_000_000); // finite в JS, но вне диапазона timestamp
    expect(Number.isFinite(extreme.getTime())).toBe(true); // пройдёт guard Number.isFinite в push

    const badRes = await service.push({
      productCategory: [{ id: badId, companyId: company.id, name: 'ROLLED BACK', updatedAt: extreme }],
    });
    // Строка учтена как failed (не skipped) — значит вошла в транзакцию и упала на шаге 2.
    expect(badRes).toEqual({ applied: 0, skipped: 0, failed: 1 });

    // ИНВАРИАНТ В БД: строки badId нет — upsert откатился вместе с провалившимся UPDATE.
    const badRow = await prisma.productCategory.findUnique({ where: { id: badId } });
    expect(badRow).toBeNull();

    // Никаких частичных эффектов: всего одна строка — только позитивный контроль.
    expect(await prisma.productCategory.count()).toBe(1);
  });

  /**
   * overlap-окно −5 мин РЕАЛЬНО перечитывает строку, чей КОММИТ произошёл после
   * wall-clock `until` (P0-14). Воспроизводим настоящей конкурентной транзакцией:
   *
   *   1) Долгая транзакция вставляет строку → её @updatedAt = момент statement'а
   *      (T1), но КОММИТ откладываем (держим tx открытой).
   *   2) Пока tx не закоммичена, вызываем pull(epoch): он берёт until=U (wall clock)
   *      и по MVCC (READ COMMITTED, другое соединение из пула) строку НЕ видит.
   *      Значит коммит строки заведомо произойдёт ПОЗЖЕ U, а T1 <= U.
   *   3) Коммитим.
   *   4) Наивный курсор (since = until): строка ПОТЕРЯНА — updatedAt(T1) не > U.
   *   5) Overlap-курсор (since = until − 5 мин): строка ПЕРЕЧИТАНА — T1 > U−5мин.
   *
   * Это ровно то, что моки показать не могут: видимость по коммиту (MVCC) и то,
   * что окно перекрытия спасает поздний коммит от «тихой потери» узким курсором.
   */
  it('overlap −5 мин перечитывает строку, чей коммит произошёл ПОСЛЕ wall-clock until (MVCC)', async () => {
    const company = await seedCompany(prisma);
    const catId = randomUUID();

    // Барьеры координации между открытой транзакцией и внешними pull'ами.
    let signalInserted!: (updatedAt: Date) => void;
    const inserted = new Promise<Date>((res) => {
      signalInserted = res;
    });
    let release!: () => void;
    const held = new Promise<void>((res) => {
      release = res;
    });

    // Долгая транзакция: вставила строку (updatedAt = statement time), но не коммитит.
    const txPromise = prisma.$transaction(
      async (tx) => {
        const r = await tx.productCategory.create({
          data: { id: catId, companyId: company.id, name: 'Late-commit cat' },
        });
        signalInserted(r.updatedAt);
        await held; // держим транзакцию открытой (коммит откладываем)
      },
      { timeout: 20_000, maxWait: 20_000 },
    );

    const rUpdatedAt = await inserted; // строка вставлена, НО ещё не закоммичена

    // (2) pull во время открытой транзакции: фиксируем until=U; строка невидима (MVCC).
    const duringOpen = await service.pull(new Date(0).toISOString());
    const U = duringOpen.until;
    expect(hasId(duringOpen.changes.productCategory, catId)).toBe(false);

    // (3) Коммит — строго ПОСЛЕ того, как pull зафиксировал until=U.
    release();
    await txPromise;

    // Санити: updatedAt строки <= until и внутри окна перекрытия.
    expect(rUpdatedAt.getTime()).toBeLessThanOrEqual(new Date(U).getTime());
    expect(rUpdatedAt.getTime()).toBeGreaterThan(new Date(U).getTime() - OVERLAP_MS);

    // (4) Наивный курсор = until: строка потеряна (updatedAt не > until).
    const naive = await service.pull(U);
    expect(hasId(naive.changes.productCategory, catId)).toBe(false);

    // (5) Overlap-курсор = until − 5 мин: строка перечитана.
    const overlapSince = new Date(new Date(U).getTime() - OVERLAP_MS).toISOString();
    const overlap = await service.pull(overlapSince);
    expect(hasId(overlap.changes.productCategory, catId)).toBe(true);
  });
});
