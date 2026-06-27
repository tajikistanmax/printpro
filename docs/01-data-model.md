# Модель базы данных — Платформа для типографии (SaaS)

> Бисмиллахир Рахмони Рахим. Старт: 27.06.2026.
> Стек: TypeScript + NestJS + PostgreSQL + Prisma. Мультитенантный, offline-first.

---

## Группа 1. Тенант и пользователи (мультитенантность)

- **companies** (тенанты) — каждая типография = отдельная компания.
  поля: id, name, currency, language, created_at
- **branches** (филиалы/точки) — у компании может быть несколько точек.
- **users** (сотрудники) — login, password_hash, full_name, phone, role_id, branch_id, is_active
- **roles** (роли) — name, is_system (Администратор, Директор, Бухгалтер, Складчик, Сотрудник)
- **permissions** (права) — справочник возможностей: orders.view, cash.sell, warehouse.edit, settings.manage и т.д.
- **role_permissions** — связь роль↔право (админ включает/выключает галочками)

## Группа 2. Клиенты

- **clients** — full_name, phone, note. (телефон — главный идентификатор)

## Группа 3. Каталог услуг

- **service_categories** — Дизайн, Полиграфия, Сувенирка, Сервисный центр, IT-услуги
- **services** — name, category_id, pricing_type, base_price, design_surcharge, is_active
  - **pricing_type** (тип расчёта цены) — ключевое поле:
    - `FIXED` — фиксированная (ламинирование, брошюровка)
    - `QUANTITY_TIER` — по тиражу (визитки: 100 шт / 500 шт / 1000 шт)
    - `BY_SIZE` — по формату (фото 10×15, A4, A3)
    - `BY_AREA` — по площади м² (баннеры, широкоформат)
    - `MANUAL` — договорная, цена при приёме (реставрация, ремонт, восстановление)
- **service_price_tiers** — для QUANTITY_TIER: service_id, min_qty, max_qty, price
- **service_sizes** — для BY_SIZE: service_id, label (10×15), price
- **service_options** — надбавки/опции: service_id, name (тип бумаги, срочность), price_modifier

## Группа 4. Товары и склад

- **product_categories** — Фоторамки, Бумага, Расходники, Сопутствующие
- **units** — единицы измерения: шт, рулон, м², пачка, лист
- **products** — name, category_id, unit_id, sale_price, min_stock (порог оповещения), barcode
- **stock** — product_id, branch_id, quantity (текущий остаток)
- **stock_movements** — все движения: product_id, type (приход/расход/списание), qty, reason, order_id, user_id, created_at
- **stock_receipts** — приёмка товара (приход): supplier, date, позиции
- **suppliers** — поставщики (опционально)

## Группа 5. Заказы (универсальные: продажа, печать, ремонт, восстановление)

- **orders** — единая сущность для всего, что приносит клиент:
  - order_number, client_id, branch_id, order_type, status, assigned_user_id,
    deadline (срок готовности), total, paid, created_by, created_at
  - **order_type**: `SALE` (продажа товара), `PRINT` (печать/дизайн), `REPAIR` (ремонт), `RECOVERY` (восстановление данных)
  - **status**: Принят → В работе → Готов → Выдан → Отменён (настраиваемые)
- **order_items** — позиции заказа (и услуги, и товары в одном чеке):
  - order_id, item_type (service/product), service_id ИЛИ product_id,
    qty, unit_price, options (выбранные опции/размер/тип бумаги), line_total
- **order_repair_details** — доп. поля для ремонта: device_model, problem, diagnosis
- **order_recovery_details** — доп. поля для восстановления: device_type, media_model, what_to_recover
- **order_files** — загруженные макеты/сканы: order_id, file_url (S3), type

## Группа 6. Касса и деньги

- **cash_shifts** — смены кассы: user_id, opened_at, closed_at, opening_balance
- **payments** — оплаты: order_id, amount, method (нал/карта/в долг), shift_id, user_id, created_at
- **cash_movements** — приход/расход денег из кассы (для бухгалтера)

### Долги и оплата частями
- **orders** дополняется: total, paid, balance_due (долг), payment_status (`PAID` / `PARTIAL` / `DEBT`)
- **payments** уже поддерживает несколько оплат по одному заказу (клиент платит частями)
- **client_debts** — учёт задолженности клиента: client_id, order_id, amount, due_date, is_closed
- **client_balance** (или вычисляемо) — общая сумма долга клиента, чтобы видеть «кто сколько должен»

## Группа 7. Задачи сотрудникам

- **tasks** — title, description, client_phone, order_id, assigned_user_id,
  due_date, status (новая/в работе/выполнена), created_by, priority

## Группа 8. Системное

- **audit_log** — кто что сделал (важно для контроля)
- **settings** — настройки компании
- **sync_log** — служебное для синхронизации offline/online

---

## Как покрываются твои примеры

| Твой случай | Как ложится в модель |
|---|---|
| Визитки (цена от тиража + тип бумаги + доплата за дизайн) | service `pricing_type=QUANTITY_TIER` + price_tiers + service_options (бумага) + design_surcharge |
| Печать фото (цена от размера/формата) | service `pricing_type=BY_SIZE` + service_sizes |
| Баннеры (по м²) | service `pricing_type=BY_AREA` |
| Реставрация фото (приём, скан, срок, цена вручную) | order `type=PRINT`/MANUAL + order_files (скан) + deadline + ручная цена |
| Ремонт принтера (модель, причина, цена после осмотра) | order `type=REPAIR` + order_repair_details |
| Восстановление данных (ФИО, тел, носитель, что вернуть) | order `type=RECOVERY` + order_recovery_details |
| В кассе и товар, и услуга в одном чеке | один order с order_items разных типов + payment |
| Склад по штучно и по рулонам | products.unit_id (шт/рулон) + min_stock для оповещений |
| Роли с настройкой прав | roles + permissions + role_permissions (админ включает галочки) |
