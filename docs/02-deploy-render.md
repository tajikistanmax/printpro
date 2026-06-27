# Публикация PrintPro в интернете через Render.com

> Бисмиллах. Пошаговая инструкция. Делается один раз.

PrintPro состоит из 3 частей, Render развернёт их по файлу `render.yaml`:
1. **База данных** PostgreSQL (бесплатно)
2. **Бэкенд** printpro-api (NestJS)
3. **Фронтенд** printpro-web (Next.js — панель + сайт)

---

## Шаг 1. Создать репозиторий на GitHub

1. Зайди на https://github.com → войди/зарегистрируйся.
2. Нажми **New repository** (зелёная кнопка).
3. Имя: `printpro` → **Private** (приватный) → **Create repository**.
4. НЕ добавляй README/gitignore (у нас уже всё есть).

После создания GitHub покажет адрес вида:
`https://github.com/ТВОЙ_ЛОГИН/printpro.git`

---

## Шаг 2. Загрузить код на GitHub

Открой PowerShell в папке проекта и выполни (подставь свой адрес):

```powershell
cd C:\Users\Lenovo\TypografiaPlatform
git remote add origin https://github.com/ТВОЙ_ЛОГИН/printpro.git
git push -u origin main
```

При запросе логина/пароля: вместо пароля нужен **Personal Access Token**
(GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
→ Generate new token → поставь галочку `repo` → скопируй и вставь как пароль).

---

## Шаг 3. Развернуть на Render

1. Зайди на https://render.com → **Sign up** через GitHub (удобнее всего).
2. На дашборде нажми **New +** → **Blueprint**.
3. Выбери свой репозиторий `printpro` → Render найдёт `render.yaml`.
4. Render покажет, что создаст: **базу + printpro-api + printpro-web**.
5. Он попросит заполнить 2 переменные у фронтенда (пока оставь как есть или впиши предполагаемый адрес — поправим в Шаге 5):
   - `NEXT_PUBLIC_API_BASE`
   - `NEXT_PUBLIC_SERVER_ORIGIN`
6. Нажми **Apply** — начнётся развёртывание (5–10 минут).

---

## Шаг 4. Узнать адрес бэкенда

1. Когда **printpro-api** задеплоится, открой его в Render.
2. Сверху будет адрес вида: `https://printpro-api.onrender.com`
3. Проверь: открой `https://printpro-api.onrender.com/api` — должен ответить сервер.

---

## Шаг 5. Прописать адрес бэкенда фронтенду

1. Открой сервис **printpro-web** → вкладка **Environment**.
2. Укажи (подставь реальный адрес из Шага 4):
   - `NEXT_PUBLIC_API_BASE` = `https://printpro-api.onrender.com/api`
   - `NEXT_PUBLIC_SERVER_ORIGIN` = `https://printpro-api.onrender.com`
3. Сохрани → нажми **Manual Deploy → Clear build cache & deploy**
   (важно: эти переменные «впекаются» при сборке, поэтому нужен пересбор).

---

## Шаг 6. Готово! Проверка

- **Панель сотрудников:** `https://printpro-web.onrender.com`
  Вход: `admin` / `admin123`
- **Сайт для клиентов:** `https://printpro-web.onrender.com/order`

---

## Важно знать про бесплатный тариф

- ⏰ **«Засыпание»:** бесплатные сервисы засыпают после 15 минут простоя.
  Первый запрос после сна — медленный (~30–60 сек), дальше быстро. Это нормально для теста.
- 🗄️ **Бесплатная база** имеет ограничения по сроку и объёму — для теста подходит,
  для реальной работы потом возьмём платную (от ~$7/мес) или другой VPS.
- 📎 **Загруженные файлы** на бесплатном тарифе хранятся временно (теряются при перезапуске).
  Для постоянного хранения позже подключим S3/облако хранилище.

---

## Обновление кода в будущем

Изменил код локально → выполни:
```powershell
cd C:\Users\Lenovo\TypografiaPlatform
git add -A
git commit -m "описание изменений"
git push
```
Render сам пересоберёт и обновит сервисы.
