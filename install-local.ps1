# PrintPro — установка локального узла (сервер на компьютере точки).
# Поднимает PostgreSQL + API + панель + синхронизатор в Docker одной командой.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Section($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }

Write-Host "PrintPro — установка локального узла" -ForegroundColor Green

# 1) Проверка Docker
Section "Проверка Docker"
try {
  docker version *> $null
  if ($LASTEXITCODE -ne 0) { throw }
  Write-Host "Docker найден и запущен." -ForegroundColor Green
} catch {
  Write-Host "Docker не найден или не запущен." -ForegroundColor Red
  Write-Host "Установите Docker Desktop: https://www.docker.com/products/docker-desktop/"
  Write-Host "Запустите его (значок кита в трее) и повторите установку."
  Read-Host "Enter для выхода"; exit 1
}

# 2) Настройки (.env.local)
Section "Настройки точки"
$envFile = Join-Path $root '.env.local'
$existing = @{}
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') { $existing[$matches[1].Trim()] = $matches[2].Trim() }
  }
  Write-Host "Найден .env.local — значения подставлены, Enter оставляет текущее."
}

function Ask($name, $prompt, $default) {
  $cur = if ($existing.ContainsKey($name)) { $existing[$name] } else { $default }
  $hint = if ($cur) { " [$cur]" } else { "" }
  $v = Read-Host "$prompt$hint"
  if ([string]::IsNullOrWhiteSpace($v)) { $cur } else { $v.Trim() }
}

function RandHex($bytes) {
  $b = New-Object 'System.Byte[]' $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  -join ($b | ForEach-Object { $_.ToString('x2') })
}

$CLOUD_API   = Ask 'CLOUD_API'   'Адрес облачного API' 'https://printpro-api.onrender.com/api'
$SYNC_SECRET = Ask 'SYNC_SECRET' 'Секрет синхронизации (из Render → printpro-api → Environment)' ''
$NODE_ID     = Ask 'NODE_ID'     'Код этой точки (K1, K2, MAGAZIN1...)' 'K1'
$INTERVAL    = Ask 'SYNC_INTERVAL' 'Период синхронизации, сек' '20'

if ([string]::IsNullOrWhiteSpace($SYNC_SECRET)) {
  Write-Host "SYNC_SECRET обязателен — без него синхронизация не работает." -ForegroundColor Red
  Read-Host "Enter для выхода"; exit 1
}

# Пароль БД и JWT — генерируем один раз и сохраняем
$DB_PASSWORD = if ($existing.ContainsKey('DB_PASSWORD')) { $existing['DB_PASSWORD'] } else { RandHex 16 }
$JWT_SECRET  = if ($existing.ContainsKey('JWT_SECRET'))  { $existing['JWT_SECRET'] }  else { RandHex 32 }
$SYNC_NODE_SECRET = if ($existing.ContainsKey('SYNC_NODE_SECRET')) { $existing['SYNC_NODE_SECRET'] } else { RandHex 32 }

@(
  "# Сгенерировано установщиком PrintPro. Секреты — не публиковать.",
  "CLOUD_API=$CLOUD_API",
  "SYNC_SECRET=$SYNC_SECRET",
  "SYNC_NODE_SECRET=$SYNC_NODE_SECRET",
  "NODE_ID=$($NODE_ID.ToUpper())",
  "SYNC_INTERVAL=$INTERVAL",
  "DB_PASSWORD=$DB_PASSWORD",
  "JWT_SECRET=$JWT_SECRET"
) | Set-Content -Path $envFile -Encoding UTF8
Write-Host "Настройки сохранены в .env.local" -ForegroundColor Green

# 3) Сборка и запуск
Section "Сборка и запуск (первый раз 5-10 минут)"
docker compose -f docker-compose.local.yml --env-file .env.local up -d --build
if ($LASTEXITCODE -ne 0) {
  Write-Host "Не удалось запустить контейнеры. Проверьте, что Docker Desktop работает." -ForegroundColor Red
  Read-Host "Enter для выхода"; exit 1
}

# 4) Ожидание готовности API
Section "Проверка готовности"
$ok = $false
$companyId = ''
foreach ($i in 1..40) {
  try {
    $r = Invoke-WebRequest -Uri 'http://localhost:3000/api/health/ready' -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch { Start-Sleep -Seconds 3 }
}
if ($ok) {
  Write-Host "API готов." -ForegroundColor Green
  try {
    $companyInfo = Invoke-RestMethod -Uri 'http://localhost:3000/api/system/company-id' -TimeoutSec 5
    $companyId = [string]$companyInfo.companyId
  } catch {
    Write-Host "Не удалось автоматически определить companyId этого узла." -ForegroundColor Yellow
  }
} else {
  Write-Host "API ещё запускается. Через минуту откройте http://localhost:3001 вручную." -ForegroundColor Yellow
}

Section "Готово"
Write-Host "Панель:  http://localhost:3001" -ForegroundColor Green
Write-Host "API:     http://localhost:3000/api"
Write-Host "Узел:    $($NODE_ID.ToUpper())  ·  синхронизация каждые $INTERVAL сек"
Write-Host "HMAC:    добавьте в облаке SYNC_NODE_SECRETS=$($NODE_ID.ToUpper()):$SYNC_NODE_SECRET" -ForegroundColor Yellow
if (-not [string]::IsNullOrWhiteSpace($companyId)) {
  Write-Host "TENANT:  добавьте в облаке SYNC_NODE_COMPANIES=$($NODE_ID.ToUpper()):$companyId" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Полезные команды:"
Write-Host "  Логи синхронизации:  docker compose -f docker-compose.local.yml logs -f sync"
Write-Host "  Остановить:          docker compose -f docker-compose.local.yml down"
Write-Host "  Запустить снова:     docker compose -f docker-compose.local.yml --env-file .env.local up -d"
Start-Process 'http://localhost:3001'
Read-Host "Enter для выхода"
