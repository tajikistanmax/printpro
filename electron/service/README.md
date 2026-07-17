# PrintPro — служба Windows (Уровень 2)

Эта папка целиком копируется в установленную программу как `resources\service\`
(см. `extraResources` в `electron/package.json`). Именно отсюда установщик (NSIS)
ставит и запускает службу сервера.

## Что должно лежать в папке

| Файл | Откуда берётся |
|---|---|
| `PrintProService.xml` | В репозитории (эта папка). Конфиг службы. |
| `PrintProService.exe` | **НУЖНО ПОЛОЖИТЬ ВРУЧНУЮ ОДИН РАЗ** — это WinSW (см. ниже). В git не коммитим (бинарник). |

## Что такое WinSW и зачем

Windows не умеет запускать произвольный `.exe` как службу напрямую — программа
должна «уметь» отвечать диспетчеру служб. **WinSW** — маленькая (~0.5 МБ)
общепринятая обёртка (MIT-лицензия), которая делает службу из любого процесса по
XML-конфигу рядом. Мы запускаем ей `PrintPro.exe` в режиме Node с `server-host.js`.

## Как положить WinSW (один раз, разработчику/владельцу)

1. Скачать релиз WinSW **v2.x** (для .NET Framework 4.x, который есть на всех
   Windows 10/11) — файл `WinSW-x64.exe`:
   https://github.com/winsw/winsw/releases  → раздел Assets, `WinSW-x64.exe`.
   (Если качается через файрвол в Таджикистане нестабильно — как и с
   electron-builder, помогает VPN/зеркало.)
2. Переименовать его в **`PrintProService.exe`** и положить рядом с
   `PrintProService.xml` (в эту папку `electron/service/`).
3. Всё. При `npm run dist` он попадёт в установщик, а установщик сам поставит и
   запустит службу (если при установке выбрать «этот компьютер — главный»).

> Имя файла .exe и .xml ДОЛЖНО совпадать (`PrintProService`) — так WinSW находит
> свой конфиг.

## Проверка вручную (по желанию, из cmd от администратора)

```cmd
cd "C:\Program Files\PrintPro\resources\service"
PrintProService.exe install     &: зарегистрировать службу
PrintProService.exe start       &: запустить
net stop PrintProServer          &: остановить
PrintProService.exe uninstall   &: удалить службу
```

Службу также видно в «Службы» Windows под именем **PrintPro Server**.
