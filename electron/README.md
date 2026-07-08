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

## Проверено реальной сборкой (2026-07-08) ✅ — УСТАНОВЩИК СОБРАН

`npm install` + `npm run dist` реально прогнаны на Windows **до конца**. Результат:

**✅ Полноценный установщик собран:** `electron/release/PrintPro Setup 0.1.0.exe`
(**~283 МБ**, валидный PE-файл, + `.blockmap` для дифф-обновлений, + встроенный
деинсталлятор). Внутри — `PrintPro.exe`, наш код (`app.asar`), `printpro-api/dist`
(+`node_modules`), `printpro-web` (standalone), встроенный Postgres
(`initdb/postgres/pg_ctl.exe` в `app.asar.unpacked`), Prisma CLI + `schema.prisma`
+ **49 миграций**, компилируемый seed. Дополнительно `electron/release/win-unpacked/PrintPro.exe`
— **запускаемая портативная версия** (можно запустить/раздать без установщика).

> `electron/release/` в `.gitignore` — сами .exe/установщики в git не коммитятся.

**Блокеры, найденные и закрытые при сборке:**
1. ✅ `embedded-postgres@^17.5.0` не существовал → зафиксирована `17.10.0-beta.17` (в `package.json`).
2. ✅ Жёсткая ссылка на несуществующую иконку убрана (используется дефолтная Electron-иконка).
3. ✅ Путь к бинарникам Postgres (`findPgBinDir`) подтверждён на реальной установке.
4. ✅ **Скачивание бинарников electron-builder с GitHub CDN** (`winCodeSign`,
   `nsis`, `nsis-resources`) с `release-assets.githubusercontent.com` — из
   Таджикистана/за файрволом часто отваливается по таймауту. **Решение —
   зеркало** (см. ниже). С зеркалом установщик собирается полностью.

### ⚠️ Если сборка виснет/падает на скачивании (GitHub CDN недоступен)

electron-builder на первой сборке качает свои бинарники (`winCodeSign-*`,
`nsis-*`, `nsis-resources-*`) с `release-assets.githubusercontent.com` (Fastly,
`185.199.*`). Из Душанбе этот хост нестабилен → таймаут вида
`wsarecv: connection attempt failed`. **Переключите загрузки на зеркало
npmmirror** — один раз перед сборкой:

```powershell
# PowerShell (Windows):
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://registry.npmmirror.com/-/binary/electron-builder-binaries/"
npm run dist
```
```bash
# Git Bash / cmd-эквивалент:
ELECTRON_BUILDER_BINARIES_MIRROR="https://registry.npmmirror.com/-/binary/electron-builder-binaries/" npm run dist
```

Зеркало отдаёт те же самые архивы, но по стабильному каналу. Проверено:
именно так установщик и собрался (нужный `nsis-resources-3.4.1.7z` подтянулся с
зеркала за секунды вместо таймаута с GitHub).

> Ручной обход (если зеркало тоже недоступно): скачать `nsis-resources-3.4.1.7z`
> любым способом и распаковать в
> `%LOCALAPPDATA%\electron-builder\Cache\nsis\nsis-resources-3.4.1\`
> (внутри должна получиться папка `plugins\`). Аналогично для `winCodeSign` —
> распаковать без macOS-симлинков: `7za x <архив> -o<кэш>\winCodeSign-2.6.0 -xr!darwin`
> (симлинки Windows требуют Developer Mode).

**Итого для получения `PrintPro Setup.exe`:** на Windows-ПК →
`npm install` в `electron/`, собрать api и web (`npm run build` в обеих папках),
затем (с зеркалом, если GitHub CDN недоступен) `npm run dist` в `electron/`.
Установщик появится в `electron/release/`.

## Проверено реальным ЗАПУСКОМ (2026-07-08) ✅ — приложение РАБОТАЕТ

Собранный `.exe` реально установили и запустили. Первая установка падала на
старте — при запуске выявлены и исправлены **3 рантайм-бага** (сборка их не
ловит, только фактический запуск). После фиксов при `role=main` полный конвейер
проходит: встроенный Postgres → **48 миграций** → seed (компания DushanbePrint,
роли, `admin`/`admin123`) → NestJS API стартует → Next.js web поднимается.

1. ✅ **`ERR_REQUIRE_ESM` — embedded-postgres.** `embedded-postgres` v17 —
   чистый ESM (`"type":"module"`), его нельзя грузить `require()` из CJS-главного
   процесса → приложение падало на 23-й строке `main.js` сразу при запуске.
   Исправлено: грузим динамическим `import()` внутри `ensureEmbeddedPostgres()`
   (как и `electron-store`). Проверено: `import('embedded-postgres')` работает
   под Electron 33.
2. ✅ **Зависание инициализации БД — `asar` отключён (`"asar": false`).**
   embedded-postgres вычисляет путь к `initdb.exe` через `import.meta.url`. Внутри
   `app.asar` путь получается «виртуальным» (`…/app.asar/…/initdb.exe`): `fs` его
   читает (Electron редиректит на `.unpacked`), но **`child_process.spawn()` НЕ
   редиректит** asar→unpacked, поэтому `initdb.exe` не запускался, а у
   embedded-postgres нет обработчика `'error'` на дочернем процессе → инициализация
   зависала навсегда (пустой спиннер, пустой `pgdata`). При `asar:false` все файлы
   реальные — `spawn` работает. IP это не раскрывает: `printpro-api/dist` и
   `printpro-web` и так лежат распакованными в `extraResources`. Плюс добавлен
   `withTimeout()` вокруг `initialise()`/`start()` — теперь зависание превращается в
   понятную ошибку, а не в вечный спиннер.
3. ✅ **Кодировка БД — строго UTF8 (было WIN1251).** `initdb` по умолчанию берёт
   локаль системы (на русской Windows — `Russian_Russia.1251` → кластер в
   **WIN1251**). Миграция `product_subcategory` содержит в комментарии символ «→»
   (U+2192) — в WIN1251 он не влезает → миграция падала (SqlState `22P05`), а за
   ней и seed (`ProductCategory.parentId` не создан). Исправлено: в конструкторе
   `EmbeddedPostgres` задан `initdbFlags: ['--encoding=UTF8', '--locale=C']`.
   `locale=C` — чтобы кодировка не зависела от локали конкретной машины (сортировка
   становится побайтовой; для типографии некритично). *На будущее:* при желании
   «правильной» кириллической сортировки — перейти на ICU-провайдер (`--locale-provider=icu`).

> ⚠️ **Порты 3000 / 3001 / 5433 должны быть свободны.** Главный ПК поднимает API
> (3000), web (3001) и встроенный Postgres (5433). На чистой машине клиента они
> свободны; конфликт бывает в основном на машине разработчика (например, там
> запущен другой Next.js-проект). ✅ **Теперь коробка это проверяет на старте**
> (`assertPortsFree` в `main.js`): если порт занят — показывает понятную ошибку
> («заняты порты …, закройте программу») вместо тихого полу-запуска. Проверка
> идёт на всех интерфейсах (как реально слушают API `::` и web `0.0.0.0`), иначе
> bind чужой программы на `0.0.0.0:PORT` не ловился. *На будущее (по желанию):*
> авто-подбор портов — но веб-фронт (`config.ts`) и кассы завязаны на 3000/3001,
> поэтому смена портов требует и правок фронта.

## Защита данных: бэкапы ✅ (2026-07-08)

`pg_dump.exe` в комплект `embedded-postgres` **не входит** (только серверные
`initdb`/`pg_ctl`/`postgres`), поэтому реализован **холодный физический бэкап**:
`maybeBackupPgdata()` в `main.js` копирует папку `userData/pgdata` **до старта
Postgres** (кластер ещё не запущен → копия консистентна, без внешних утилит).
Делается не чаще раза в ~20ч, хранятся последние **7 копий** (ротация) в
`userData/backups/pgdata_<дата>`.

- **Восстановление:** закрыть PrintPro → заменить `userData/pgdata` содержимым
  нужной копии `backups/pgdata_*` → запустить снова.
- **Ограничение:** бэкап делается при запуске приложения. Для конторы, которая
  выключает ПК на ночь (обычный случай), это ежедневная копия. Если ПК работает
  сутками без перезапуска — новых копий не будет до перезапуска. *На будущее:*
  доложить `pg_dump.exe` (+DLL) в `extraResources` для «горячего» логического
  дампа без остановки, и/или облачная выгрузка бэкапа.

## Авто-обновление ✅ (GitHub Releases) — как выпускать новую версию

Настроено на **GitHub Releases** (`publish` в `package.json` → `provider: github`,
`owner: tajikistanmax`, `repo: printpro-releases`). Клиент при запуске проверяет
последнюю версию и обновляется сам (`autoUpdater.checkForUpdatesAndNotify()` в
`main.js`). Подпись установщика не требуется — целостность проверяется по sha512
из `latest.yml`.

**Разовая настройка (один раз):**
1. Создать на GitHub **публичный** репозиторий `printpro-releases` под аккаунтом
   `tajikistanmax` (только для файлов релизов; исходный код остаётся в приватном
   `printpro`). Если назовёте иначе — поправьте `repo` в `package.json`.
2. Сделать **Personal Access Token** (classic, scope `repo`) и положить в env
   `GH_TOKEN` (в PowerShell: `$env:GH_TOKEN = "ghp_..."`).

**Каждый выпуск обновления:**
1. Собрать api и web (`npm run build` в `printpro-api` и `printpro-web`).
2. Поднять версию в `electron/package.json` (`0.1.0` → `0.1.1` → …) — **обязательно**,
   иначе клиенты не увидят обновление.
3. В `electron/`: `npm run publish` (при недоступном GitHub CDN — с зеркалом,
   см. раздел выше). Это соберёт установщик и выложит `.exe` + `latest.yml` +
   `.blockmap` в GitHub Release репозитория `printpro-releases`.
4. Клиенты со старой версией при следующем запуске скачают и поставят обновление
   (по умолчанию — при выходе из приложения).

> Установщик, который вы раздаёте на пилоте (v0.1.0), уже содержит `app-update.yml`
> с адресом канала — значит, когда вы выпустите v0.1.1, пилотные клиенты его
> подхватят автоматически.

## Остаётся по желанию (не блокеры)
- ✅ ~~Иконка приложения~~ / ~~порт-конфликты~~ / ~~бэкап данных~~ / ~~авто-обновление~~ — **сделано.**
- Подпись установщика (code signing) — без неё Windows SmartScreen предупреждает
  «неизвестный издатель» при установке (сама программа и авто-обновление работают).
  Нужен сертификат Code Signing (покупается на год) — по желанию, для «гладкой»
  установки у клиентов.
- Ручная проверка сценария «касса»: два ПК в одной сети, разный `role` в `setup.html`.
- Переход на свой сервер обновлений (когда будет домен): заменить `publish` на
  `{ "provider": "generic", "url": "https://updates.<домен>/" }` и выкладывать
  файлы релиза на свой сервер.
