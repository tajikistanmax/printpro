# Deep Research Audit: PrintPro

Дата аудита: 2026-07-05  
Проект: `D:\Projects\Printpro`  
Проверенные зоны: `printpro-api`, `printpro-web`, `docs`, Prisma-схема, тесты, права доступа, деньги, склад, POS, производство, дизайн, отчеты, синхронизация.

## 1. Короткий вывод

PrintPro уже выглядит не как простой сайт, а как внутренняя mini-ERP/MIS для типографии: есть заказы, POS, касса, склад, товары, услуги, закупки, производство, дизайн-макеты, роли, аудит, синхронизация, отчеты, зарплата, клиенты, рекламации и публичные онлайн-заказы.

Но до состояния "я бы писал эту платформу для себя и доверил ей деньги, склад и производство" пока нельзя считать систему готовой. Главная проблема не в количестве модулей, а в жесткости инвариантов:

- часть старых модулей не соблюдает tenant isolation и доверяет `companyId` из query/body;
- часть API защищена только логином, но не правами;
- справочник услуг вообще открыт без `JwtAuthGuard`;
- финансовые и складские операции местами не имеют полной идемпотентности;
- возвраты, cashflow, Z-отчеты и production write-off могут давать расхождения;
- тестовая пирамида практически отсутствует;
- frontend build проходит, но lint красный: 403 проблемы.

## 2. Как проводился аудит

Я запустил доступный лимит параллельных агентов. Инструмент разрешил 6 активных sub-agent потоков вместо запрошенных 10-20. Роли:

- Staff Backend Engineer
- Staff Frontend Engineer
- Data Architect / DBA
- QA Lead / Test Architect
- Security Engineer
- FinOps / Retail Operations Analyst

Параллельно я сам проверил ключевые файлы, маршруты, транзакции, DTO, guards, отчеты, загрузки файлов, тесты и текущее состояние документа.

## 3. Позитивная база

Важно: проект не пустой и не игрушечный. Уже есть сильные решения:

- NestJS + Prisma + PostgreSQL, модульная структура backend.
- Богатая Prisma-схема: `Order`, `OrderItem`, `Payment`, `CashShift`, `Stock`, `StockMovement`, `Service`, `ServiceMaterial`, `ProductionJob`, `DesignProof`, `AuditLog`, `Role`, `Permission`.
- У заказов есть `idempotencyKey` для POS.
- У оплаты заказа есть optimistic update по `paid`.
- У склада есть атомарные `updateMany` проверки при списании товаров.
- У кассовых смен есть защита от двух открытых смен на кассира.
- Есть глобальный `ValidationPipe({ whitelist: true })`.
- Есть `AuditInterceptor`, зарегистрированный глобально.
- Для обычных image upload запретили SVG/HTML и ограничили MIME/extension.
- В более новых контроллерах часто уже берется `companyId` из JWT, а не из клиента.
- API unit/e2e smoke тесты проходят.
- Frontend build проходит.

Эта база хорошая. Но она пока неравномерная: новые модули аккуратнее старых.

## 4. P0: исправить первым

### P0-1. `services` и `service-categories` фактически публичные

Статус: подтверждено  
Серьезность: Critical  
Приоритет: P0  
Модуль: услуги, цены, себестоимость, BOM материалов

Доказательства:

- `printpro-api/src/services/services.controller.ts:15`
- `printpro-api/src/services/service-categories.controller.ts:5`

Проблема:

`ServicesController` и `ServiceCategoriesController` не используют `JwtAuthGuard`, `PermissionsGuard` и `@RequirePermissions`. При этом через них можно создавать, менять и удалять услуги, категории, нормы материалов, цены и себестоимость.

Влияние на бизнес:

Любой, кто достучится до API, может изменить прайс, себестоимость, структуру услуг или нормы расхода материалов. Это напрямую ломает POS, прибыль, производство, отчеты и склад.

Как исправить:

- Добавить `@UseGuards(JwtAuthGuard, PermissionsGuard)`.
- На чтение поставить `services.view`.
- На мутации поставить `services.manage`.
- Брать `companyId` только из `@CurrentUser()`.
- Во всех update/delete проверять ownership записи по `companyId`.
- Добавить e2e тесты на 401/403.

### P0-2. Отчеты читают `companyId` из query

Статус: подтверждено  
Серьезность: Critical  
Приоритет: P0  
Модуль: отчеты, финансы, склад, долги, персонал

Доказательства:

- `printpro-api/src/reports/reports.controller.ts:16`
- `printpro-api/src/reports/reports.controller.ts:35`
- `printpro-api/src/reports/reports.controller.ts:61`
- `printpro-api/src/reports/reports.controller.ts:101`
- `printpro-api/src/reports/reports.controller.ts:176`
- `printpro-api/src/reports/reports.controller.ts:223`
- `printpro-api/src/reports/reports.controller.ts:278`

Проблема:

Контроллер защищен `JwtAuthGuard` и `reports.view`, но почти все методы берут `companyId` из query. Пользователь с правом отчетов может подставить чужой `companyId` и получить финансовые сводки, долги, склад, заказы, staff performance.

Как исправить:

- Убрать `@Query('companyId')` из отчетов.
- Добавить `@CurrentUser()` и всегда передавать `user.companyId`.
- Проверять `branchId`, `clientId`, `productId`, `supplierId` на принадлежность компании.
- Добавить e2e тест: пользователь компании A не получает отчеты компании B.

### P0-3. Склад и товары защищены логином, но не правами

Статус: подтверждено  
Серьезность: Critical/High  
Приоритет: P0  
Модуль: склад, товары, категории, единицы, импорт

Доказательства:

- `printpro-api/src/auth/permissions.guard.ts:24`
- `printpro-api/src/warehouse/stock.controller.ts:18`
- `printpro-api/src/warehouse/products.controller.ts:26`
- `printpro-api/src/warehouse/products.controller.ts:32`
- `printpro-api/src/warehouse/products.controller.ts:62`
- `printpro-api/src/warehouse/products.controller.ts:98`

Проблема:

`PermissionsGuard` пропускает маршруты, если на них нет `@RequirePermissions`. В `StockController` и `ProductsController` guard подключен, но permissions на методы почти не выставлены.

Влияние:

Любой авторизованный пользователь может потенциально менять склад, товары, штрихкоды, категории, единицы, импортировать каталог, списывать или пересчитывать остатки.

Как исправить:

- На чтение склада и товаров: `stock.view`.
- На приход, списание, перенос, пересчет, импорт, создание/редактирование/удаление товаров: `stock.manage`.
- Рассмотреть deny-by-default поведение для `PermissionsGuard` на контроллерах с `PermissionsGuard`.

### P0-4. Cross-tenant роль-менеджмент

Статус: подтверждено  
Серьезность: High  
Приоритет: P0  
Модуль: роли и права

Доказательства:

- `printpro-api/src/roles/roles.controller.ts:32`
- `printpro-api/src/roles/roles.controller.ts:39`
- `printpro-api/src/roles/roles.controller.ts:46`
- `printpro-api/src/roles/roles.service.ts:15`
- `printpro-api/src/roles/roles.service.ts:29`

Проблема:

Роли читаются/создаются по `companyId` из query/body, а установка permissions ищет роль только по `id`.

Влияние:

Пользователь с `roles.manage` может читать или менять роли другой компании, если знает `companyId` или `roleId`.

Как исправить:

- Брать `companyId` из JWT.
- При `setPermissions`, update, delete искать роль через `{ id, companyId: user.companyId }`.
- Запретить изменение системных ролей без отдельного режима миграции/seed.

### P0-5. `sync` API имеет слишком широкую власть через один общий секрет

Статус: подтверждено  
Серьезность: Critical  
Приоритет: P0  
Модуль: offline-first синхронизация

Доказательства:

- `printpro-api/src/sync/sync.controller.ts:28`
- `printpro-api/src/sync/sync.controller.ts:37`
- `printpro-api/src/sync/sync.service.ts:11`
- `printpro-api/src/sync/sync.service.ts:101`

Проблема:

`/sync/pull` и `/sync/push` защищены только `x-sync-secret`. `SyncService` работает с очень чувствительными таблицами: пользователи, роли, платежи, кассовые движения, зарплата, заказы, склад.

Влияние:

Утечка `SYNC_SECRET` дает полный экспорт и возможность массовой записи данных.

Как исправить:

- Перейти на per-node credentials.
- Подписывать payload HMAC с timestamp/nonce.
- Ограничивать peer по company/branch/table allowlist.
- Запретить push в `User`, `RolePermission`, `Payment`, `CashMovement`, `Payroll` без отдельной политики.
- Логировать sync mutations с peer identity.
- Добавить ротацию секретов.

### P0-6. POS quick-sale не атомарен end-to-end

Статус: подтверждено  
Серьезность: High/Critical  
Приоритет: P0  
Модуль: POS, деньги, склад

Доказательства:

- `printpro-api/src/orders/orders.service.ts:116`
- `printpro-api/src/orders/orders.service.ts:421`
- `printpro-api/src/orders/orders.service.ts:452`
- `printpro-api/src/orders/orders.service.ts:536`
- `printpro-api/src/orders/orders.service.ts:579`
- `printpro-api/src/orders/orders.service.ts:586`

Проблема:

`quickSale()` сначала вызывает `create()` с отдельной транзакцией, затем отдельно применяет скидки, бонусы, оплаты, чек, статус `DELIVERED`. При ошибке используется компенсирующий rollback через `refund()`.

Влияние:

Если между шагами будет сбой, можно получить списанный склад без финального чека, частично проведенную оплату, некорректные бонусы или промокод, отмену без полного восстановления.

Как исправить:

- Лучший вариант: собрать quick-sale в одну `$transaction`.
- Альтернатива: ввести state machine `SALE_PENDING`, `COMMITTED`, `FAILED` и recovery job.
- Все побочные эффекты делать идемпотентно.
- Добавить concurrency тесты на double click, timeout, retry.

### P0-7. Возвраты можно задвоить параллельными запросами

Статус: вероятно, требует воспроизведения concurrency тестом  
Серьезность: Critical  
Приоритет: P0  
Модуль: возвраты, деньги, склад

Доказательства:

- `printpro-api/src/orders/orders.service.ts:665`
- `printpro-api/src/orders/orders.service.ts:798`
- `printpro-api/src/orders/orders.service.ts:929`
- `printpro-api/src/orders/orders.service.ts:952`

Проблема:

`refund()` и `createReturn()` читают заказ/прошлые возвраты, затем создают `CashMovement`, `StockMovement`, `Return` и обновляют заказ. Нет идемпотентного ключа возврата и нет атомарного guard по `returnedTotal`/статусу до побочных записей.

Влияние:

Два быстрых запроса могут вернуть деньги или товар дважды.

Как исправить:

- Добавить `idempotencyKey` на возврат.
- Добавить уникальный ключ операции возврата.
- Использовать атомарный `updateMany` guard: статус не отменен, `returnedTotal` прежний.
- Для PostgreSQL рассмотреть transaction isolation/row lock для возвратов.

## 5. P1: высокий риск

### P1-1. `shiftId` можно привязать к чужой или закрытой смене

Статус: подтверждено  
Серьезность: High  
Приоритет: P1  
Модуль: касса, Z/X-отчет

Доказательства:

- `printpro-api/src/cash/cash.controller.ts:46`
- `printpro-api/src/cash/cash.service.ts:87`
- `printpro-api/src/cash/cash.service.ts:137`
- `printpro-api/src/orders/orders.service.ts:316`
- `printpro-api/src/orders/orders.service.ts:351`

Проблема:

`cash.report(id)` ищет смену только по id. `addPayment()` и `addMovement()` принимают `dto.shiftId` и не проверяют, что смена принадлежит той же компании, открыта и допустима для кассира.

Как исправить:

- `report(id, companyId)` должен искать `{ id, companyId }`.
- Если передан `shiftId`, проверять `{ id, companyId, closedAt: null }`.
- Решить политику: только свой `userId` или менеджерская привязка с отдельным правом.

### P1-2. Производство может списывать материалы в минус и без финансового снимка

Статус: подтверждено  
Серьезность: High  
Приоритет: P1  
Модуль: производство, склад, себестоимость

Доказательства:

- `printpro-api/src/production/production.service.ts:135`
- `printpro-api/src/production/production.service.ts:140`
- `printpro-api/src/production/production.service.ts:144`

Проблема:

`writeOffMaterials()` допускает создание отрицательного остатка и decrement без проверки. `StockMovement` для производственного списания не пишет `beforeQty`, `afterQty`, `unitCost`, `totalCost`, `jobId`, `userId`.

Влияние:

Склад может уйти в минус незаметно. Себестоимость заказа невозможно восстановить надежно.

Как исправить:

- Ввести документ `MaterialIssue` или `ProductionMaterialConsumption`.
- Явно разделить режимы: запрет минуса или backorder.
- Фиксировать `beforeQty`, `afterQty`, себестоимость, исполнителя, job/equipment.

### P1-3. Design module ломает tenant isolation

Статус: подтверждено  
Серьезность: High  
Приоритет: P1  
Модуль: дизайн-макеты

Доказательства:

- `printpro-api/src/design/design.controller.ts:31`
- `printpro-api/src/design/design.controller.ts:40`
- `printpro-api/src/design/design.controller.ts:53`
- `printpro-api/src/design/design.service.ts:15`
- `printpro-api/src/design/design.service.ts:111`

Проблема:

Контроллер берет `companyId` из query/body. `ensure(id)` проверяет только id. Update/status/delete могут менять чужой макет при знании id.

Как исправить:

- Добавить `@CurrentUser()`.
- Все методы сервиса принимать `companyId`.
- `ensure(id, companyId)` искать `{ id, companyId }`.
- Проверять, что `orderId` принадлежит той же компании.

### P1-4. Branch management authenticated, но не authorized и cross-tenant

Статус: подтверждено  
Серьезность: High  
Приоритет: P1  
Модуль: филиалы

Доказательства:

- `printpro-api/src/branches/branches.module.ts:31`
- `printpro-api/src/branches/branches.module.ts:40`
- `printpro-api/src/branches/branches.module.ts:50`
- `printpro-api/src/branches/branches.module.ts:55`
- `printpro-api/src/branches/branches.module.ts:61`

Проблема:

Branch controller находится внутри module-файла, использует только `JwtAuthGuard`, берет `companyId` из query/body и обновляет по id.

Как исправить:

- Вынести в нормальный controller или закрыть текущий.
- Добавить `PermissionsGuard`.
- Требовать `settings.manage`.
- Всегда брать company из JWT.

### P1-5. `search` читает `companyId` из query и без permission guard

Статус: подтверждено  
Серьезность: High  
Приоритет: P1  
Модуль: глобальный поиск

Доказательства:

- `printpro-api/src/search/search.controller.ts:6`
- `printpro-api/src/search/search.controller.ts:11`

Проблема:

`SearchController` использует `JwtAuthGuard`, но не `PermissionsGuard`, и принимает `companyId` из query.

Как исправить:

- Брать `user.companyId`.
- Либо требовать отдельное право `search.view`, либо проверять права по сущностям, которые возвращаются.

### P1-6. Cashflow задваивает оплату долгов поставщикам

Статус: подтверждено  
Серьезность: High  
Приоритет: P1  
Модуль: отчеты, закупки, касса

Доказательства:

- `printpro-api/src/purchasing/purchasing.service.ts:61`
- `printpro-api/src/purchasing/purchasing.service.ts:110`
- `printpro-api/src/reports/reports.service.ts:910`
- `printpro-api/src/reports/reports.service.ts:921`
- `printpro-api/src/reports/reports.service.ts:962`

Проблема:

`paySupplierDebt()` создает и `SupplierPayment`, и `CashMovement OUT`. `cashflow()` суммирует оба источника.

Влияние:

Расходы/денежный поток могут быть завышены.

Как исправить:

- Выбрать один источник денег для cashflow, лучше `CashMovement`.
- `SupplierPayment` использовать как аналитическую расшифровку погашения долга, не как отдельный outflow.

### P1-7. Денежные операции могут выпадать из Z-отчета

Статус: подтверждено  
Серьезность: High  
Приоритет: P1  
Модуль: закупки, зарплата, касса

Доказательства:

- `printpro-api/src/purchasing/purchasing.service.ts:109`
- `printpro-api/src/purchasing/purchasing.service.ts:260`
- `printpro-api/src/payroll/payroll.service.ts:252`

Проблема:

Если у пользователя нет открытой смены, создается `CashMovement` без `shiftId`. Общие отчеты его увидят, но отчет конкретной смены не увидит.

Как исправить:

- Для наличных выплат и расходов требовать открытую смену.
- Или ввести отдельный реестр "операции вне смены" и показывать его при сверке.

### P1-8. JWT доверяет payload до истечения токена

Статус: подтверждено  
Серьезность: High  
Приоритет: P1  
Модуль: auth

Доказательства:

- `printpro-api/src/auth/jwt-auth.guard.ts:23`
- `printpro-api/src/auth/auth.service.ts:95`

Проблема:

Guard проверяет подпись JWT и кладет payload в request. Он не проверяет, активен ли пользователь сейчас, не изменилась ли роль, не отозван ли токен. `me()` тоже не проверяет `isActive`.

Как исправить:

- Проверять `User.isActive` в guard или отдельном user-status guard.
- Добавить `tokenVersion` или session id.
- При смене роли/увольнении инвалидировать старые токены.
- Сократить TTL для privileged sessions.

### P1-9. Audit trail недостаточен для расследования денег и склада

Статус: подтверждено  
Серьезность: Medium/High  
Приоритет: P1  
Модуль: аудит

Доказательства:

- `printpro-api/prisma/schema.prisma:1213`
- `printpro-api/src/audit/audit.interceptor.ts:38`
- `printpro-api/src/audit/audit.interceptor.ts:46`

Проблема:

Audit пишется fire-and-forget после ответа и содержит в основном method/path. Нет before/after, IP, user-agent, requestId, статуса, business deltas. Public и sync события почти не покрыты.

Как исправить:

- Для money/stock/RBAC писать audit внутри той же транзакции.
- Фиксировать before/after критичных полей.
- Добавить requestId, ip, userAgent, status, sync peer.
- Логировать failed auth/security события.

### P1-10. История статусов заказов неполная

Статус: подтверждено  
Серьезность: Medium  
Приоритет: P1/P2  
Модуль: заказы

Доказательства:

- `printpro-api/prisma/schema.prisma:829`
- `printpro-api/src/orders/orders.service.ts:579`
- `printpro-api/src/orders/orders.service.ts:786`

Проблема:

`OrderStatusHistory` есть, но quick-sale переводит заказ в `DELIVERED` без записи истории, refund переводит в `CANCELLED` без истории.

Как исправить:

- Централизовать helper `transitionOrderStatus()`.
- Любая смена `Order.status` должна писать `OrderStatusHistory`.

## 6. P2: средний риск и качество

### P2-1. `ClientDebt` есть в схеме, но фактически не ведется

Доказательства:

- `printpro-api/prisma/schema.prisma:966`
- `printpro-api/prisma/schema.prisma:817`
- `printpro-api/src/orders/orders.service.ts:1203`

Проблема:

Долги считаются по `Order.balanceDue`, а `ClientDebt` как ledger не ведется.

Решение:

- Либо удалить/не использовать `ClientDebt`.
- Либо сделать полноценный debt ledger: начисление, погашение, сторно, связь с payment/return.

### P2-2. Полный refund не создает первичный документ Return

Доказательства:

- `printpro-api/src/orders/orders.service.ts:665`
- `printpro-api/src/orders/orders.service.ts:786`
- `printpro-api/src/orders/orders.controller.ts:91`

Проблема:

Полная отмена возвращает деньги/товар и ставит `CANCELLED`, но не создает `Return` с номером `VOZ`.

Решение:

- Создавать Return-документ и для полного refund.
- Или запретить отдельный full refund и прогонять все через `createReturn()`.

### P2-3. После возврата `paymentStatus` может остаться устаревшим

Доказательства:

- `printpro-api/src/orders/orders.service.ts:948`
- `printpro-api/src/orders/orders.service.ts:952`

Проблема:

`createReturn()` обновляет `paid` и `balanceDue`, но не пересчитывает `paymentStatus`.

Решение:

- После возврата пересчитывать `paymentStatus` из `paid`, `balanceDue`, `returnedTotal`, статуса заказа.

### P2-4. Production photo upload без file type filter

Доказательства:

- `printpro-api/src/production/production.controller.ts:83`
- `printpro-api/src/production/production.controller.ts:86`
- `printpro-api/src/production/production.controller.ts:92`
- `printpro-api/src/uploads/image-upload.options.ts:28`

Проблема:

Производственная загрузка фото использует inline `FileInterceptor` с лимитом 50 MB, но без MIME/extension filter.

Решение:

- Переиспользовать `IMAGE_UPLOAD_OPTIONS`.
- Добавить magic-byte validation.
- Отдавать upload с `X-Content-Type-Options: nosniff`.

### P2-5. Public endpoints слабо защищены от enumeration/spam

Доказательства:

- `printpro-api/src/public/public.controller.ts:45`
- `printpro-api/src/public/public.controller.ts:136`
- `printpro-api/src/public/public.controller.ts:193`
- `printpro-api/src/public/public.controller.ts:224`

Проблема:

Password reset request, public order, my-orders by phone, reorder по phone/orderId не имеют полноценного rate limit/OTP.

Решение:

- Rate limit для public endpoints.
- OTP для кабинета клиента и reorder.
- CAPTCHA/proof-of-work для публичного заказа.
- Нормализация телефонов.

### P2-6. Frontend route guard местами не совпадает с backend правами

Доказательства:

- `printpro-web/src/app/(panel)/layout.tsx:102`
- `printpro-api/src/orders/orders.controller.ts:40`
- `printpro-web/src/app/(panel)/orders/new/page.tsx:145`

Проблема:

`/orders/new` требует `orders.view`, но backend `POST /orders` требует `orders.manage`.

Решение:

- Для `/orders/new` поставить `orders.manage`.
- Добавить forbidden state до заполнения формы.

### P2-7. Feature flags скрывают меню, но не защищают прямой URL

Доказательства:

- `printpro-web/src/lib/feature-flags.ts:50`
- `printpro-web/src/app/(panel)/layout.tsx:109`

Проблема:

Flags применяются к nav items, но direct route guard проверяет только permissions.

Решение:

- В route guard учитывать `NAV_FLAG_BY_HREF`.
- На выключенный модуль делать redirect/404.

### P2-8. Отчеты во frontend глотают ошибки

Доказательства:

- `printpro-web/src/app/(panel)/reports/sections.tsx:5`
- `printpro-web/src/app/(panel)/reports/sections.tsx:217`
- `printpro-web/src/app/(panel)/reports/sections.tsx:1087`

Проблема:

Ошибки API гасятся через `.catch(() => {})`, поэтому 403/500/сеть превращаются в пустые данные.

Решение:

- Для каждого report section вести `loading/error/success`.
- Не показывать empty state до успешного ответа.
- Добавить retry.

### P2-9. POS UI не дает выбрать CARD/QR, хотя backend поддерживает

Доказательства:

- `printpro-api/prisma/schema.prisma:51`
- `printpro-web/src/app/(panel)/pos/page.tsx:28`
- `printpro-web/src/app/(panel)/cash/page.tsx:22`

Проблема:

Backend enum содержит `CARD` и `QR`, cash page умеет их показывать, но POS methods ограничены cash/transfer/mixed/debt.

Решение:

- Добавить `CARD` и `QR` в POS payment methods и split payments.
- Либо убрать из продукта и схемы, если они не нужны.

### P2-10. Централизованная обработка 401/403 во frontend отсутствует

Доказательства:

- `printpro-web/src/lib/api.ts:20`
- `printpro-web/src/lib/auth.tsx:45`
- `printpro-web/src/lib/auth.tsx:53`

Проблема:

`apiFetch` просто бросает `Error`. Если сессия умерла во время работы, страницы могут тихо ловить ошибку или показывать stale UI.

Решение:

- На 401 делать logout + redirect.
- На 403 показывать нормальный forbidden state.
- Добавить единый error boundary/notification.

## 7. Кодировка и локализация

Статус: подтверждено  
Серьезность: Medium  
Приоритет: P2

Проблема:

Исходный `docs/deep-research-report.md` был сохранен в mojibake-виде. Такие же mojibake-комментарии и строки видны во многих backend/frontend файлах. Это не только косметика: сообщения об ошибках, Telegram-тексты, labels, документация и поддержка станут трудными для пользователей и разработчиков.

Что исправить:

- Пройтись по проекту и восстановить UTF-8 русский текст.
- Настроить `.editorconfig` с `charset = utf-8`.
- Добавить проверку encoding в CI.
- Избегать копирования mojibake в seed/Telegram/error messages.

## 8. Тесты и качество

### Что проверено агентами

- `printpro-api`: `npm test -- --runInBand` проходит, 1 тест.
- `printpro-api`: `npm run test:e2e -- --runInBand` проходит, 1 e2e тест.
- `printpro-api`: `npx prisma validate` проходит.
- `printpro-web`: `npm run build` проходит.
- `printpro-web`: `npm run lint` падает: 403 проблемы, 382 errors, 21 warnings.
- `printpro-api`: `npm run lint` не запускался агентом, потому что script содержит `--fix` и может менять файлы.

### Главный вывод по QA

Тесты сейчас проверяют scaffold, а не бизнес. Для системы с деньгами, складом и POS это недостаточно.

Обязательные P0 тесты:

| Приоритет | Сценарий | Тип |
|---|---|---|
| P0 | Login/password, inactive user, wrong password, PIN login | API e2e + unit |
| P0 | RBAC: кассир не видит настройки/зарплату, склад не проводит оплату | API e2e |
| P0 | Cross-tenant: отчеты/роли/дизайн/поиск не принимают чужой `companyId` | API e2e |
| P0 | Services API закрыт от anonymous и unauthorized roles | API e2e |
| P0 | Создание заказа: клиент, номер, строки, total/cost, deadline, history | Integration |
| P0 | POS quick-sale: товар + услуга + скидка + промокод + бонусы | Integration + Playwright |
| P0 | Idempotency POS: double click не создает дубль и не списывает склад дважды | Concurrency |
| P0 | Оплата заказа: partial/paid, запрет переплаты, запрет `DEBT` в `addPayment` | Integration |
| P0 | Возврат: частичный, повторный, полный, параллельный | Concurrency |
| P0 | Склад: приход, продажа, списание, перемещение, пересчет, запрет минуса | Integration |

P1 тесты:

| Приоритет | Сценарий | Тип |
|---|---|---|
| P1 | Кассовая смена: открыть одну, привязать платежи, IN/OUT, закрыть, expected cash | Integration |
| P1 | Публичный онлайн-заказ: upload, заказ, QR receipt, кабинет, reorder | API e2e |
| P1 | Производство: job lifecycle, rework/photo, завершение, списание материалов | Integration |
| P1 | Дизайн: proof lifecycle, revision, approval, file upload | API + UI |
| P1 | Отчеты: revenue, cashflow, receivables/payables, inventory, production | Contract |
| P1 | Sync: secret, pull since, push conflict, cursor update, no echo loop | Integration |
| P1 | Frontend smoke: login -> dashboard -> POS -> sale -> receipt -> cash report | Playwright |

## 9. Приоритетный план исправлений

### Этап 1. Закрыть дыры доступа

1. Закрыть `services` и `service-categories` guards/permissions.
2. Убрать query/body `companyId` из reports, roles, design, branches, search.
3. Добавить `@RequirePermissions` в stock/products controllers.
4. Проверить ownership для всех `id` в update/delete/status routes.
5. Ограничить CORS и закрыть/protect Swagger в production.

### Этап 2. Деньги, касса, возвраты

1. Проверять `shiftId` по `companyId`, `closedAt`, user/branch policy.
2. Исправить `cashflow`, чтобы не задваивал supplier payments.
3. Сделать возвраты идемпотентными.
4. Создавать Return-документ и для full refund.
5. Пересчитывать `paymentStatus` после возвратов.
6. Не позволять cash movements выпадать из смены без явного режима.

### Этап 3. POS и склад как строгий ledger

1. Переписать quick-sale в одну транзакцию или state machine.
2. Ввести production material issue/reservation.
3. Добавить before/after/cost/user/jobId в stock movements.
4. Ввести полноценный debt ledger или удалить `ClientDebt`.
5. Централизовать status transitions.

### Этап 4. Тестовая база

1. Поднять отдельную test DB и seed fixtures.
2. Написать API integration tests для P0 money/stock/order/RBAC.
3. Добавить Playwright smoke для POS и отчетов.
4. Сделать `npm run lint` зеленым в web.
5. Разделить API lint на check и fix, чтобы CI не менял файлы.

### Этап 5. UX и операционная зрелость

1. Добавить нормальные error states в reports.
2. Централизовать 401/403 обработку.
3. Добавить CARD/QR в POS или убрать из модели.
4. Учитывать feature flags при прямом URL.
5. Восстановить UTF-8 тексты.

## 10. Карта модулей и статус

| Модуль | Состояние | Главный риск |
|---|---|---|
| Auth | Работает, есть login/PIN/JWT | Старые токены не проверяют `isActive` |
| Roles | Есть RBAC модель | Cross-tenant через query/body/id |
| Services | Богатая модель цен/BOM | Нет auth/RBAC |
| Products/Warehouse | Есть stock ledger | Нет method permissions, ownership gaps |
| Orders | Сильная бизнес-логика | quick-sale не атомарен end-to-end |
| Cash | Есть смены и X/Z отчет | `shiftId` IDOR, операции без смены |
| Reports | Большой набор отчетов | query `companyId`, cashflow double count |
| Production | Есть lifecycle и write-off | списание в минус, нет cost snapshot |
| Design | Есть proof lifecycle | tenant isolation сломан |
| Sync | Есть offline-first механизм | слишком широкий shared secret |
| Public | Есть онлайн-заказ/кабинет | rate limit/OTP/privacy gaps |
| Audit | Есть interceptor | нет before/after и транзакционной гарантии |
| Frontend | Build проходит, богатый UI | lint красный, ошибки часто гасятся |

## 11. Итоговый вердикт

PrintPro уже имеет правильный масштаб для платформы типографии: это не набор страниц, а реальная операционная система. Но перед тем как считать ее надежной, нужно перестать доверять клиенту и сделать сервер источником всех прав, компаний, смен, денег и складских инвариантов.

Если чинить по приоритету, первое, что даст максимальный эффект:

1. Закрыть `services`, reports, roles, design, branches, search, stock/products permissions.
2. Убрать все `companyId` из client-controlled query/body там, где route авторизован.
3. Исправить `shiftId`, возвраты и cashflow.
4. Покрыть P0 flows тестами.
5. Сделать POS и склад ledger-подобными, чтобы каждую денежную и складскую операцию можно было доказать.

После этих шагов проект станет на порядок ближе к платформе, которую можно спокойно развивать как серьезную MIS/ERP для типографии.
