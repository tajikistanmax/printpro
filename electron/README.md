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
   - запускает seed (`dist/bootstrap/seed.js` — **пока не существует**, см.
     «Требуемые изменения в хосте», п.1);
   - запускает `printpro-api` (`node dist/main.js`) с нужными `env`;
   - ждёт `GET /api/health` (эндпоинт тоже пока не существует, см. п.4);
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

## Требуемые изменения в хосте (делает оркестратор, НЕ этот агент)

Эти правки — **вне `electron/`**, по условию задачи их не делает этот
скелет, только фиксирует список. Без них коробка не заработает полностью:

1. **Компилируемый seed.** Сейчас есть только
   `printpro-api/prisma/seed.ts`, запускаемый через `ts-node`/`npx prisma
   db seed` (см. `render.yaml`: `npx ts-node prisma/seed.ts`). Нужен
   вариант, компилируемый в `dist/` вместе с остальным API — например,
   `printpro-api/src/bootstrap/seed.ts` → `dist/bootstrap/seed.js`, плюс
   npm-скрипт для явного запуска. `main.js` уже ждёт именно этот путь
   (`runSeed()` в `electron/main.js`) и не падает, если его нет — просто
   предупреждает в логе и не создаёт компанию/админа.
2. **`UPLOADS_DIR` в printpro-api.** Сейчас путь к файлам жёстко
   `./uploads` (относительно `process.cwd()`) в трёх местах:
   `printpro-api/src/main.ts:27,68` (`mkdirSync`/`useStaticAssets`) и
   `printpro-api/src/uploads/image-upload.options.ts:19,61`
   (`IMAGE_UPLOAD_OPTIONS`/`LAYOUT_UPLOAD_OPTIONS`), плюс
   `printpro-api/src/clients/clients.controller.ts:91`. Нужно читать из
   `process.env.UPLOADS_DIR` (по умолчанию `./uploads`, как сейчас) — иначе
   в коробке файлы будут писаться внутрь `resources/printpro-api/uploads`
   (потеряются при переустановке/обновлении) вместо `userData/uploads`.
   `main.js` уже пробрасывает `env.UPLOADS_DIR = paths.uploads` в
   дочерний процесс API — сейчас API его просто игнорирует.
3. **Флаг `ALLOW_LAN_ORIGINS`, отвязанный от `NODE_ENV`.** В
   `printpro-api/src/main.ts` (`isTrustedDevOrigin` + `enableCors`)
   LAN-эвристика (localhost/10.x/192.168.x/172.16-31.x) сейчас работает
   только когда `!isProduction`. Коробка запускает API как production
   (`NODE_ENV=production`, см. `startApiProcess()` в `main.js`) — значит,
   без отдельного флага касса не сможет постучаться на API главного ПК
   (CORS отклонит кросс-origin запрос с `http://<mainHost>:3001` на
   `http://<mainHost>:3000`). `main.js` уже передаёт
   `env.ALLOW_LAN_ORIGINS = '1'` — нужно в `main.ts` добавить проверку
   типа `(!isProduction || process.env.ALLOW_LAN_ORIGINS === '1') &&
   isTrustedDevOrigin(origin)`.
4. **`/api/health`.** Сейчас в API нет ни одного роута `health` (проверено
   `grep -r health src`). У `render.yaml` `healthCheckPath: /api`, но это
   просто корень с global prefix, не полноценный health-check. `main.js`
   (`waitForHttpOk`) уже ждёт `GET http://127.0.0.1:3000/api/health` перед
   тем, как открыть окно веб-панели — без эндпоинта просто сработает
   таймаут (30 сек) и окно откроется всё равно, но без гарантии готовности
   API.
5. **`prisma schema.prisma` → `binaryTargets`.** Сейчас в
   `printpro-api/prisma/schema.prisma` блок `generator client` без
   `binaryTargets` — Prisma сгенерирует движок только под текущую
   ОС/архитектуру разработчика. Для сборки `.exe` под Windows нужно
   `binaryTargets = ["native", "windows"]` (или конкретный таргет сборочной
   машины CI, если сборка идёт не на Windows), иначе на машине клиента
   `@prisma/client` не найдёт нужный query-engine бинарник.
6. **Рантайм-резолв `companyId` вместо хардкода.** `COMPANY_ID` в
   `printpro-api/prisma/seed.ts:11` и `DEFAULT_COMPANY_ID` в
   `printpro-web/src/lib/config.ts:58-60` — один и тот же фиксированный
   UUID (`7628001a-...`), совпадающий с ID компании DushanbePrint в облаке.
   Для одной изолированной коробки это не страшно (у каждого клиента своя
   отдельная встроенная база, ID внутри неё не пересекается ни с кем).
   Но как только заработает облачная синхронизация (Фаза 3, `docs/03-sync.md`)
   и разные коробки разных клиентов начнут пушить данные в общее облако —
   все они попытаются писать в **одну и ту же** запись `Company` с этим ID.
   Нужен рантайм-резолв (companyId, генерируемый при первом seed коробки, а
   не захардкоженный) до включения облачной синхронизации для нескольких
   клиентов.

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
8. **`embedded-postgres` — версия/бинарники под Windows.** В
   `package.json` зафиксирована `^17.5.0` ориентировочно — версию нужно
   сверить с актуальной на npm на момент установки (пакет тянет платформенные
   бинарники Postgres как отдельные `optionalDependencies`, размер
   установщика сильно зависит от того, какие платформы включены). Также
   `backup.js` (`ctx.pgBinDir`) и комментарий `TODO(build)` в `main.js`
   (`ensureEmbeddedPostgres`) отмечают места, где нужно свериться с
   актуальным API пакета (`initialise()`/`start()`/`createDatabase()`) и
   реальным расположением бинарника `pg_dump` при первой сборке.
9. **Канал автообновлений.** `electron-updater` вызывается в `main.js`
   (`autoUpdater.checkForUpdatesAndNotify()`), но `publish` в
   `package.json` → `build` сейчас `null` (заглушка). Владельцу нужно
   решить: свой сайт (генерировать `latest.yml` + `.exe` самостоятельно)
   или GitHub Releases (`provider: "github"` + токен), см.
   [`docs/06-АРХИТЕКТУРА-КОРОБКА-ЭЛЕКТРОН.md`](../docs/06-АРХИТЕКТУРА-КОРОБКА-ЭЛЕКТРОН.md#7-авто-обновление).

## Что осталось до реального `.exe`

- Внести 6(+3) правок из раздела выше в `printpro-api`/`printpro-web`
  (делает ведущий инженер, не этот скелет).
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
