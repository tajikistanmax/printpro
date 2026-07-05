# PrintPro — Добивка prod-readiness (2026-07-05)

Консолидация финального прохода по оставшимся находкам. Собрано из per-domain fix-отчётов (7 бэкенд-доменов + фронтенд) и QA-прогонов. Правки исходного кода в рамках этой сводки **не вносились** — только фиксация результатов.

Затронутые домены: `orders`, `warehouse` (stock + products/catalog), `reports`, `production`, `purchasing`, `public API`, `sync`, `printpro-web` (dashboard + POS-скины).

---

## 1. Сводка по статусам

| Статус | Кол-во | Что означает |
|---|---:|---|
| **fixed** | 23 | Реально исправлено в этом проходе, код изменён |
| **already-fixed** | 3 | Уже было закрыто в предыдущей сессии, изменений не требовалось |
| **false-positive** | 4 | Проверено — не дефект / безвредный defensive-guard |
| **needs-schema-migration** | 3 | Нельзя закрыть кодом сервиса — нужна миграция схемы Prisma |
| **needs-owner-decision** | 2 | Бизнес-политика — требуется решение владельца (выделено из примечаний, формального статуса не имели) |
| **skipped** (low-value) | 3 | Осознанно оставлено: низкая ценность или завязано на будущую миграцию |
| **Итого разобрано** | 36 | |

### Разбивка fixed по доменам
- **orders** — 4: промо/бонусы против обнулённого total (601); двойной реверс бонусов при full-refund после частичного (919/920); идемпотентность `create()` (58); dedup запроса истории возвратов в `refund()`.
- **warehouse** — 5: `receive()` afterQty из-под row-lock (78); `recount`/`recountBulk` FOR UPDATE против lost-update (340); `removeUnit` soft-delete + блокировка при ссылках (593); циклы в дереве категорий `updateCategory` (443); `stats.todayReceipts` исключает soft-deleted приёмки.
- **reports** — 4: сверка кассы только по закрытым сменам (1077); `cashCollectionRate`/`debtGrowth` на одной когорте заказов (170); reconciliation вёдер payables aging к заголовку (1218); `onTimeRate` знаменатель только по job'ам с дедлайном (1773).
- **production** — 3: реверс списания материалов при уходе из COMPLETED (97); лог при no-op `writeOffMaterials` без branchId (116); 400 вместо 500 при загрузке фото без файла (controller 90).
- **purchasing** — 1: запрет долговой приёмки без `supplierId` (orphan-долг).
- **public API** — 2: канонический номер заказа `ORD-C-YYYY-NNNNNN` (107); `@ValidateNested`/`@Type` для `files[]` (41).
- **sync** — 1: атомарность upsert + сброс `updatedAt`/`syncNode` в одной транзакции (M-147).
- **printpro-web** — 3: гварды DEBT/наличных на кнопке «Сохранить заказ» (`_pos.tsx:644`); KPI/разбивка статусов из `/orders/stats` вместо capped-200 (dashboard); `money()` с округлением и null-guard.

---

## 2. Что реально изменено (по файлам)

Изменённых файлов — **11** (9 API + 2 web). Все правки внутренние/аддитивные: без изменений схемы, DTO и публичных сигнатур (кроме перечисленного).

| Файл | Домен | Суть изменений |
|---|---|---|
| `printpro-api/src/orders/orders.service.ts` | orders | Последовательное применение скидок (ручная→промокод→бонусы) от остатка в `quickSale`; промокод/бонусы не расходуются при обнулённом total. Реверс бонусов в `refund()` от текущего `order.paid` (без двойного сторно). Идемпотентность `create()` (pre-check + catch P2002). Dedup запроса истории возвратов. |
| `printpro-api/src/warehouse/stock.service.ts` | warehouse/stock | `receive()`: атомарный upsert под row-lock раньше вычисления afterQty. `recount()`/`recountBulk()`: `SELECT … FOR UPDATE` перед чтением базы. `stats.todayReceipts`: фильтр `deletedAt:null`. |
| `printpro-api/src/warehouse/products.service.ts` | warehouse/catalog | `removeUnit`: блок при активных ссылках + soft-delete вместо hard-delete; `findUnits`/`importProducts` фильтруют `deletedAt:null`. `updateCategory`: обход цепочки предков против многоуровневых циклов. |
| `printpro-api/src/reports/reports.service.ts` | reports | Сверка кассы только по CLOSED-сменам с привязкой по `shiftId`; `cohortCollected` для `cashCollectionRate`/`debtGrowth`; residual-reconciliation вёдер payables aging; `onTimeEligible`-знаменатель. |
| `printpro-api/src/production/production.service.ts` | production | Новый `reverseMaterialWriteOff` (идемпотентный claim через `updateMany`, компенсирующее движение `IN`) + ветка реверса при уходе из COMPLETED в `updateStatus`; Logger + `warn` при no-op без branchId. |
| `printpro-api/src/production/production.controller.ts` | production | `BadRequestException` при отсутствии файла в загрузке фото (400 вместо 500). |
| `printpro-api/src/purchasing/purchasing.service.ts` | purchasing | Guard перед транзакцией: долговая приёмка (`debt>0`) без `supplierId` отклоняется `BadRequestException`. |
| `printpro-api/src/public/public.controller.ts` | public API | Канонический номер через `docNumber('ORD', …, 6)` (+import); `@ValidateNested({each:true})`+`@Type(()=>PublicFileDto)` на `files[]` (+import class-transformer). |
| `printpro-api/src/sync/sync.service.ts` | sync | Upsert + raw `UPDATE` (сброс `updatedAt`/`syncNode`) обёрнуты в единую интерактивную `$transaction`. |
| `printpro-web/src/app/(panel)/pos/_pos.tsx` | web/POS | Кнопка «Сохранить заказ»: те же гварды, что у «Оплатить» — CASH → окно сдачи, `disabled` учитывает mixed-остаток и DEBT без клиента. |
| `printpro-web/src/app/(panel)/dashboard/page.tsx` | web/dashboard | Fetch `/orders/stats`; KPI и «Заказы по статусам» из серверного агрегата `byStatus`; `money()` с `Math.round`+null-guard. |

---

## 3. Список на решение владельца (needs-owner-decision)

Формального статуса `needs-owner-decision` в отчётах не было; ниже — вопросы бизнес-политики, всплывшие в примечаниях (сейчас работает как указано, менять без решения владельца не стали):

1. **Кредит-лимит: по валовой сумме или по нетто (после скидки quick-sale)?**
   Сейчас лимит проверяется по gross-`total` **до** применения скидок `quickSale` (`orders.service.ts:143-161`, проверка в `createOrderTx` выполняется раньше скидок). Учитывать скидку — значит прокидывать нетто в проверку/переставлять порядок; это уже вопрос политики. Решить: лимит считаем по gross или net?

2. **Публичное создание заказа: жёсткий префикс `ORD` или из настройки `orderPrefix`?**
   Сейчас публичный путь (`public.controller.ts`) хардкодит префикс `'ORD'` (как и соседний `publicReorder`), чтобы не тянуть settings-запрос. Внутренний `orders.service.create` читает настройку. Решить: унифицировать публичный путь с чтением `orderPrefix` (ценой доп. запроса) или оставить фиксированный `ORD`.

---

## 4. Список needs-schema-migration (что и зачем)

Три находки нельзя закрыть кодом сервиса — требуется миграция Prisma-схемы. Все три из домена warehouse/catalog.

1. **(65) Идемпотентность stock-мутаций** — `receive`/`adjust`/`transfer`/`writeOff`.
   *Зачем:* двойной сабмит POST дублирует движения склада; у `StockMovement`/`WriteOff` нет `idempotencyKey` (есть только у Order/Payment).
   *Что нужно:* (a) добавить `idempotencyKey String? @unique` в модели `StockMovement` (и `WriteOff`); (b) опциональный `idempotencyKey?` в соответствующие DTO; (c) сервисный check-then-create + catch P2002 по образцу `orders.service.ts`.

2. **(367) `ProductBarcodeAlias.barcode @unique` глобальный, без `companyId`** → cross-tenant P2002.
   *Зачем:* штрихкод-алиас одной компании блокирует создание такого же у другой (нарушение изоляции арендаторов).
   *Что нужно:* добавить `companyId` в `ProductBarcodeAlias` (`schema.prisma:564`) и заменить глобальный `@unique` на company-scoped уникальность — `@@unique([companyId, barcode])` или partial unique index `WHERE deletedAt IS NULL`.

3. **(540) Soft-delete продукта навечно резервирует его alias-штрихкоды глобально.**
   *Зачем:* тот же корень, что и 367 — глобальный `@unique` игнорирует soft-delete, код остаётся занят навсегда, при этом `assertBarcodeFree` считает его свободным → рассинхрон app↔DB, всплывает как P2002.
   *Что нужно:* partial unique index `WHERE deletedAt IS NULL` (схема) + soft-delete алиасов в `removeProduct`. Закрывается вместе с 367.

> Связанная low-находка `removeBarcodeAlias` (hard-delete без sync-tombstone) осознанно отложена — корректный tombstone возможен только после этой же partial-unique миграции.

---

## 5. Состояние сборки

| Проверка | Результат |
|---|---|
| API `tsc --noEmit` | PASS (exit 0, ошибок типов нет) |
| API `nest build` | PASS (exit 0) |
| API тесты (`npm test --runInBand`) | PASS — 2 сьюта, 14 тестов, 0 упавших (0.958s) |
| Web `tsc --noEmit` | PASS (exit 0, ошибок нет) |
| REPAIR-проход | пропущен (API зелёный) |

**Итог:** сборка и типы зелёные на API и Web; тесты проходят. Оставшиеся открытые пункты не блокируют сборку — это 3 миграции схемы и 2 решения владельца (см. §3–4).
