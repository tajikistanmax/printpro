# PrintPro Desktop (Electron) — скелет коробочной версии

> Фаза 1 плана из [`docs/06-АРХИТЕКТУРА-КОРОБКА-ЭЛЕКТРОН.md`](../docs/06-АРХИТЕКТУРА-КОРОБКА-ЭЛЕКТРОН.md).
> Это **обёртка** вокруг уже существующего кода `printpro-api` и `printpro-web`.
> Бизнес-логика (касса, заказы, склад, отчёты) здесь не дублируется и не
> трогается — меняется как обычно в `printpro-api`/`printpro-web`, в коробку
> прилетает через обычную пересборку/автообновление.

## Что здесь лежит

| Файл | Роль |
|---|---|
| `package.json` | Отдельный npm-пакет `printpro-desktop`: зависимости, скрипты `start`/`dist`, конфиг `electron-builder` (поле `build`). |
| `main.js` | Главный процесс Electron: пути, роль ПК, встроенный Postgres, запуск API и веб-сервера как дочерних процессов, окно, меню, автообновление, корректное завершение. |
| `preload.js` | Минимальный мост (`contextIsolation: true`) для экрана настройки: `window.electronAPI.{getConfig, getLanIp, saveConfig}`. |
| `setup.html` / `setup.js` | Экран первого запуска: выбор роли ПК («Главный компьютер» / «Касса»), адрес главного ПК, галочка «Синхронизировать с облаком». Отдельный экран Electron, НЕ часть `printpro-web`. |
| `backup.js` | Заглушка-модуль планового локального бэкапа (`pg_dump` → `<userData>/backups`, ротация по числу файлов). |

## Как это работает (коротко)

1. При первом запуске роль ПК не задана → показывается `setup.html`.
2. Пользователь выбирает **«Главный компьютер»** или **«Касса»** (+ адрес
   главного ПК для кассы, + галочка облака). Сохранение пишет в
   `electron-store` (`userData/config.json`) и **перезапускает** приложение
   (`app.relaunch()`), чтобы дальше пойти по обычной ветке запуска.
3. **Главный ПК** (`role: 'main'`):
   - поднимает встроенный Postgres (`embedded-postgres`) в
     `userData/pgdata` (порт `5433`, чтобы не конфликтовать с системным
     Postgres, если он есть у клиента);
   - применяет миграции Prisma (`prisma migrate deploy`, CLI напрямую, без
     `npx` — коробка работает офлайн);
   - запускает компилируемый seed (`dist/bootstrap/seed.js` — **есть**,
     идемпотентный, не затирает данные при повторных запусках);
   - запускает `printpro-api` (`node dist/main.js`) с нужными `env`
     (`DATABASE_URL`, `JWT_SECRET` из config, `UPLOADS_DIR`, `ALLOW_LAN_ORIGINS`);
   - ждёт `GET /api/health` (эндпоинт **есть** — `HealthController`);
   - запускает `printpro-web` в режиме `standalone` (`node server.js`,
     `HOSTNAME=0.0.0.0`, чтобы кассы по LAN достучались);
   - открывает окно на `http://127.0.0.1:3001`, в заголовке/меню показывает
     LAN-адрес этого ПК — чтобы на кассах ввести те же цифры;
   - раз в 6 часов запускает `pg_dump` через `backup.js`.
4. **Касса** (`role: 'cash'`): никакой базы/API не поднимает — просто окно
   на `http://<mainHost>:3001` (адрес главного ПК из настроек).
5. При выходе (`before-quit`) корректно останавливаются: веб-процесс,
   API-процесс, встроенный Postgres (`pg.stop()`).
6. `electron-updater` проверяет обновления при старте, обёрнут в try/catch —
   отсутствие настроенного канала раздачи не роняет приложение.

## Порты и пути по умолчанию

- Postgres: `127.0.0.1:5433`, БД `printpro`, пользователь/пароль
  `postgres`/`printpro_local` (локальная встроенная БД наружу не смотрит).
- API: `127.0.0.1:3000` (`/api/...`).
- Веб: `0.0.0.0:3001` (слушает все интерфейсы — нужно для касс по LAN).
- Данные пользователя: `app.getPath('userData')/{pgdata,uploads,backups,logs,config.json}`
  — **вне** папки установки, чтобы обновление программы не стирало данные.

## Сборка (когда будет реальная упаковка)

```bash
cd electron
npm install                     # electron, electron-builder, electron-updater, electron-store, embedded-postgres, electron-log

# Собрать то, что будет упаковано (в соседних папках монорепозитория):
cd ../printpro-api && npm ci && npx prisma generate && npm run build
cd ../printpro-web  && npm ci && npm run build      # next.config уже output: "standalone"

cd ../electron
npm run dist                    # electron-builder → electron/release/*.exe
```

**Важно про сборку `printpro-web`:** сознательно **не задавайте**
`NEXT_PUBLIC_API_BASE` / `NEXT_PUBLIC_SERVER_ORIGIN` при `next build` для
десктоп-сборки. `printpro-web/src/lib/config.ts` уже умеет сам определять
адрес API по `window.location.hostname` (localhost/LAN-адрес → тот же
хост:3000/api, иначе → облако) — это уже готово и работает как для главного
ПК, так и для касс без каких-либо изменений. Если эти переменные жёстко
задать на этапе сборки, LAN-автоопределение сломается для касс (они получат
адрес API главного ПК, "зашитый" во время сборки, а не свой).

`npm run start` в `electron/` запускает приложение в режиме разработки
(без упаковки) — тогда пути ресурсов берутся из `../printpro-api` и
`../printpro-web/.next/standalone` (см. `getPaths()` в `main.js`), то есть
монорепозиторий должен быть уже собран (`npm run build` в обеих папках).

## Хост-правки — статус (обновлено оркестратором, 2026-07-08)

Правки в `printpro-api`/`printpro-web`, нужные коробке. **Пункты 1–4 уже
внесены** (см. коммиты сессии 2026-07-08); 5 — не требуется при сборке на
Windows; 6 — единственная реальная зависимость для тиражирования на много
клиентов (см. ниже).

1. ✅ **Компилируемый seed.** Сделано: `printpro-api/src/bootstrap/seed.ts`
   → `dist/bootstrap/seed.js` (+ npm-скрипт `seed`), идемпотентный. `main.js`
   (`runSeed()`) вызывает именно его.
2. ✅ **`UPLOADS_DIR` в printpro-api.** Сделано: `main.ts` и
   `image-upload.options.ts` читают `process.env.UPLOADS_DIR` (fallback
   `./uploads`). `main.js` пробрасывает `UPLOADS_DIR = userData/uploads`.
3. ✅ **Флаг `ALLOW_LAN_ORIGINS`.** Сделано: в `main.ts` LAN-CORS теперь
   `(allowLan || !isProduction) && isTrustedDevOrigin(origin)`, где
   `allowLan = process.env.ALLOW_LAN_ORIGINS === '1'`. `main.js` его передаёт.
4. ✅ **`/api/health`.** Сделано: `HealthController` (`/api/health` liveness
   + `/api/health/ready` с проверкой БД). `main.js` (`waitForHttpOk`) ждёт его.
5. ⏭️ **`prisma binaryTargets` — не требуется при сборке на Windows.**
   `.exe` собирается на Windows-ПК, где `prisma generate` даёт native =
   windows-движок; `extraResources` в `package.json` копирует `.prisma`/
   `@prisma/client`. Явный `binaryTargets` в схему НЕ добавлен намеренно —
   чтобы не тянуть лишний движок в облачную (Linux) сборку. Если когда-нибудь
   будете собирать коробку в non-Windows CI — добавьте
   `binaryTargets = ["native", "windows"]` в `generator client`.
6. ✅ **Рантайм-резолв `companyId` — СДЕЛАНО.** Теперь один `.exe` может
   обслуживать разных клиентов: (а) `src/bootstrap/seed.ts` при `BOX_MODE=1`
   генерирует случайный `companyId` на первом запуске и переиспользует его
   дальше (без BOX_MODE облако сохраняет фиксированный UUID); `main.js`
   передаёт `BOX_MODE=1` в seed; (б) публичный `GET /api/system/company-id`
   возвращает companyId установки; (в) фронт (`lib/config.ts` +
   `lib/CompanyIdResolver.tsx` в layout) резолвит его в рантайме и кэширует в
   localStorage (fallback на `NEXT_PUBLIC_COMPANY_ID`). Для облака id совпадает
   с fallback → поведение не меняется. Оговорка: на ПЕРВОМ запуске коробки
   фронт один раз перезагрузится, чтобы подхватить сгенерированный companyId
   (возможен кратковременный hydration-warning в консоли — не влияет на работу).

**Также внесено при ревью скелета (2026-07-08):** `main.js` теперь генерирует
и хранит `JWT_SECRET` в `config` и передаёт его в API — без этого API в
production падал бы на старте (`assertRequiredEnv` требует `JWT_SECRET`).

### Дополнительно — найдено при сборке скелета (сверх исходного списка ТЗ)

7. **Полный `node_modules` printpro-api.** `nest build` (см.
   `printpro-api/package.json`, скрипт `build`) компилирует TypeScript в
   `dist/`, но **не бандлит** зависимости (Express, NestJS, bcryptjs и
   т.д.) — `dist/main.js` без `node_modules` рядом не запустится. В
   `electron/package.json` (`extraResources`) уже добавлена копия всего
   `printpro-api/node_modules` целиком — это раздувает установщик. Перед
   реальным релизом стоит рассмотреть `nest build --webpack` (один файл
   без `node_modules`) или хотя бы `npm ci --omit=dev` перед упаковкой,
   чтобы не тащить `devDependencies`.
8. **`embedded-postgres` — API сверен ✅, бинарники под Windows.** API пакета
   проверен по документации: конструктор (`databaseDir/user/password/port/
   persistent/onLog/onError`) и методы `initialise()`/`start()`/`stop()`/
   `createDatabase()` — актуальны, `main.js` их использует правильно (onLog/
   onError теперь подключены к `electron-log`). Путь prisma CLI тоже сверен
   (`node_modules/prisma/build/index.js`, prisma v6 — файл существует). Бинарники
   Postgres пакет тянет из zonky в `node_modules/@embedded-postgres/<os>-<arch>/
   native/bin` — `main.js` (`findPgBinDir()`) ищет их там динамически (и в
   `app.asar.unpacked` в собранном .exe); если структура пакета иная —
   `backup.js` gracefully пропустит бэкап (не роняя приложение). Версию
   `embedded-postgres` в `package.json` сверьте с актуальной на npm при установке
   (платформенные бинарники Postgres идут `optionalDependencies` — размер
   установщика зависит от включённых платформ).
9. **Канал автообновлений.** `electron-updater` вызывается в `main.js`
   (`autoUpdater.checkForUpdatesAndNotify()`), но `publish` в
   `package.json` → `build` сейчас `null` (заглушка). Владельцу нужно
   решить: свой сайт (генерировать `latest.yml` + `.exe` самостоятельно)
   или GitHub Releases (`provider: "github"` + токен), см.
   [`docs/06-АРХИТЕКТУРА-КОРОБКА-ЭЛЕКТРОН.md`](../docs/06-АРХИТЕКТУРА-КОРОБКА-ЭЛЕКТРОН.md#7-авто-обновление).

## Что осталось до реального `.exe`

- ✅ Хост-правки 1–4 (seed/UPLOADS_DIR/ALLOW_LAN_ORIGINS/health) + JWT_SECRET —
  **сделаны**. Осталась только правка 6 (рантайм-companyId) — и то лишь для
  тиражирования на разных клиентов; для первого `.exe` не нужна.
- Установить зависимости (`npm install` в `electron/`) и один раз реально
  собрать (`npm run dist`) — проверить, что `embedded-postgres` действительно
  тянет и распаковывает бинарники Postgres под Windows, уточнить все
  `TODO(build)` в `main.js`/`backup.js`/`package.json`.
- Иконка приложения (`electron/build/icon.ico` — указана в `package.json`
  → `build.win.icon`, файла пока нет).
- Решить канал автообновлений и лицензирование (Ed25519, `license.lic`) —
  в бэклоге, не входит в Фазу 1.
- Реальный `pg_dump` в `backup.js` (сейчас корректно логирует и не падает,
  но бэкап фактически не создастся, пока не уточнён путь к бинарнику).
- Ручная проверка сценария «касса»: два реальных ПК в одной сети, разный
  `role` в `setup.html`, убедиться что CORS/health/`UPLOADS_DIR` действительно
  работают после правок из п.1-4 выше.
