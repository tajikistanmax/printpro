# Техническое задание (ТЗ)
# Платформа автоматизации торговли «MarketPro»

| Параметр | Значение |
|----------|----------|
| **Наименование системы** | MarketPro — POS-платформа для розничной торговли |
| **Назначение** | Учёт товаров, продажи (касса), склад, финансы, персонал и аналитика магазина |
| **Тип продукта** | Коробочное (offline) + облачное (online) решение с мультимагазинной синхронизацией |
| **Целевой рынок** | Продуктовые и хозяйственные магазины (локализация — Таджикистан, валюта сомони) |
| **Дата документа** | 29.06.2026 |
| **Версия системы** | 1.0.0 |
| **Язык интерфейса** | Русский |

---

## Оглавление

1. [Назначение и цели системы](#1-назначение-и-цели-системы)
2. [Общая архитектура](#2-общая-архитектура)
3. [Технологический стек](#3-технологический-стек)
4. [Роли пользователей и права доступа](#4-роли-пользователей-и-права-доступа)
5. [Функциональные требования (модули)](#5-функциональные-требования-модули)
6. [Backend: API и серверная часть](#6-backend-api-и-серверная-часть)
7. [Модель данных (БД)](#7-модель-данных-бд)
8. [Frontend: веб-приложение](#8-frontend-веб-приложение)
9. [Система лицензирования (Ed25519)](#9-система-лицензирования-ed25519)
10. [Синхронизация и облако (VPS)](#10-синхронизация-и-облако-vps)
11. [Безопасность](#11-безопасность)
12. [Развёртывание и поставка](#12-развёртывание-и-поставка)
13. [Интеграция с оборудованием](#13-интеграция-с-оборудованием)
14. [Нефункциональные требования](#14-нефункциональные-требования)
15. [Тестирование](#15-тестирование)
16. [Глоссарий](#16-глоссарий)

---

## 1. Назначение и цели системы

### 1.1. Назначение
**MarketPro** — комплексная система автоматизации розничного магазина, объединяющая:
- **Кассовый узел (POS)** — продажи, возвраты, печать чеков, приём оплаты;
- **Товароучёт и склад** — каталог товаров, приёмка, инвентаризация, списания, движения;
- **CRM** — клиенты, бонусы, скидки, долги;
- **Финансы** — выручка, расходы, кассовая смена, прибыль;
- **Управление персоналом** — сотрудники, рабочее время, зарплата, комиссии консультантов;
- **Аналитику** — дашборд, отчёты по продажам, товарам, сотрудникам, долгам.

### 1.2. Ключевые цели
1. Работа **офлайн-первой**: магазин полностью функционирует без интернета (локальная БД PostgreSQL).
2. Возможность **облачной синхронизации** нескольких магазинов с центральным VPS-сервером.
3. **Защита от копирования** через лицензирование (Ed25519 + привязка к MAC-адресу ПК).
4. Простая поставка клиенту: **коробочный пакет** (market-local) с автозапуском.
5. Поддержка **мультикассовой** работы в локальной сети (один сервер — много касс).

### 1.3. Сценарии использования
- **Одиночный магазин**: один ПК = сервер + касса + веб-панель.
- **Магазин с несколькими кассами**: главный ПК-сервер с PostgreSQL + кассы (браузер/Electron) в локальной сети.
- **Сеть магазинов**: несколько локальных магазинов (market-local) выгружают данные на центральный VPS для консолидированной аналитики.

---

## 2. Общая архитектура

### 2.1. Компонентная схема

```
┌──────────────────────────────────────────────────────────────────┐
│                      ЦЕНТРАЛЬНЫЙ VPS (опционально)                  │
│         PostgreSQL + Express API + Frontend (Docker/Native)        │
│              приём данных от магазинов: /api/sync/vps               │
└───────────────────────────┬──────────────────────────────────────┘
                            │  HTTPS (online-тариф)
        ┌───────────────────┴────────────────────┐
        │                                         │
┌───────▼──────────────────┐          ┌───────────▼───────────────┐
│   МАГАЗИН 1 (market-local)│          │   МАГАЗИН 2 (market-local) │
│  ┌──────────────────────┐ │          │  PostgreSQL (локально)     │
│  │ Backend (server.cjs) │ │          │  Backend + Frontend        │
│  │ Express :31417/:31777│ │          │                            │
│  │ PostgreSQL (локально)│ │          └────────────────────────────┘
│  └──────────┬───────────┘ │
│             │ HTTP API     │
│  ┌──────────▼───────────┐ │
│  │ Веб-панель (браузер) │ │
│  │ Касса (браузер/      │ │
│  │   Electron) x N      │ │
│  └──────────────────────┘ │
└───────────────────────────┘
```

### 2.2. Три уровня компонентов

| Компонент | Технология | Роль |
|-----------|-----------|------|
| **Backend (API)** | Node.js + Express | REST API, бизнес-логика, доступ к БД, лицензирование, синхронизация |
| **Frontend (SPA)** | React + Vite + TypeScript | Веб-интерфейс кассы и управления, отдаётся с того же порта |
| **База данных** | PostgreSQL 14+ (или embedded-postgres 17.5) | Единый источник данных |

### 2.3. Режимы работы
- **API-only (dev)** — backend на одном порту, Vite-фронтенд отдельно.
- **Bundled (prod / market-local)** — backend отдаёт собранный SPA (`frontend/dist`) с того же порта.
- **Сервер + кассы (локальная сеть)** — один сервер с БД, кассы подключаются по IP через HTTP API.

### 2.4. Авторизация — две модели входа
1. **Веб-панель** (браузер): логин/пароль → JWT (срок 8 часов), таблица `admin_users`.
2. **Касса** (Electron/локальная сеть): PIN кассира → JWT (`src=pos`, срок 12 часов) или заголовок `x-register-pin`, таблица `employees`. PIN-авторизация работает только из локальной сети (192.168.x.x, 10.x.x.x, 172.16–31.x.x, 127.0.0.1).

---

## 3. Технологический стек

### 3.1. Backend
| Категория | Технология / версия |
|-----------|---------------------|
| Платформа | Node.js (target node18) |
| Фреймворк | Express 4.18.2 |
| База данных | PostgreSQL (драйвер `pg` 8.11+) |
| Авторизация | jsonwebtoken 9.0.2, bcryptjs 2.4.3 |
| Валидация | express-validator 7.3.1 |
| Безопасность | helmet 7.2.0, cors 2.8.5 |
| HTTP-клиент | axios 1.15.2 (выгрузка на VPS) |
| Логирование | winston 3.11.0 (ротация 10 МБ × 5 файлов) |
| Утилиты | uuid 11.1.0, dotenv 16.3.1 |
| Лицензирование | Node.js `crypto` (Ed25519) |
| Тесты | fast-check 3.23.2, node test runner |
| Порт по умолчанию | 31417 (настраивается `PORT`) |

### 3.2. Frontend
| Категория | Технология / версия |
|-----------|---------------------|
| Фреймворк | React 18.2 |
| Сборщик | Vite 5.0 |
| Язык | TypeScript 5.3 (strict) |
| Роутинг | react-router-dom 6.30 |
| Состояние | Zustand 4.5 (глобальный store) |
| Стили | Кастомный CSS + utility-классы (без UI-фреймворка) |
| Иконки | LineIcons 5.1, lucide-react |
| Шрифт | Nunito |
| Штрихкоды | jsbarcode 3.12, html5-qrcode 2.3.8, qrcode 1.5.4 |
| Оборудование | escpos 3.0 (термопринтер), serialport 12.0 (весы) |
| Тесты | Jest 29.7, Playwright 1.40, supertest 6.3 |

### 3.3. Поставка
- **embedded-postgres** 17.5 — встроенный PostgreSQL для десктоп-сборки.
- **esbuild** — бандлинг backend в один файл `server.cjs`.
- **Docker** (node:20-alpine) — для VPS-развёртывания.

---

## 4. Роли пользователей и права доступа

### 4.1. Роли веб-панели (`admin_users`)
Допустимые роли (CHECK-ограничение в БД):

| Роль | Описание | Зона доступа |
|------|----------|--------------|
| `owner` | Владелец | Полный доступ ко всему (всегда проходит проверку прав) |
| `admin` | Администратор | Полный доступ кроме управления лицензией |
| `manager` | Менеджер | Торговля, аналитика, персонал; без управления пользователями |
| `cashier` | Кассир | Смена, продажи, клиенты, касса (POS) |
| `storekeeper` | Кладовщик | Склад, инвентаризация, приёмка, списания |
| `consultant` | Консультант (продавец) | Заказы консультанта, комиссии |
| `accountant` | Бухгалтер | Отчёты, финансы |

### 4.2. Роли кассовых сотрудников (`employees`)
Авторизация по PIN: `admin`, `manager`, `cashier`, `consultant`. Поле `access_pages` позволяет назначить кастомный набор доступных страниц.

### 4.3. Логика доступа к страницам
- `requireRole(...roles)` на backend — проверка роли для эндпоинтов (`owner` проходит всегда).
- На frontend: `canEmployeeAccessPage()`, `defaultPageForEmployee()` — определяют доступ и стартовую страницу.
- Страница по умолчанию по роли: Owner/Admin/Manager → Dashboard; Storekeeper → Inventory; Consultant → Consultant Orders; Cashier → POS.
- Кассир без кастомных прав ограничен страницами: `pos`, `commissions`, `worktime`.

---

## 5. Функциональные требования (модули)

### 5.1. Касса (POS) — `/pos`
- Сканирование штрихкодов (поиск товара в реальном времени, поддержка алиасов штрихкодов).
- Корзина: добавление, изменение количества, удаление позиций.
- Скидки: на позицию и на весь чек.
- Свободная цена (free price), торг (bargain) — управляются feature-флагами.
- Способы оплаты: наличные, карта, смешанная оплата (2 метода), долг (debt), частичная оплата.
- Привязка клиента, использование/начисление бонусов.
- Продажа в долг с датой погашения (`payment_due_date`).
- Отложенные чеки (held sales, авто-удаление через ~1 час).
- Заказы консультанта.
- Печать чека (термопринтер ESC/POS) и формирование QR-кода для электронного чека.
- Возврат по чеку.
- Идемпотентность продаж (`idempotency_key`) — защита от дублей при повторной отправке.

### 5.2. Товары — `/products`
- CRUD товаров; soft-delete (`is_active`).
- Поля: штрихкод (UNIQUE), SKU (UNIQUE), категория, единица измерения, цены (закупка/продажа/опт), остаток, мин/макс остаток.
- Признаки: весовой товар (`is_weight_product`), штучный/упаковочный (`is_piece_product`, `pieces_per_package`), срок годности (`has_expiry`).
- Алиасы штрихкодов (`product_barcode_aliases`).
- Импорт/экспорт CSV.
- Переоценка (revalue) — вкладка по feature-флагу.

### 5.3. Закупки — `/purchases`
- Партии закупок (`purchase_batches`) с позициями.
- Расчёт: количество, закупочная цена, скидка, наценка %, цена продажи, итог.
- Привязка к поставщику, опциональное применение к каталогу (`apply_to_catalog`).

### 5.4. Склад / Инвентарь — `/inventory`
Вкладки (по feature-флагам):
- **Остатки** — текущий сток с порогами min/max.
- **Приходы** (`/stock-receipts`, `requests`) — приёмка товара от поставщика, статус оплаты (debt/partial/paid), срок годности позиций.
- **Инвентаризация** (`/stock-taking`) — пересчёт: ожидаемое vs фактическое количество, авто-расчёт разницы.
- **Движения** — журнал `stock_movements` (приходы, продажи, возвраты, списания) с до/после остатком.
- **Списания** (`/write-off`) — списание товара с причиной и себестоимостью.

### 5.5. Ценники — `/price-labels`
- Генерация и печать ценников (jsbarcode), шаблоны.

### 5.6. Поставщики — `/suppliers`
- CRUD; расширенные реквизиты: тип, ИНН, контракт, банковские реквизиты (счёт, корр.счёт, МФО), менеджер.
- Учёт долга перед поставщиком, оплата долга (`supplier_payments`).

### 5.7. Клиенты — `/customers`
- CRUD; телефон (UNIQUE), карта лояльности (UNIQUE), email.
- Бонусные баллы, накопленная сумма, скидка %, ценовая группа.
- Долг клиента и кредитный лимит (`credit_limit`); оплата долга (`debt_payments`).
- История покупок.

### 5.8. Чеки и возвраты — `/receipts`, `/returns`
- История чеков с поиском (по ID, дате, сумме), повторная печать.
- Просмотр чека `/receipt/:id`; публичный просмотр по QR `/r/:id`.
- Возвраты: возврат по чеку, причина, способ возврата, фильтр по сотруднику.

### 5.9. Финансы — `/finance`
- Обзор: выручка, наличные, карта, долги, расходы, чистая прибыль.
- Расходы по категориям; внесение/изъятие наличных из кассы (`is_cash_in`, `is_cash_from_register`).
- Кассовая смена: открытие/закрытие, начальная/конечная наличность.
- Дневная сводка.

### 5.10. Смены — `/shifts`
- История смен (открытие/закрытие, кассир, касса, статус open/closed).

### 5.11. Сотрудники — `/employees`
- Кассовые сотрудники (PIN) и веб-пользователи.
- Роли, доступные страницы (`access_pages`), статус активности.

### 5.12. Рабочее время — `/worktime`
- Clock-in / clock-out, расчёт отработанных часов, журнал, сводка по сотруднику.

### 5.13. Зарплата
- Настройки зарплаты (`salary_settings`): тип (fixed/hourly/percent), оклад, ставка/час, % с продаж.
- Расчёты (`salary_calculations`): период, база, бонусы, удержания, итог; статусы draft/approved/paid.
- Корректировки (`salary_adjustments`).
- Отчёт по зарплате — `/payroll-report`.

### 5.14. Консультанты и комиссии — `/consultant-orders`, `/commissions`
- Заказы консультанта (`consultant_orders` + items).
- Комиссии (`commissions`): % с продажи/заказа, статус pending/paid, привязка к продаже/заказу, роль получателя.
- Бонусы персоналу (настройки `staff_bonus_percent_cashier`, `staff_bonus_percent_consultant`).
- Отчёт по консультантам — `/consultant-report`.

### 5.15. Дашборд — `/dashboard`
KPI и виджеты (каждый управляется feature-флагом):
- Переключатель периода, KPI-карты, диаграмма способов оплаты (donut), выручка по категориям, топ-товары, статистика кассиров, уведомления, оповещения о сроках годности, долги поставщиков, сводка по складу, последние операции.

### 5.16. Отчёты — `/reports`
Вкладки: продажи, товары, склад, сотрудники, долги, чеки, возвраты. Экспорт в CSV.

### 5.17. Уведомления
- Типы: `low_stock`, `debt`, `info`, `warning`, `error`.
- Авто-генерация оповещений о низком остатке.

### 5.18. Аудит — `/audit`
- Журнал действий (`audit_log`): действие, сущность, детали (JSONB), IP, сотрудник.

### 5.19. Настройки — `/settings`
- Магазин (название, адрес, телефон, ИНН), валюта, налог.
- Оборудование (принтер, весы — порты).
- Пароль настроек, мастер-код.
- Синхронизация с VPS (URL, ключ, интервал, вкл/выкл).
- Резервное копирование.
- **Feature-флаги** — десятки переключателей для включения/выключения функций и вкладок (хранятся в таблице `settings`).

### 5.20. Кассы/регистры — `/registers`
- Физические кассы (`registers`): device_id, api_key (генерация ключа), синхронизация.
- Онлайн-кассы (`online_registers`): браузерные, привязка к пользователю.

---

## 6. Backend: API и серверная часть

### 6.1. Точка входа и порядок запуска
Файл `backend/index.js`:
1. Загрузка конфигурации (dotenv).
2. Helmet (CSP), CORS (localhost + локальная сеть + `ALLOWED_ORIGINS`), JSON-лимит (100 МБ), rate-limit.
3. Шлюз лицензии (если `LICENSE_ENFORCEMENT=1`) — блокирует все `/api/*` кроме `/license` и `/receipt`.
4. Монтирование роутов.
5. Health-check `/health` (реальная проверка БД).
6. Глобальный обработчик ошибок (без утечки стектрейсов).
7. Раздача SPA из `../frontend/dist` (если есть), иначе API-only.
8. `initDB()` — схема, миграции, сиды.
9. Старт VPS-планировщика синхронизации.

### 6.2. Конфигурация (`backend/config.js`, переменные `.env`)
| Переменная | Назначение | По умолчанию |
|-----------|-----------|--------------|
| `PORT` | Порт сервера | 31417 |
| `NODE_ENV` | Окружение | development |
| `DATABASE_URL` | Строка подключения PostgreSQL | — |
| `JWT_SECRET` | Секрет JWT (обязателен в production) | insecure default |
| `ALLOWED_ORIGINS` | Доп. разрешённые origins (CSV) | — |
| `DB_POOL_MAX` | Макс. соединений пула | 20 |
| `DB_IDLE_TIMEOUT_MS` | Idle-таймаут | 30000 |
| `DB_CONNECTION_TIMEOUT_MS` | Таймаут подключения | 5000 |
| `JSON_BODY_LIMIT` | Лимит тела запроса | 100mb |
| `RATE_LIMIT_AUTH_MAX` | Лимит /auth | 20/мин |
| `RATE_LIMIT_SYNC_MAX` | Лимит /sync | 100/мин |
| `LOG_LEVEL` / `LOG_MAX_SIZE_BYTES` / `LOG_MAX_FILES` | Логирование | info / 10MB / 5 |
| `VPS_SYNC_INTERVAL_MINUTES` | Интервал выгрузки | 60 |
| `VPS_SYNC_START_DELAY_MS` | Задержка первой синхронизации | 15000 |
| `DELFIN_DUMP_PATH` / `DELFIN_AUTO_IMPORT` / `DELFIN_IMPORT_ALL` | Импорт из дампа Delfin (MySQL .sql) | — / 0 / 0 |
| `LICENSE_ENFORCEMENT` | Требовать лицензию | 0 |
| `LICENSE_TIER` | offline / online | online |
| `LICENSE_KEY_PATH` | Путь к license.lic | ./license.lic |

### 6.3. Роуты API
Все маршруты требуют JWT (`Authorization: Bearer <token>`), кроме `/api/license/*`, `/api/receipt/*`, `/r/:id`, `/health`.

#### Авторизация — `/api/auth`
- `POST /login` — вход, JWT (8ч).
- `POST /logout` — выход + отзыв токена.
- `POST /setup` — создание первого администратора (только если пользователей нет).
- `GET /me` — текущий пользователь.
- `POST /change-password` — смена пароля.
- `GET|POST /users`, `PUT|DELETE /users/:id` — управление пользователями (admin).
- `POST /revoke-user/:userId` — отзыв всех токенов пользователя.

#### Лицензия — `/api/license` (публично)
- `GET /device-id` — MAC-адрес ПК.
- `GET /status` — статус активации (rate-limited).
- `POST /activate` — активация (rate-limited 10/5мин).
- `POST /verify` — совместимость.

#### POS — `/api/pos`
- `POST /sale` — продажа (полная валидация, идемпотентность, транзакция).
- `GET /sale/:id` — детали продажи.
- `POST /return` — возврат.

#### POS extra — `/api`
- Рабочее время: `POST /work-time/clock-in`, `POST /work-time/:id/clock-out`, `GET /work-time/status/:employeeId`, `GET /work-time/log`, `GET /work-time/summary/:employeeId`, `PUT|DELETE /work-time/:id`.
- Причины корректировок: `GET|POST /adjustment-reasons`, `PUT|DELETE /adjustment-reasons/:id`.
- Отложенные чеки: `GET /pos/held`, `POST /pos/hold`, `DELETE /pos/held/:id`.
- Заказы консультантов, расчёты зарплаты, комиссии.

#### Кассовые сотрудники — `/api/pos-employees`
- `POST /login` — вход по PIN (JWT `src=pos`).
- `GET|POST /`, `PUT|DELETE /:id` — управление (admin/manager).

#### Товары — `/api/products`
- `GET /` (пагинация, поиск, фильтр категории, low-stock), `POST /`, `GET|PUT|DELETE /:id`.
- `POST /barcode-check`, `GET /by-barcode/:barcode` (с алиасами).

#### Клиенты — `/api/customers`
- `GET /`, `POST /`, `GET|PUT|DELETE /:id`, `GET /by-card/:card`, `POST /:id/pay-debt`, `POST /:id/update-bonus`.

#### Поставщики — `/api/suppliers`
- `GET /`, `POST /`, `GET|PUT|DELETE /:id`, `POST /:id/pay-debt`.

#### Закупки — `/api/purchases`
- `GET /`, `POST /`, `GET|PUT|DELETE /:id`, `POST /:id/mark-complete`, `POST /:id/items`, `DELETE /:id/items/:itemId`.

#### Склад — `/api/warehouse`
- Инвентаризации: `GET|POST /inventories`, `GET /inventories/:id/items`, `PUT /inventories/:id/items/:itemId`, `POST /inventories/:id/complete`.
- Списания: `GET|POST /write-offs`.
- `GET /stock-movements`.

#### Отчёты — `/api/reports`
- `GET /catalog-summary`, `/sales-by-day`, `/sales-by-category`, `/sales-by-employee`, `/top-products`, `/returns-summary`, `/customer-activity`.

#### Финансы — `/api/finance`
- `GET /report`, `/daily-summary`, `/expense-categories`.

#### Настройки — `/api/settings`
- `GET /all`, `GET|POST /:key`, `POST /vps-cloud/ping`, `POST /vps-cloud/sync-now`.

#### Прочее
- Дашборд `/api/dashboard/registers`; сотрудники `/api/employees`; уведомления `/api/notifications` (+ `check-stock`); аудит `/api/audit`; кассы `/api/registers` (+ `generate-key`); misc (`adjustment-reasons`, `held`, `daily-summary`).

#### Синхронизация
- `POST /api/sync/push` (Electron→Сервер, auth по `x-device-id`+`x-api-key`; серверная валидация цен).
- `GET /api/sync/pull` (Сервер→Electron: товары, категории, поставщики, клиенты, ценовые группы, единицы).
- `GET /api/sync/vps/ping`, `POST /api/sync/vps/ingest` (приём данных от магазинов; multi-tenant по `ingest_store_code`).

#### Публичный чек
- `GET /api/receipt/:id` (JSON), `GET /r/:id` (HTML по QR).

### 6.4. Middleware (`backend/middleware/auth.js`)
- `authMiddleware` — JWT + PIN (`x-register-pin`, локальная сеть); проверка blacklist (in-memory + таблица `revoked_tokens`); fail-secure при недоступности БД.
- `requireRole(...roles)` — RBAC (owner всегда проходит).
- `registerAuth` — авторизация кассы по `x-device-id` + `x-api-key`.

### 6.5. Библиотеки (`backend/lib`)
- `productBarcode.js` — SQL-хелпер поиска по основному штрихкоду или алиасам.
- `reportMetrics.js` — агрегации возвратов и слияние с продажами, округление денег.
- `delfinDumpImport.js` — импорт legacy-данных из MySQL-дампа Delfin при старте.

### 6.6. Фоновые задачи
- VPS-планировщик: периодическая выгрузка продаж/возвратов/расходов/приёмок на центральный сервер (интервал 5–1440 мин, retry, лог `vps_sync_log`, идемпотентность).
- Очистка `revoked_tokens` (раз в 24ч).
- SQL-функция `cleanup_sync_log()` — очистка `sync_log` при превышении 100k записей.

---

## 7. Модель данных (БД)

> PostgreSQL, версионные миграции в таблице `schema_migrations` (версии 1–69). Денежные значения — `NUMERIC(15,2)`, временные метки — `TIMESTAMPTZ`, списки позиций — `JSONB`.

### 7.1. Пользователи и авторизация
- **`admin_users`** — веб-пользователи: `id, username (UNIQUE), password_hash, role (CHECK 7 ролей), full_name, phone, is_active, created_at`.
- **`employees`** — кассовые сотрудники (PIN): `id, name, role, pin, barcode (UNIQUE), phone, salary, access_pages, is_active, created_at`.
- **`revoked_tokens`** — отозванные JWT: `jti (PK), user_id, expires_at, reason, created_at`.

### 7.2. Магазины и кассы
- **`shops`** — `id, name, address, phone, inn, created_at`.
- **`registers`** — физические кассы: `id, shop_id, name, device_id (UNIQUE), api_key, last_sync, created_at`.
- **`online_registers`** — браузерные кассы: `id, name, assigned_to, is_active, created_at`.
- **`shifts`** — смены: `id, employee_id, register_id, opened_at, closed_at, opening_cash, closing_cash, status (open/closed)`.

### 7.3. Каталог
- **`products`** — `id, name, barcode (UNIQUE), sku (UNIQUE), category_id, unit_id, purchase_price, selling_price, wholesale_price, stock_quantity, min_stock, max_stock, is_weight_product, is_piece_product, pieces_per_package, has_expiry, description, image_url, is_active, version, updated_at, created_at`.
- **`product_barcode_aliases`** — `id, product_id, barcode (UNIQUE), created_at`.
- **`categories`** — `id, name (UNIQUE), color, version, created_at`.
- **`units`** — `id, name, short_name (UNIQUE)`.
- **`price_groups`** — `id, name, discount_percent (0–100), created_at`.

### 7.4. Клиенты и поставщики
- **`customers`** — `id, name, phone (UNIQUE), email, card_number (UNIQUE), price_group_id, bonus_points, total_spent, discount_percent, debt, credit_limit, notes, is_active, version, created_at`.
- **`suppliers`** — `id, name, phone, address, contact_person, inn, notes, supplier_type, contract_number, contract_date, bank_name, bank_account, bank_corr_account, bank_mfo, manager_name, manager_phone, debt, is_active, version, created_at`.

### 7.5. Продажи и возвраты
- **`online_sales`** — `id, shift_id, register_id, employee_id (→employees), customer_id, total_amount, discount, bonus_used, bonus_earned, tax_amount, payment_method, payment_method2, amount_method2, paid_amount, payment_status (completed/partial/debt), payment_due_date, items (JSONB), status, receipt_contact, idempotency_key (UNIQUE), synced_to_vps, ingest_store_code, source_local_sale_id, created_at`.
- **`online_returns`** — `id, sale_id, employee_id, reason, total_amount, return_method, items (JSONB), idempotency_key, synced_to_vps, ingest_store_code, source_local_return_id, created_at`.
- **`held_sales`** — отложенные чеки: `id, employee_id, shift_id, items (JSONB), note, created_at`.

### 7.6. Склад
- **`receivings`** / **`receiving_items`** — приёмки: статус, поставщик, номер накладной, оплата (debt/partial/paid), `expiry_date` позиций, `total` (GENERATED).
- **`inventories`** / **`inventory_items`** — инвентаризации: `expected_qty`, `actual_qty`, `difference` (GENERATED).
- **`stock_movements`** — движения: `product_id, type, quantity, before_quantity, after_quantity, reference_id, reference_type, notes, employee_id, employee_source, created_at`.
- **`write_offs`** / **`write_off_items`** — списания.
- **`purchase_batches`** / **`purchase_batch_items`** — партии закупок с наценкой и итогом.

### 7.7. Платежи и расходы
- **`debt_payments`** — оплата долгов клиентов.
- **`supplier_payments`** — оплата долгов поставщикам.
- **`expenses`** — `id, shift_id, category, amount, description, employee_id, is_cash_from_register, is_cash_in, synced_to_vps, idempotency_key, ingest_store_code, created_at`.

### 7.8. Персонал
- **`work_time_records`** — учёт времени.
- **`salary_settings`**, **`salary_calculations`**, **`salary_adjustments`** — зарплата.
- **`consultant_orders`**, **`consultant_order_items`** — заказы консультантов.
- **`commissions`** — комиссии (привязка к sale_id/order_id, recipient_role).

### 7.9. Системные таблицы
- **`settings`** — ключ/значение (настройки, feature-флаги, пароли, VPS-параметры).
- **`notifications`** — уведомления.
- **`audit_log`** — журнал действий.
- **`adjustment_reasons`** — причины корректировок (сиды).
- **`idempotency_keys`** — ключи идемпотентности (TTL 24ч).
- **`sync_log`**, **`vps_sync_log`** — журналы синхронизации.
- **`sync_sales`, `sync_returns`, `sync_expenses`, `sync_inventory`** — кэш синхронизации Electron-касс (UNIQUE по register_id + local_id/barcode).
- **`licenses`** — `mac_address (UNIQUE), license_key, device_name, tier, expires_at, activated_at, last_check, is_active, notes`.

### 7.10. Важные особенности схемы
- `online_sales.employee_id` / `online_returns.employee_id` → `employees` (исправлено миграцией 36; ранее ошибочно ссылались на `admin_users`).
- `stock_movements.employee_id` / `audit_log.employee_id` — без FK (миграция 39), хранят ID из любой таблицы; источник в `employee_source` ('pos'/'admin').
- Точность денег приведена к `NUMERIC(15,2)` (миграция 20).
- Индексы на: штрихкод, категорию, остаток, дату продаж, сотрудника/клиента/смену, долги (частичные индексы `WHERE debt > 0`), идемпотентность, флаги синхронизации `WHERE synced_to_vps = false`.

---

## 8. Frontend: веб-приложение

### 8.1. Структура `src/`
```
api/         — доменные API-модули (commissions, consultant, salary, work-time)
browser/     — apiAccess.ts (lazy proxy), httpApi.ts (основной HTTP-клиент)
components/  — auth, layout (Sidebar, Notifications, Pagination), common
               (MobileCard, ResponsiveTable), setup, ui (DateInput, NumericInput),
               BarcodeScannerModal, CustomerDisplay, OrderSearch
hooks/       — useFeatureFlags, useMediaQuery, useNavigatePage, useResponsivePage
lib/         — pageAccess, accessPages, featureFlags
pages/       — все страницы (см. раздел 5) + reports/
routes/      — paths.ts (PAGE_TO_SLUG / SLUG_TO_PAGE)
store/       — useStore.ts (Zustand)
types/       — index.ts, consultant.ts
utils/       — format.ts, saleTotal.ts, useCurrency.ts
App.tsx, main.tsx, api-init.ts, CustomerDisplay.tsx, display-main.tsx, index.css
```

### 8.2. Маршрутизация (slug-based)
URL ↔ page id (kebab-case для составных): `dashboard, pos, products, purchases, inventory, suppliers, employees, finance, reports, returns, settings, customers, receipts, price-labels, consultant-orders, commissions, worktime, consultant-report, payroll-report, requests, stock-receipts, stock-taking, registers, write-off, shifts`. Спец-маршруты: `/login`, `/`, `/:slug`, `/receipt/:id`.

### 8.3. Управление состоянием (Zustand)
Глобальный store: `currentEmployee`, корзина (`cart`, `addToCart`, `updateCartItem`, `removeFromCart`, `clearCart`, скидки), `activePage`, `notifications`, настройки (`currency`, `shopName`, `loadSettings`). JWT хранится в `localStorage`. Корзина эфемерна.

### 8.4. API-клиент
`browser/httpApi.ts` (`createBrowserHttpApi()`) — домены auth/settings/reports/products/customers/... (100+ методов). Base URL `/api` (или `VITE_API_BASE`). Токен в `Authorization: Bearer`, авто-ретрай при 401. Нормализация числовых типов PostgreSQL → number (`toMoney`).

### 8.5. UI / дизайн-система
- Без внешнего UI-фреймворка; кастомные CSS-переменные (primary `#1a7a6e` и др.), utility-классы.
- Sidebar с секциями: ТОРГОВЛЯ, СКЛАД, АНАЛИТИКА, МОЯ РАБОТА.
- Mobile-first (брейкпоинт 768px), safe-area, touch-цели ≥ 44×44px.
- Иконки LineIcons (`lni lni-*`).

### 8.6. Локализация
- Интерфейс — только русский (хардкод, без i18n-библиотеки).
- Форматирование: даты `ru-RU` (ДД.ММ.ГГГГ), числа `Intl.NumberFormat('ru-RU')`, валюта настраивается (по умолчанию сомони).

### 8.7. Дополнительный экран
- `CustomerDisplay.tsx` / `display-main.tsx` — экран покупателя (второй монитор) через BroadcastChannel API.

---

## 9. Система лицензирования (Ed25519)

### 9.1. Криптооснова
- Алгоритм **Ed25519** (асимметричный).
- **Приватный ключ** (`license-tools/private.pem`) — только у поставщика, в git не попадает.
- **Публичный ключ** — встроен в `backend/routes/license.js`.

### 9.2. Генерация лицензии (`license-tools/generate-license.js`)
```bash
node generate-license.js \
  --mac "aa:bb:cc:dd:ee:ff" \
  --client "Магазин Рахмат, Душанбе" \
  --expires "2027-12-31" \
  --tier offline \
  --out ./license.lic
```
Параметры: `--mac` (обязательно), `--client`, `--expires` (YYYY-MM-DD, пусто = бессрочная), `--tier` (standard/pro/demo/offline/online), `--out`.

Результат — файл `license.lic`:
```json
{ "mac": "...", "client": "...", "expires": "...", "tier": "...",
  "issued": "...", "signature": "<base64 Ed25519>" }
```
Подписывается payload `{ mac, client, expires, tier, issued }` без поля `signature`.

### 9.3. Тарифы
- **`offline`** — облачная синхронизация с VPS запрещена (только локальная работа).
- **`online`** — синхронизация разрешена (настройки в панели).

### 9.4. Поток активации
1. Клиент запускает приложение → видит «ID этого компьютера» (`GET /api/license/device-id`) → сообщает MAC поставщику.
2. Поставщик генерирует `license.lic` под этот MAC.
3. Активация: **(A)** положить файл рядом с backend (авто-чтение при старте) или **(B)** загрузить через веб-интерфейс (`POST /api/license/activate`).
4. При старте/`GET /api/license/status`: загрузка файла → проверка подписи Ed25519 → сверка MAC с ПК → проверка срока → кэш в `licenses` (TTL 5 мин).
5. При `LICENSE_ENFORCEMENT=1` шлюз блокирует `/api/*` (кроме `/license`, `/receipt`) до активации.

### 9.5. Управление лицензиями
- Отзыв: `UPDATE licenses SET is_active=false WHERE mac_address=... AND license_key=...`.
- Разблокировка: `UPDATE licenses SET is_active=true WHERE mac_address=...`.

---

## 10. Синхронизация и облако (VPS)

### 10.1. Архитектура
Магазины (market-local, офлайн-первая БД) → выгрузка на центральный VPS (`POST /api/sync/vps/ingest`). VPS — multi-tenant (различение по `ingest_store_code`).

### 10.2. Что выгружается магазин → VPS
Продажи (с позициями), возвраты, расходы, приёмки. Идемпотентность через `idempotency_key`; пометка `synced_to_vps`.

### 10.3. Что приходит VPS → магазин
Товары и цены, категории, единицы, клиенты, сотрудники, настройки.

### 10.4. Настройка (Настройки → Синхронизация)
- URL центрального сервера, API-ключ магазина, интервал, режим online/offline.
- Backend: планировщик с задержкой старта `VPS_SYNC_START_DELAY_MS`, интервал `VPS_SYNC_INTERVAL_MINUTES`, лог в `vps_sync_log`.

### 10.5. Синхронизация Electron-касс (локальная сеть)
- `POST /api/sync/push` (касса→сервер, серверная валидация цен — защита от подмены), `GET /api/sync/pull` (сервер→касса).

---

## 11. Безопасность

- **JWT**: веб 8ч, касса (`src=pos`) 12ч; `jti` + таблица `revoked_tokens`; in-memory blacklist; fail-secure при недоступности БД.
- **Пароли**: bcryptjs.
- **PIN-авторизация** только из локальной сети.
- **Helmet CSP**: ограниченные источники (unsafe-inline для React); отключены upgrade-insecure-requests/COOP/originAgentCluster для работы по HTTP в локальной сети.
- **CORS**: localhost + локальные подсети + явные origins из `.env`.
- **Rate-limiting**: `/auth` 20/мин, `/sync` 100/мин, `/license/activate` 10/5мин.
- **Идемпотентность** продаж/возвратов/расходов — защита от дублей.
- **Серверная валидация цен** при синхронизации — защита от подмены на кассе.
- **Аудит** чувствительных операций (`audit_log`).
- **Глобальный обработчик ошибок** — без утечки стектрейсов клиенту.
- **Soft-delete** (`is_active`) — сохранение исторических данных.
- **Лицензирование** — Ed25519 + привязка к MAC.
- Чувствительные настройки (`settings_password`, `master_code`, JWT, VPS-ключ) доступны только owner/admin/manager.

---

## 12. Развёртывание и поставка

### 12.1. Коробочный пакет (market-local)
**Назначение**: автономная установка на ПК магазина.

**Сборка** (у поставщика): `build-bundle.sh` / `build-bundle.ps1`:
1. Копирование backend без dev-зависимостей.
2. `npm ci --omit=dev`.
3. esbuild → `server.cjs` (~3 МБ, один файл).
4. Удаление исходников (остаётся `server.cjs`, `package.json`, `public/`, `.env.example`).
5. Сборка frontend: `VITE_MARKET_LOCAL_BUNDLE=1 VITE_ENABLE_LICENSE_GATE=1 npm run build`.
6. Установка зависимостей лаунчера (`pg`).
7. `apply-readonly` — права «только чтение».

**Установка у клиента**:
- Требования: Node.js 18+, PostgreSQL 14+.
- Запуск: `start.bat` (Windows) / `Start.command`/`start.sh` (macOS/Linux).
- Лаунчер (`launcher/start.mjs`): проверка Node/сборки → создание `.env` из шаблона → подключение к PostgreSQL → авто-создание БД `marketpro` → старт backend → веб-панель на `http://localhost:31777`.
- Автозапуск: `install-autostart-windows.ps1` / `install-autostart-macos.sh`.

### 12.2. VPS (Docker)
- `bootstrap-docker-vps.sh /opt/market http://IP:31417` — авто-установка PostgreSQL + Docker + Compose, генерация JWT_SECRET/пароля БД, создание `.env.docker`.
- `docker-compose.yml` — контейнер `market_app` (node:20-alpine, backend+SPA), PostgreSQL на хосте через `host.docker.internal`, порт `PUBLIC_HTTP_PORT` (31417).
- Многоступенчатый `Dockerfile`: сборка frontend → финальный образ с backend + `frontend/dist`.

### 12.3. VPS (Native)
Node 18+ + PostgreSQL 14+, `npm ci --omit=dev`, сборка фронта, запуск через PM2 (автозапуск).

### 12.4. Nginx (reverse proxy)
`nginx.vps.conf`: проксирование `/api/`, SPA-роутинг (`try_files`), `client_max_body_size 100m`, увеличенные таймауты для синхронизации; опционально Let's Encrypt (HTTPS).

### 12.5. Обслуживание
- Логи: `docker logs market_app -f`, файлы в `logs/`.
- Бэкап: `pg_dump`/`psql`.
- Health: `curl http://127.0.0.1:31417/health`.

---

## 13. Интеграция с оборудованием

| Устройство | Технология | Назначение |
|-----------|-----------|------------|
| Термопринтер | escpos (ESC/POS) | Печать чеков |
| Сканер ШК | USB / html5-qrcode (веб-камера) | Сканирование штрихкодов/QR |
| Электронные весы | serialport | Весовые товары |
| Экран покупателя | BroadcastChannel API | Второй монитор |
| Печать ценников | jsbarcode | Генерация штрихкодов |
| QR электронного чека | qrcode | QR-ссылка на чек `/r/:id` |

---

## 14. Нефункциональные требования

- **Офлайн-работа**: полная функциональность без интернета (локальная PostgreSQL).
- **Масштабируемость**: до ~50 касс на один сервер в локальной сети; пул соединений до 20.
- **Производительность**: индексы на ключевых полях; частичные индексы для долгов и синхронизации.
- **Надёжность**: транзакции продаж, идемпотентность, fail-secure авторизация, версионные миграции.
- **Совместимость ОС**: Windows 10+, macOS, Linux.
- **Сетевая модель**: HTTP в локальной сети, HTTPS для облака.
- **Локализация денег**: `NUMERIC(15,2)`, формат `ru-RU`.
- **Логирование**: winston с ротацией.

---

## 15. Тестирование

- **Backend**: `backend/tests/` — `api.test.js` (интеграция: пользователи, поставщики, товары, категории, приёмки, продажи, возвраты), `access-control.test.js` (RBAC), `report-metrics.test.js` (метрики отчётов). Запуск: `npm test`.
- **Frontend**: Jest (unit), Playwright (e2e, в т.ч. smoke), supertest, fast-check (property-based).
- **Покрытие критичных сценариев**: продажа, возврат, идемпотентность, контроль доступа по ролям, расчёт отчётов.

---

## 16. Глоссарий

| Термин | Определение |
|--------|-------------|
| **POS** | Point of Sale — кассовый узел (продажи) |
| **market-local** | Коробочный автономный пакет для ПК магазина |
| **VPS** | Центральный облачный сервер для консолидации данных магазинов |
| **Ed25519** | Алгоритм цифровой подписи для лицензирования |
| **license.lic** | Файл лицензии, привязанный к MAC-адресу ПК |
| **feature-флаг** | Переключатель функции/вкладки (таблица `settings`) |
| **idempotency_key** | Ключ для предотвращения повторной обработки операции |
| **held sale** | Отложенный чек |
| **тариф offline/online** | Режим лицензии: без облака / с облачной синхронизацией |
| **PIN-авторизация** | Вход кассира по PIN (только локальная сеть) |
| **JWT** | Токен авторизации (8ч веб / 12ч касса) |
| **Delfin** | Legacy-система, из дампа которой импортируются данные |

---

*Документ описывает текущее состояние реализованной платформы MarketPro (backend, frontend, лицензирование, синхронизация, поставка). Является технической спецификацией «как реализовано» (as-built).*
