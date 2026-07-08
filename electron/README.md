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
   Postgres пакет кладёт в `node_modules/@embedded-postgres/<os>-<arch>/native/bin`
   (подтверждено на реальной установке: `@embedded-postgres/windows-x64/native/bin`) —
   `main.js` (`findPgBinDir()`) ищет их там (и в `app.asar.unpacked` в собранном
   .exe). **Версия:** пакет публикует ТОЛЬКО бета-версии, привязанные к мажору
   Postgres (нет стабильной `17.5.0` — только `17.5.0-beta.15`); в `package.json`
   зафиксирована точная `17.10.0-beta.17` (Postgres 17). **⚠️ pg_dump НЕ входит в
   комплект:** windows-пакет содержит только серверные бинарники (`initdb`/`pg_ctl`/
   `postgres.exe`), клиентского `pg_dump.exe` нет → плановый бэкап `backup.js`
   пока gracefully пропускается. Варианты: доложить `pg_dump.exe` в extraResources,
   логический дамп через `getPgClient()`, или JSON-экспорт из API. Не блокер:
   данные в persistent `pgdata` не теряются.
9. **Канал автообновлений.** `electron-updater` вызывается в `main.js`
   (`autoUpdater.checkForUpdatesAndNotify()`), но `publish` в
   `package.json` → `build` сейчас `null` (заглушка). Владельцу нужно
   решить: свой сайт (генерировать `latest.yml` + `.exe` самостоятельно)
   или GitHub Releases (`provider: "github"` + токен), см.
   [`docs/06-АРХИТЕКТУРА-КОРОБКА-ЭЛЕКТРОН.md`](../docs/06-АРХИТЕКТУРА-КОРОБКА-ЭЛЕКТРОН.md#7-авто-обновление).

## Проверено реальной сборкой (2026-07-08) ✅

`npm install` + `npm run dist` реально прогнаны на Windows. Результат:

**✅ Приложение полностью собирается** — `electron/release/win-unpacked/` содержит
рабочую сборку: `PrintPro.exe`, наш код (`app.asar`), `printpro-api/dist` (+`node_modules`),
`printpro-web` (standalone), встроенный Postgres (`initdb/postgres/pg_ctl.exe` в
`app.asar.unpacked`), Prisma CLI + `schema.prisma` + **48 миграций**, компилируемый seed.
То есть `win-unpacked/PrintPro.exe` — **уже запускаемая портативная версия** коробки
(можно запустить напрямую, без установщика).

**Блокеры, найденные и закрытые при сборке:**
1. ✅ `embedded-postgres@^17.5.0` не существовал → зафиксирована `17.10.0-beta.17` (в `package.json`).
2. ✅ Жёсткая ссылка на несуществующую иконку убрана (используется дефолтная Electron-иконка).
3. ✅ Путь к бинарникам Postgres (`findPgBinDir`) подтверждён на реальной установке.

**Два шага, требующие ОКРУЖЕНИЯ (не кода) — сделать на машине владельца:**
1. **winCodeSign — симлинки.** electron-builder распаковывает `winCodeSign`, где есть
   macOS-симлинки; Windows создаёт симлинки только с **Developer Mode** (Параметры → Для
   разработчиков → вкл) ИЛИ из терминала «от администратора». (Обходной путь без прав:
   вручную распаковать архив без папки `darwin` — `7za x <кэш>/*.7z -o<кэш>/winCodeSign-2.6.0 -xr!darwin`.)
2. **`nsis-resources-3.4.1.7z` — скачивание.** Финальная упаковка в установщик качает этот
   файл с GitHub CDN (`release-assets.githubusercontent.com`). На обычной машине скачается
   сам; в среде без доступа к GitHub CDN — упадёт по таймауту (тогда win-unpacked уже готов).

**Итого для получения `PrintPro Setup.exe`:** на Windows-ПК с обычным интернетом и
Developer Mode → `npm install && npm run dist` в `electron/` (api и web предварительно
собрать: `npm run build`). Установщик появится в `electron/release/`.

## Остаётся по желанию (не блокеры)
- Иконка приложения (`electron/build/icon.ico`) — сейчас дефолтная.
- Канал автообновлений (`publish` в package.json) и лицензирование (Ed25519) — Фаза 4.
- Реальный `pg_dump` для бэкапа: в `embedded-postgres` его НЕТ (только серверные
  бинарники) — доложить `pg_dump.exe` в extraResources, либо логический дамп/JSON-экспорт.
- Ручная проверка сценария «касса»: два ПК в одной сети, разный `role` в `setup.html`.
