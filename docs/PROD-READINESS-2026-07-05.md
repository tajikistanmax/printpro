# PrintPro — Аудит готовности к продакшену (2026-07-05)

Консолидированный отчёт Staff Engineer по итогам аудита. Всего разобрано **136 находок** по бэкенду (`printpro-api`) и вебу (`printpro-web`). Ниже — приоритизация: что чинить первым (P0, подтверждено кодом), что дальше (P1), что косметика (P2), и что снято.

---

## 1. Итоговая сводка

### По severity
| Severity | Кол-во |
|---|---|
| Critical | 1 |
| High | 25 |
| Medium | 54 |
| Low | 56 |
| **Итого** | **136** |

### По вердикту (для critical/high проверялось кодом)
| Вердикт | Кол-во |
|---|---|
| confirmed (подтверждено) | 25 |
| uncertain (спорно) | 1 |
| false-positive (ложное) | 0 |
| unverified (не верифицировалось — все medium/low) | 110 |

**Подтверждённых critical/high: 25** (1 critical + 24 high). Ложных срабатываний не выявлено — снимать нечего, вся масса находок реальна, вопрос лишь в приоритете. Единственная спорная high — прораторование месячной зарплаты (`payroll`, вердикт uncertain).

> Важно: 110 находок medium/low помечены `unverified` — они не подтверждались чтением кода поштучно, а взяты «как есть» из аудита. Перед исправлением каждую нужно быстро перепроверить, но большинство описаны конкретно (file:line) и выглядят достоверно.

---

## 2. P0 — критично (подтверждено кодом)

Всё, что ниже, проверено по исходникам и ведёт к денежным потерям, порче данных, утечке между тенантами или тихой потере записей. Чинить в первую очередь.

### Деньги / касса / возвраты

**P0-1. Скидка quick-sale уменьшает `order.total`, но цены строк остаются валовыми → возвраты переплачивают наличными** *(critical, confirmed)*
`orders/orders.service.ts:605`
- Проблема: в `quickSale` ручная скидка + промокод + бонусы вычитаются только из `order.total`/`balanceDue`. `unitPrice`/`lineTotal` строк остаются валовыми, per-line скидка не сохраняется. Оба пути возврата считают деньги от валовых цен: полный возврат `fullReturnAmount = qty*unitPrice` (L881), частичный `createReturn` `lineAmount = qty*unitPrice` (L1060).
- Влияние: возврат части товара со скидочной продажи возвращает больше, чем клиент заплатил (напр. товар 100 → продан за 70; возврат половины вернёт валовые 50 при фактически уплаченных ~35). `returnedTotal` превышает скидочный `total`, ломая отчёты о выручке/контр-выручке.
- Фикс: применять скидку пропорционально к `unitPrice`/`lineTotal` каждой строки (или хранить долю/сумму скидки на заказе) и считать все возвраты от нетто-цен.

**P0-2. Возврат наличными дважды учитывает уже возвращённые наличные → недостача в кассе** *(high, confirmed)*
`orders/orders.service.ts:1131`
- Проблема: `order.payments` при возвратах не меняются, декрементится только скаляр `order.paid`. И `createReturn` (L1131-1134), и `refund` (L770-773) заново берут `cashPaid` из полного набора CASH-платежей и делают `cashBack = min(moneyBack, cashPaid)`, не вычитая наличные, уже выданные предыдущими возвратами.
- Влияние: заказ 60 CASH + 40 CARD; частичный возврат 40 → 40 наличных наружу; второй возврат 40 → снова 40 наличных. Итого 80 наличными при полученных 60 — карточная часть возвращается наличными. Z-отчёт показывает реальную недостачу.
- Фикс: считать уже выданные наличные возвраты по заказу и капить `cashBack = min(moneyBack, cashPaid − alreadyCashRefunded)`; трекать возвращённые cash/non-cash отдельно, как `returnedTotal`.

**P0-3. `addPayment` игнорирует `returnedTotal` → переплата разрешена и неверный долг после частичного возврата** *(high, confirmed)*
`orders/orders.service.ts:335`
- Проблема: `addPaymentTx` считает `balanceBefore = total − paid` (L335) и `balanceDue = total − newPaid` (L378), не учитывая `order.returnedTotal`, хотя `createReturn` считает эффективный долг как `total − returnedTotal − paid` (L1183).
- Влияние: заказ 100, частичный возврат на 30 (returnedTotal=30), paid=0 → реальный долг 70, но гвард пропускает оплату до 100; корректная оплата 60 даёт `balanceDue=40` и статус PARTIAL — заказ никогда не станет PAID. Портит `debts()` и агрегаты кредит-лимита.
- Фикс: использовать эффективный `total = order.total − order.returnedTotal` и в гварде, и в пересчёте `balanceDue`.

**P0-4. Наличная выручка в `net` cashflow не вычитает наличные возвраты → завышенный чистый поток** *(high, confirmed)*
`reports/reports.service.ts:1067`
- Проблема: наличные возвраты (`cashMovement` OUT категории «Возвраты») попадают в `refundsCash` и пропускаются через `continue` (L972-975), исключаясь из `outflow`. `net = inflow − outflow` (L1067) их не вычитает, но `expectedClosing` (L1021) — вычитает. Две цифры в одном ответе противоречат друг другу.
- Влияние: в периоде с наличными возвратами `net` завышен на сумму возвратов и не сходится с реконсиляцией кассы в том же payload.
- Фикс: `net = inflow − outflow − refundsCash` (или сложить возвраты в outflow); то же для per-bucket net.

### Каталог / склад / закупки

**P0-5. `importProducts` обнуляет salePrice/purchasePrice/minStock при обновлении, если колонок нет в файле** *(high, confirmed)*
`warehouse/products.service.ts:276`
- Проблема: `num()` возвращает 0 для пустой/отсутствующей ячейки (`Number('')=0`). В ветке update `data` всегда содержит числовые поля через `num()`, в отличие от sku/barcode через `str()` (undefined → Prisma пропускает). Повторный импорт файла без ценовых колонок обнуляет цены и minStock у всех совпавших товаров.
- Влияние: тихая массовая потеря данных — цены продажи/закупки и пороги пополнения обнуляются, ломая POS-цены, маржу и алерты низкого остатка.
- Фикс: писать числовые поля только когда ячейка реально присутствует (helper возвращает `undefined` для пустых, как `str()`).

**P0-6. Штрихкод хранится без trim, а все проверки уникальности тримят → дубликаты и несканируемые коды** *(high, confirmed)*
`warehouse/products.service.ts:94`
- Проблема: `assertBarcodeFree` тримит перед проверкой, `createProduct`/`updateProduct` хранят сырой `dto.barcode`. `' 460123 '` проверяется как `'460123'` (свободен), но сохраняется с пробелами. Partial-unique индекс на литерал → можно создать второй товар с `'460123'`. Скан `'460123'` не находит запись с пробелами.
- Влияние: два товара с одним фактическим штрихкодом (обход уникальности) + легитимные коды не сканируются на POS.
- Фикс: нормализовать (trim) штрихкод один раз и хранить триммнутое значение в create/update/import.

**P0-7. `createReceipt` не проверяет принадлежность supplierId/branchId компании → межтенантная порча долга/склада** *(high, confirmed)*
`purchasing/purchasing.service.ts:269`
- Проблема: в отличие от `paySupplierDebt`/`updateSupplier`, `createReceipt` не вызывает `ensureSupplier` и не проверяет branch. `companyId` берётся из токена, но `supplierId`/`branchId` — из тела запроса. `supplier.update({where:{id: dto.supplierId}, data:{debt:{increment}}})` — по «голому» id без tenant-scope.
- Влияние: приёмка от компании A с supplierId компании B инкрементит долг чужого поставщика и пишет в чужой склад; при битом id — непрозрачный 500 вместо 400. Требует знания CUID → это дыра tenant-isolation / defense-in-depth.
- Фикс: до транзакции резолвить и проверять `supplier.companyId === dto.companyId` (reuse `ensureSupplier`) и что `branchId` принадлежит компании.

### Производство

**P0-8. Job помечается COMPLETED до списания материалов; сбой списания оставляет несогласованное состояние** *(high, confirmed)*
`production/production.service.ts:91`
- Проблема: L91 коммитит апдейт job (status=COMPLETED, completedAt) отдельной записью, затем `writeOffMaterials` (L98) в своей транзакции бросает `BadRequestException` при нехватке остатка (L167). Job уже сохранён как COMPLETED, `materialsWrittenOff` откатывается в false, клиент получает 400, `syncOrderStatus` (L101) не выполняется.
- Влияние: завершение «наполовину»: job COMPLETED без списания материалов и без снимка себестоимости, статус заказа не пересчитан — тихая дыра в учёте склада/себестоимости.
- Фикс: делать апдейт статуса и списание в одной `$transaction` (сначала списать, потом COMPLETED), чтобы нехватка остатка откатывала завершение.

**P0-9. `syncOrderStatus` откатывает завершённые/терминальные статусы заказа обратно в READY/IN_PROGRESS** *(high, confirmed)*
`production/production.service.ts:302`
- Проблема: L302 гвардит только `order.status !== next`, без проверки стадии заказа. Поздний REWORK (→ IN_PROGRESS) или пере-завершение (→ READY) job'а форсирует DELIVERED/CANCELLED заказ обратно в производственный статус. Endpoint требует лишь `production.view` и стадию заказа не проверяет.
- Влияние: выданный/отменённый заказ тихо возвращается в производство, ломая жизненный цикл и последующую отчётность/кассовую логику.
- Фикс: разрешать `syncOrderStatus` двигать только среди производственных статусов (NEW/IN_PROGRESS/READY); пропускать терминальные/пост-продакшн стадии.

### Зарплата

**P0-10. Двойная выплата зарплаты при конкурентных/повторных запросах (TOCTOU на isPaid)** *(high, confirmed)*
`payroll/payroll.service.ts:245`
- Проблема: `pay()` читает запись и проверяет `rec.isPaid` вне транзакции (L237-245), внутри — безусловный `update({where:{id}, data:{isPaid:true}})` без `where:{isPaid:false}`/updateMany-count-гварда и без SELECT…FOR UPDATE, затем всегда создаёт cash OUT. Два параллельных запроса проходят устаревшую проверку и оба пишут движение.
- Влияние: зарплата выдаётся дважды за одну запись — двойное списание из кассы, порча Z-отчёта.
- Фикс: атомарный флип: `updateMany({where:{id, companyId, isPaid:false}, data:{isPaid:true}})`; если `count !== 1` → бросать «Уже выплачено», и только потом создавать cashMovement.

### Клиенты / промо

**P0-11. Статистика карточки клиента (долг, траты, доступный кредит) считается по последним 50 заказам** *(high, confirmed)*
`clients/clients.service.ts:172`
- Проблема: `findOne` грузит заказы с `take:50`, и все финпоказатели (`totalSpent`, `totalDebt`, `ordersCount`, `avgCheck`, `creditAvailable`) считаются по обрезанному массиву. У клиента с >50 заказов все цифры неверны.
- Влияние: `totalDebt` занижен, `creditAvailable` завышен именно у самых активных клиентов — персонал может выдать кредит сверх реального лимита.
- Фикс: считать `totalSpent`/`totalDebt`/`ordersCount` через `aggregate`/`groupBy` по всему набору (clientId+companyId), `take:50` оставить только для отображаемого списка; исключить отменённые заказы из долга.

### Публичный API / multi-tenant

**P0-12. `GET /public/services` без companyId отдаёт услуги всех тенантов** *(high, confirmed)*
`public/public.controller.ts:79`
- Проблема: сырой `@Query('companyId')` идёт в `where:{companyId, isActive:true}` без гварда. При отсутствии параметра `companyId` = undefined, Prisma выкидывает ключ → возвращаются активные услуги всех компаний (name, pricingType, basePrice). В соседнем `my-orders` (L215) гвард есть.
- Влияние: межтенантная утечка каталога услуг и цен любому анонимному вызывающему.
- Фикс: ранний `if (!companyId) return [];` (как в my-orders); лучше — требовать companyId через DTO/pipe.

### Синхронизация (offline-first)

**P0-13. Курсор sync продвигается даже когда строки не применились → постоянная тихая потеря данных** *(high, confirmed)*
`sync/sync.service.ts:273`
- Проблема: `push()` ловит любую per-row ошибку, инкрементит `failed` и возвращается без throw. `runNow()` безусловно `setCursor('cloudPull', fromCloud.until)` (L273), то же для localPull (L285). `pull()` использует `updatedAt: { gt: from }` без верхней границы, следующий курсор = `until` → упавшая строка (FK-каскад, дедлок, таймаут, конфликт unique-barcode) исключается `gt: until` и больше не подтягивается. Ни retry, ни dead-letter — только `logger.warn`.
- Влияние: транзиентные ошибки БД навсегда роняют записи (orders/payments/stock) на одном узле offline-first ERP без автовосстановления.
- Фикс: не двигать курсор до `until` при `failed>0`; двигать до max `updatedAt` успешно применённых строк (low-water mark) или вести очередь повторов.

**P0-14. Курсор по timestamp пропускает строки длинных/конкурентных транзакций** *(high, confirmed)*
`sync/sync.service.ts:88`
- Проблема: `pull()` берёт `until = new Date()` до SELECT'ов и возвращает как следующий курсор. Prisma `@updatedAt` ставится в момент statement'а, до COMMIT. При READ COMMITTED pull, чей `until` пришёлся между присвоением updatedAt и поздним коммитом, пропускает строку, а следующий pull (`gt: until`) исключает её навсегда. Недавняя 2-мин транзакция инвентаризации (коммит 152f3e3) расширяет окно.
- Влияние: записи, созданные во время конкурентных длинных транзакций, никогда не синхронизируются — классическое окно потери данных.
- Фикс: двигать курсор до max реально возвращённого `updatedAt`, а не wall-clock `until`; или overlap-окно с safety-margin; или монотонный commit-sequence вместо updatedAt.

### Квоты (КП)

**P0-15. Конвертация КП→заказ не взаимоисключающая: конкурентные/повторные вызовы создают два заказа из одного КП** *(high, confirmed)*
`quotes/quotes.service.ts:122`
- Проблема: `convert()` «клеймит» КП через `updateMany where status IN [DRAFT,SENT,ACCEPTED]` и ставит `ACCEPTED`, но ACCEPTED внутри своего же IN-множества, `convertedOrderId` остаётся null до L152-155 (после создания заказа). При READ COMMITTED без обёртки в транзакцию второй вызов снова матчит строку и тоже получает `count===1` → два `orders.create`. Комментарий «atomic/idempotent» ложный.
- Влияние: дубли заказов (и номеров/стока/финэффектов) из одного КП при двойном клике/повторе; при сбое L152-155 — КП остаётся неконвертированным и повтор создаёт второй заказ.
- Фикс: клеймить переходом в состояние ВНЕ разрешённого множества (только DRAFT/SENT→ACCEPTED), либо отдельный флаг «converting», и обернуть `orders.create` + запись `convertedOrderId` в одну `$transaction`.

### Схема / производительность

**P0-16. Горячие высоконагруженные таблицы без индексов (StockMovement, Payment, CashMovement, Order.clientId)** *(high, confirmed)*
`prisma/schema.prisma:585`
- Проблема: Postgres не индексирует FK автоматически. `StockMovement` (585-612) — ноль `@@index`; `Payment` (947) только `[companyId, updatedAt]`, но суммируется по orderId/shiftId; `CashMovement` (967) без индексов, хотя Z-отчёт суммирует по shiftId; `Order` без индекса по clientId, хотя `debts()`/история клиента фильтруют по нему.
- Влияние: seq-scan'ы, растущие линейно с объёмом; пересчёт оплат POS, закрытие смены и склад/финотчёты деградируют по мере накопления истории.
- Фикс: миграция с `@@index([productId])`, `@@index([branchId])`, `@@index([orderId])` на StockMovement; `@@index([orderId])`, `@@index([shiftId])` на Payment; `@@index([shiftId])` на CashMovement; `@@index([companyId, clientId])` на Order.

### Веб / POS / фронт

**P0-17. Бонус вычитается из отображаемого total и сдачи без знания реального баланса бонусов клиента** *(high, confirmed)*
`printpro-web/src/app/(panel)/pos/page.tsx:246`
- Проблема: `bonusApplied` гейтится только на непустой `phone`, капится `afterPromo*0.3` и вычитается из `total`, который управляет сдачей (L475-478). Фронт никогда не запрашивает `client.bonusPoints`. Бэкенд применяет бонус только при существующем `clientId` и клампит к реальному балансу.
- Влияние: для нового/несуществующего клиента (баланс 0) или `useBonus` > баланса бэкенд применит меньше → сохранённый `order.total` выше отображаемого, показанная сдача завышена. Прямая денежная потеря.
- Фикс: запрашивать погашаемый баланс бонусов и капить `bonusApplied`; после quick-sale сверять отображаемый total/сдачу с `order.total` до расчёта наличными.

**P0-18. Устаревшая скидка промокода: total и сдача расходятся с бэкендом после изменения корзины** *(high, confirmed)*
`printpro-web/src/app/(panel)/pos/page.tsx:241`
- Проблема: `promoDiscount` — абсолютная величина от `/promocodes/validate`, обновляется только onBlur/кнопкой ✓. `addItem`/`setQty` не ре-валидируют. `promo = min(promoDiscount, afterPromo)` держит устаревшее число, а бэкенд пере-применяет PERCENT-промокод к новому subtotal (10% от 100 = 10 остаётся 10 при subtotal 200, бэкенд считает 20). `resumeHeld` восстанавливает без ре-валидации.
- Влияние: отображаемый total/сдача считаются от устаревшего промо, кассир берёт/возвращает не ту сумму, бэкенд пишет другой total.
- Фикс: ре-запускать `checkPromo` (или сбрасывать) при изменении subtotal/disc и на `resumeHeld`; либо брать промо из авторитетного расчёта бэкенда.

**P0-19. Экспорт заказов в CSV выгружает только текущую страницу, а не отфильтрованный набор** *(high, confirmed)*
`printpro-web/src/app/(panel)/orders/page.tsx:281`
- Проблема: `exportCSV` строит строки из `orders` (только текущая страница, pageSize 20/50/100) с фильтром по выделению. Кнопка «Экспорт» без выделения молча выгружает лишь загруженную страницу.
- Влияние: пользователь фильтрует и жмёт «Экспорт» за «всеми заказами» (бухгалтерия/налоги), получает максимум одну страницу и считает её полной — тихая потеря финданных.
- Фикс: тянуть полный отфильтрованный набор для экспорта (отдельный endpoint или pageSize=total), либо переименовать кнопку в «Экспорт страницы».

**P0-20. Приёмка/оплата долга без in-flight-гварда — двойной клик дважды списывает наличные и дважды увеличивает сток** *(high, confirmed)*
`printpro-web/src/app/(panel)/purchasing/page.tsx:252`
- Проблема: `submitReceipt` (L252) и `submitPay` (L174) не выставляют флаг submitting и не дизейблят кнопку. «Принять на склад» (L1177) и «Оплатить» (L1230) остаются кликабельными во время запроса, модалка закрывается только на успех. Нет debounce/ref-гварда/idempotency-key.
- Влияние: двойной клик постит приёмку дважды — сток IN применяется дважды, касса дебетуется дважды (или долг поставщика удваивается).
- Фикс: busy-состояние до `api.post`, сброс в finally, дизейбл кнопки; то же для createProduct/createJob/createService/addSupplier.

**P0-21. Загрузка фото производства игнорирует HTTP-результат — сбои молча проглатываются** *(high, confirmed)*
`printpro-web/src/app/(panel)/production/page.tsx:117`
- Проблема: `uploadPhoto` (L117-128) использует raw `fetch`, не проверяет `res.ok` и без try/catch. На 401/413/500 `fetch` резолвится → вызывается `load()`, ошибка не показывается. Хелпер `api.upload` (`lib/api.ts:74`) проверку делает, но здесь не используется.
- Влияние: оператор грузит фото результата, оно падает на сервере, UI не даёт фидбэка, фото тихо не появляется — потеря proof-of-work.
- Фикс: проверять `res.ok`, показывать ошибку, обернуть в try/catch (или использовать `api.upload`).

**P0-22. Смена статуса производства без обработки ошибок — отклонённые переходы падают молча** *(high, confirmed)*
`printpro-web/src/app/(panel)/production/page.tsx:102`
- Проблема: `setStatus` (L102), `sendRework` (L107), `remove` (L130) делают `await api.patch/del(...); load();` без try/catch. `apiFetch` бросает на `!res.ok`, обработчики onClick не ловят → unhandled rejection без UI-фидбэка и без `load()`. `createJob` (80-100) — корректный образец с try/catch.
- Влияние: отклонение бизнес-правилом сервера тихо не двигает доску, оператор без сообщения может считать job завершённым.
- Фикс: обернуть каждый в try/catch с показом ошибки.

**P0-23. Сбой выплаты зарплаты молча проглатывается (нет показа ошибки)** *(high, confirmed)*
`printpro-web/src/app/(panel)/payroll/page.tsx:116`
- Проблема: `pay(id)` делает `await api.post(.../pay); loadRecords();` без try/catch и без setMsg. `apiFetch` бросает на 403/409/400/сети → rejection не обработан: ни фидбэка, ни обновления строки. Соседи (`createPeriod`, `calculate`, `addAdvance`) используют try/catch+setMsg. Тот же паттерн в `saveSalary` (L72), `setBonus` (L111), settings `createRole` (`settings/page.tsx:896`).
- Влияние: провалившиеся выплаты/правки ставки выглядят как «ничего не произошло» — риск повторов или веры в успех.
- Фикс: обернуть pay/saveSalary/setBonus/createRole в try/catch с `setMsg('Ошибка: '+err.message)`; рефетч состояния.

**P0-24. Payables: долг без даты оплаты всегда помечается просроченным** *(high, confirmed)*
`reports/reports.service.ts:1242`
- Проблема: в `payables()` и per-supplier флаг (L1222-1225), и aging-цикл (L1242-1243) откатываются на `r.date` (дата создания приёмки, всегда в прошлом) когда `dueDate` null. Любая неоплаченная приёмка без явного срока сравнивается со своей датой создания → всегда «overdue». Противоречит `receivables()` (L1118-1120), где null-срок → «current».
- Влияние: `overdueTotal` систематически завышен, бакет «current» пуст, почти весь долг поставщикам выглядит просроченным — отчёт вводит в заблуждение и расходится с receivables.
- Фикс: `overdue = r.dueDate != null && r.dueDate < now` (как в receivables); сумму без dueDate — в «current».

**P0-25. Маржа в summary делит item-based валовую прибыль на order.total-based net** *(high, confirmed)*
`reports/reports.service.ts:161`
- Проблема: числитель `grossProfit` item-based (Σ lineTotal − returns, Σ lineCost − returnedCost), а `margin` (L161) делит на `net = Σ order.total − returns`. `order.total` расходится с Σ lineTotal (скидки/промо/бонусы правят только total). `profit()` (L829) делит на item-based выручку → две маржи для одних заказов различаются.
- Влияние: заголовочный KPI маржи искажён при любых скидках и не сходится с `/profit`, подрывая ценовые решения; `zeroCostShare`/`cashCollectionRate` делят на тот же смешанный знаменатель.
- Фикс: делить `grossProfit` на ту же базу выручки (Σ lineTotal − returns), что и в числителе; выровнять с `profit()`.

---

## 3. P1 — высокий/средний (перепроверить и чинить)

Значимые находки medium (+ спорная high). Верифицировались не поштучно — перед фиксом быстро подтвердить. Сгруппировано по модулю.

### Заказы / возвраты (orders)
| # | Severity | file:line | Суть |
|---|---|---|---|
| Спорн. | high `uncertain` | payroll.service.ts:139 | MONTHLY-зарплата платит полную ставку без прораторации по длине периода/дате найма → возможна переплата 2×–4× при недельных периодах. Требует решения по бизнес-логике (прораторация или запрет >1 расчёта в месяц). |
| — | medium | orders.service.ts:601 | Промо и бонусы списываются, даже если предыдущая скидка уже обнулила total. |
| — | medium | orders.service.ts:919, 920 | Полный refund после частичного возврата дважды реверсит начисленные бонусы (дубль находок — единый фикс: трекать реверснутые бонусы per-order). |
| — | medium | orders.service.ts:58 | `create()` пишет idempotencyKey, но не дедупит — повтор даёт сырой P2002/500 (в отличие от quickSale). |
| — | medium | cash.service.ts:111 | `closeShift` не идемпотентен — двойное закрытие перезаписывает closingBalance и дублирует Z-отчёт/аудит. |
| — | medium | cash.service.ts:137 | `addMovement` резолвит открытую смену вне транзакции (TOCTOU) — движение может лечь на закрытую смену. |

### Склад / каталог (stock, products)
| # | Severity | file:line | Суть |
|---|---|---|---|
| — | medium | stock.service.ts:78 | `receive()` пишет леджер из незалоченного пред-чтения до атомарного upsert → afterQty расходится с реальным стоком при конкуренции. |
| — | medium | stock.service.ts:65 | Нет идемпотентности на stock-mutation POST (receive/adjust/transfer/writeOff) — двойной сабмит дублирует движения. |
| — | medium | stock.service.ts:340 | `recount()/recountBulk()` — «слепая» абсолютная перезапись из незалоченного чтения → lost update и неверный ADJUST diff. |
| — | medium | stock.service.ts:405 | `recountBulk` роняет всю атомарную партию на первом неизвестном productId, теряя все валидные подсчёты. |
| — | medium | products.service.ts:593 | `removeUnit` хардделит sync/soft-delete сущность и молча обнуляет product.unitId. |
| — | medium | products.service.ts:367 | Unique-индекс barcode-alias глобальный (не по компании) → межтенантные коллизии P2002. |
| — | medium | products.service.ts:540 | Softdelete товара навсегда резервирует его alias-штрихкоды глобально. |
| — | medium | products.service.ts:443 | `updateCategory` блокирует только прямой self-parent — возможны многоуровневые циклы дерева категорий. |

### Отчёты (reports)
| # | Severity | file:line | Суть |
|---|---|---|---|
| — | medium | reports.service.ts:704 | ABC относит доминирующий/топовый товар к B/C вместо A (cumPct считается после добавления). |
| — | medium | reports.service.ts:1077 | cashflow discrepancy мешает opening всех смен с closing только закрытых → фантомная недостача при открытой смене. |
| — | medium | reports.service.ts:170 | summary collected/cashCollectionRate/debtGrowth мешают период-заказа с период-оплаты (rate может >100%). |
| — | medium | reports.service.ts:1218 | Payables aging-бакеты не сходятся с headline total (разные источники). |
| — | medium | reports.service.ts:2006 | Orders registry totals включают CANCELLED-заказы (расходится с прочими отчётами). |
| — | medium | reports.service.ts:1773 | Production onTimeRate: знаменатель включает job'ы без дедлайна → занижение. |

### Производство (production)
| # | Severity | file:line | Суть |
|---|---|---|---|
| — | medium | production.service.ts:97 | Списание материалов не реверсится при отмене/rework уже COMPLETED job → занижение остатков. |
| — | medium | production.service.ts:116 | `writeOffMaterials` молча no-op при отсутствии branchId — производство без списания и себестоимости. |
| — | medium | production.controller.ts:90 | Загрузка фото падает 500 без null-check при отсутствии файла. |

### Закупки / зарплата / клиенты
| # | Severity | file:line | Суть |
|---|---|---|---|
| — | medium | purchasing.service.ts:269 | Долговая приёмка без supplierId создаёт неоплачиваемый, невидимый в балансах долг. |
| — | medium | payroll.service.ts:142 | Агрегаты рабочего времени/авансов в `calculate()` не скоуплены по companyId → возможен захват чужих записей. |
| — | medium | payroll.service.ts:78 | `addAdvance` пишет аванс без cash-движения → касса/Z-отчёт завышены на сумму авансов. |
| — | medium | clients.service.ts:63 | `update()` хранит телефон без нормализации → дубли клиентов при последующем findOrCreate. |
| — | medium | clients.service.ts:34 | `findOrCreate` с пустым телефоном привязывает walk-in к произвольному существующему клиенту. |
| — | medium | clients.service.ts:38 | `findOrCreate` не атомарен — конкурентные заказы с новым телефоном создают дубли клиентов. |
| — | medium | promocodes.service.ts:90 | `consume()` инкрементит все строки с этим кодом; `create()` допускает дубли кодов. |

### Публичный API / sync / прочее (backend)
| # | Severity | file:line | Суть |
|---|---|---|---|
| — | medium | public.controller.ts:107 | Публичное создание заказа даёт неканоничный формат номера (`00042` vs `ORD-C-2026-...`). |
| — | medium | public.controller.ts:41 | `files[]` вложенный DTO не валидируется (нет `@ValidateNested`/`@Type`) → произвольные fileUrl. |
| — | medium | public.controller.ts:63 | `password-reset-request` без login матчит произвольного юзера компании и шлёт уведомление. |
| — | medium | sync.service.ts:147 | Upsert и сброс updatedAt/syncNode не атомарны — окно краха делает синхронизированную строку «локальной». |
| — | medium | sync.controller.ts:176 | `GET /sync/status` без auth — утечка cloud URL и флагов конфигурации. |
| — | medium | quotes.service.ts:81 | Softdeleted КП всё ещё читается, меняет статус и конвертируется в заказ. |
| — | medium | complaints.service.ts:21 | Complaints/tasks создают ссылки на orders/clients/users без проверки принадлежности компании. |
| — | medium | notifications.service.ts:98 | Уведомления считают softdeleted proofs и orders → фантомные алерты. |

### Схема / инфраструктура
| # | Severity | file:line | Суть |
|---|---|---|---|
| — | medium | schema.prisma:363 | Softdelete + не-partial UNIQUE делают удалённые коды/штрихкоды неповторно-используемыми (P2002). |
| — | medium | schema.prisma:983 | Модель `ClientDebt` мёртвая — не пишется/не читается, только тащится в sync/backup. |
| — | medium | main.ts:48 | `/uploads` отдаётся статикой без аутентификации — IDOR-утечка клиентских артворков/документов. |
| — | medium | schema.prisma:976 | `CashMovement.type` — свободный String, не enum; sync/import могут записать невалидное значение (тихо выпадает из Z-отчёта). |

### Веб (фронт)
| # | Severity | file:line | Суть |
|---|---|---|---|
| — | medium | pos/_pos.tsx:644 | Кнопка «Сохранить заказ» обходит гварды DEBT-клиента и наличных → долг без клиента, пропуск flow сдачи. |
| — | medium | pos/page.tsx:239 | Отрицательная скидка на вводе раздувает total выше subtotal (нет `Math.max(0, …)`). |
| — | medium | dashboard/page.tsx:64 | KPI и разбивка статусов дашборда считаются из capped 200-заказов → недоучёт при росте. |
| — | medium | orders/page.tsx:185 | Список заказов проглатывает ошибки загрузки и рендерит пустое состояние вместо ошибки. |
| — | medium | orders/page.tsx:270 | Массовая смена статуса молча проглатывает per-order сбои. |
| — | medium | orders/page.tsx:175 | dateFrom-фильтр использует UTC-полночь, dateTo — локальный конец дня → теряются ранние заказы граничного дня. |
| — | medium | production/page.tsx:306 | «Продолжить» из паузы всегда прыгает на PRINTING, теряя реальную стадию. |
| — | medium | services/page.tsx:233 | `deleteService` проглатывает ошибку и релоадит — провал удаления выглядит как no-op. |
| — | medium | warehouse/page.tsx:295 | Трансфер без клиентской валидации (та же ветка/неположительное кол-во). |
| — | medium | lib/escpos-printer.ts:91 | Драйверы принтера и VFD оба берут `ports[0]` → могут перепутать COM-устройства после релоада. |
| — | medium | payroll/page.tsx:57 | Payroll перезагружает staff+все периоды на каждой смене периода (лишние fetch'и). |
| — | medium | lib/feature-flags.ts:85 | Тоггл фичефлага не обновляет sidebar/route-guard до полного релоада. |

---

## 4. Мелочи / редундантность / UX (P2)

Все `low` — чинить пакетно/по касанию. Сгруппировано.

**Backend — логика/данные**
- orders.service.ts:154 — кредит-лимит проверяется по валовому total, игнорируя скидку quick-sale.
- orders.service.ts:571 — `useBonus` молча игнорируется для анонимной продажи (нет клиента).
- orders.service.ts:1188 — полностью возвращённая долговая продажа перелейблится в PAID, хотя денег не было.
- cash.service.ts:156 — OUT-движение без проверки доступных наличных → expectedCash может уйти в минус.
- cash.service.ts:39 — SMENA-последовательность потребляется вне транзакции → пропуски нумерации при гонке/откате.
- stock.service.ts:404 — `recountBulk` молча дропает невалидные/отрицательные позиции без фидбэка.
- stock.service.ts:49 — `stats.todayReceipts` считает позиции softdeleted приёмок.
- products.service.ts:32/211/551/394 — кросс-табличная уникальность штрихкода только check-then-act; import грузит units без deletedAt; `findUnits` возвращает softdeleted; `removeBarcodeAlias` хардделит без tombstone.
- purchasing.service.ts:217/52/175 — beforeQty вне атомарного инкремента; молчаливое усечение переплаты; paidAmount по умолчанию = full total (тихий полный расход кассы).
- payroll.service.ts:65/90/43/148 — addWorkTime/addAdvance не проверяют userId; createPeriod без валидации start≤end; setSalary отдаёт rate как Decimal; HOURLY base без округления.
- promocodes.service.ts:46, clients.service.ts:81 — отрицательное значение промо не валидируется (повышает цену); поиск по телефону сырым вводом против нормализованных.
- reports.service.ts:727/250/903/1965/1176/1763/1476 — ABC profit на убыточных товарах; per-bucket «debt» может быть отрицательным; expenses без лимита; staff salesSum по валовому total; debts() включает CANCELLED; reworkRate теряет завершённые после rework; negative-stock в двух списках.
- production.service.ts:84/87 — startedAt проставляется при отмене непрошедшего PENDING; нет валидации переходов статусов.
- public.controller.ts:247/266/127 — reorder/receipt не исключают softdeleted; reorder пересчитывает строки, теряя скидки; createOrder не валидирует serviceId.
- sync.service.ts:212/186, sync.controller.ts:160 — расходящийся дефолт NODE_ID (K1 vs C); heartbeat без lastPullAt → возможный 500; legacy push доверяет клиентскому `peer`.
- complaints.service.ts:45, backup.service.ts:56 — мутация softdeleted жалоб без гварда; backup материализует весь датасет в память.
- schema.prisma:564, seed.ts:131, doc-number.ts:5, main.ts:39 — alias.barcode глобально-уникален; seed затирает правки прав SYSTEM-ролей; номера документов не сбрасываются по годам; прод-CORS отвергает все origin при пустом CORS_ORIGINS.

**Backend — редундантность**
- orders.service.ts:856 — `refund` дважды выполняет один и тот же запрос истории возвратов.
- orders.service.ts:416 — мёртвый DEBT-гвард в accrual (DEBT отклонён выше).

**Web — UX/данные**
- pos/page.tsx:480/530 — нет in-flight lock на `pay()`; `_change` считается, но не печатается в чеке.
- orders/page.tsx:229/343 — `openOrder` без обработки ошибок; превью частичного возврата завышает refund на повторных возвратах.
- reports/lib.ts:51 (+orders/page.tsx:104) — CSV-экспорт уязвим к formula injection (лидирующие `= + - @`).
- reports/sections.tsx:508 — реестр заказов (таблица+CSV) жёстко ограничен 500 строками.
- dashboard/page.tsx:10, purchasing/page.tsx:33 — `money()` без округления/null-guard (NaN); то же в purchasing.
- debts/page.tsx:50 — оплата долга поставщику гардится `stock.manage`, а не cash-правом.
- warehouse/page.tsx:312/443 — `openMaterial` проглатывает ошибки; «Заполнено» считает невалидные записи, которые Apply потом дропает.
- payroll/page.tsx:281, layout.tsx:79 — uncontrolled bonus/deduction-инпуты (drift от сервера); railCollapsed читает localStorage в useState → SSR/hydration mismatch.

---

## 5. Отклонено (false-positive)

**Ложных срабатываний не выявлено.** Все проверенные critical/high подтверждены кодом; medium/low не верифицировались поштучно, но не отклонялись. Единственная неоднозначная — прораторование MONTHLY-зарплаты (`payroll.service.ts:139`, вердикт `uncertain`): механика описана верно, но «правильное» поведение зависит от бизнес-решения владельца (прораторация vs запрет >1 расчёта в месяц) — вынести на уточнение, а не чинить вслепую.

---

## 6. Рекомендованный порядок исправлений

Приоритет — деньги/потеря данных/утечка тенантов, затем целостность, затем UX.

1. **Утечка тенантов и авторизация (быстро, высокий риск):** P0-12 `/public/services` гвард; P0-7 `createReceipt` company-scope; medium `/uploads` за auth; `sync/status` за guard.
2. **Прямые денежные потери на кассе/POS:** P0-1 скидка vs возврат; P0-2 двойной наличный возврат; P0-3 addPayment/returnedTotal; P0-17 бонус без баланса; P0-18 устаревшее промо; P0-10 двойная зарплата; P0-23 сбой выплаты без фидбэка.
3. **Потеря данных sync (offline-first, критично для мультимашинности):** P0-13 курсор при failed>0; P0-14 timestamp-курсор → max(updatedAt).
4. **Порча/потеря складских и каталожных данных:** P0-5 обнуление цен при импорте; P0-6 trim штрихкода; P0-8 job COMPLETED до списания; P0-9 откат статуса заказа; P0-20 двойная приёмка на фронте.
5. **Дубли из-за неатомарности:** P0-15 КП→заказ; medium findOrCreate/closeShift/quotes softdelete.
6. **Достоверность отчётов (влияет на решения владельца):** P0-4 cashflow net; P0-24 payables overdue; P0-25 маржа; P0-11 статистика клиента по 50 заказам; P0-19 CSV-экспорт всей выборки.
7. **Производительность на росте:** P0-16 индексы (одна миграция) — сделать до накопления истории.
8. **Фронт-фидбэк об ошибках (безопасные быстрые правки):** P0-21/P0-22 production; серия medium/low «swallow error» — общий паттерн try/catch+setMsg.
9. **Пакет P1 medium** по модулям (см. раздел 3), затем **P2 low** по касанию.

> Сквозные технические долги, которые стоит закрыть системно: (а) единый helper номеров документов; (б) единая утилита `money()` с округлением/null-guard на фронте; (в) обёртка «списание+статус» и «claim+create» в общие транзакции; (г) idempotency-key на mutating POST (orders уже частично есть — распространить на stock/purchasing/payroll); (д) единый паттерн обработки ошибок в веб-обработчиках.
