; ─────────────────────────────────────────────────────────────────────────────
; PrintPro — доп. шаги установщика (Уровень 2: сервер как служба Windows).
; electron-builder автоматически подключает build/installer.nsh и вызывает
; макросы customInstall / customUnInstall.
;
; Что делает при установке ГЛАВНОГО ПК:
;   1) создаёт общую папку данных C:\ProgramData\PrintPro и выдаёт права записи
;      обычным пользователям (служба работает от SYSTEM, окно — от пользователя);
;   2) ОДИН РАЗ переносит старую базу из профиля пользователя (до Уровня 2) —
;      ДО первого запуска службы, чтобы служба не создала пустую базу поверх;
;   3) ставит и запускает службу «PrintPro Server» (WinSW).
; На КАССЕ служба не ставится (программа подключается к главному ПК по сети).
; ─────────────────────────────────────────────────────────────────────────────

!macro customInstall
  ; --- Общая папка данных + права на запись группе «Пользователи» ---
  ; $9 = C:\ProgramData (из окружения; запасной вариант — жёстко C:).
  ReadEnvStr $9 ProgramData
  StrCmp $9 "" 0 +2
    StrCpy $9 "C:\ProgramData"
  CreateDirectory "$9\PrintPro"
  ; *S-1-5-32-545 — встроенная группа «Пользователи», не зависит от языка Windows.
  nsExec::Exec 'icacls "$9\PrintPro" /grant *S-1-5-32-545:(OI)(CI)M /T'
  Pop $0

  ; Тихая установка (авто-обновление electron-updater идёт с /S) — не спрашиваем
  ; роль, а решаем по маркеру: был ли этот ПК главным при первой установке.
  IfSilent PP_silent PP_interactive

  PP_interactive:
    MessageBox MB_YESNO|MB_ICONQUESTION "Этот компьютер будет ГЛАВНЫМ — на нём хранится база, к нему подключаются кассы?$\n$\nДа  — установить службу сервера PrintPro (работает в фоне, автозапуск).$\nНет — это КАССА (программа будет подключаться к главному ПК)." /SD IDYES IDYES PP_main IDNO PP_done

  PP_main:
    ; --- Одноразовый перенос старой базы (только если новой ещё нет) ---
    IfFileExists "$9\PrintPro\pgdata\PG_VERSION" PP_marker 0
    SetShellVarContext current
    IfFileExists "$APPDATA\PrintPro\pgdata\PG_VERSION" 0 PP_migAlt
      DetailPrint "Перенос базы из $APPDATA\PrintPro ..."
      CopyFiles /SILENT "$APPDATA\PrintPro\pgdata" "$9\PrintPro"
      CopyFiles /SILENT "$APPDATA\PrintPro\uploads" "$9\PrintPro"
      CopyFiles /SILENT "$APPDATA\PrintPro\config.json" "$9\PrintPro"
      Goto PP_migDone
    PP_migAlt:
      IfFileExists "$APPDATA\printpro-desktop\pgdata\PG_VERSION" 0 PP_migDone
        DetailPrint "Перенос базы из $APPDATA\printpro-desktop ..."
        CopyFiles /SILENT "$APPDATA\printpro-desktop\pgdata" "$9\PrintPro"
        CopyFiles /SILENT "$APPDATA\printpro-desktop\uploads" "$9\PrintPro"
        CopyFiles /SILENT "$APPDATA\printpro-desktop\config.json" "$9\PrintPro"
    PP_migDone:
    SetShellVarContext all

    PP_marker:
    ; Маркер «этот ПК — главный», чтобы тихие обновления сами переставляли службу.
    FileOpen $0 "$9\PrintPro\.role-main" w
    FileWrite $0 "main"
    FileClose $0
    Goto PP_installsvc

  PP_silent:
    ; Тихое обновление: ставим службу только если ПК был отмечен как главный.
    IfFileExists "$9\PrintPro\.role-main" PP_installsvc PP_done

  PP_installsvc:
    IfFileExists "$INSTDIR\resources\service\PrintProService.exe" 0 PP_nosvc
      DetailPrint "Установка и запуск службы PrintPro Server ..."
      nsExec::ExecToLog '"$INSTDIR\resources\service\PrintProService.exe" install'
      Pop $0
      nsExec::ExecToLog '"$INSTDIR\resources\service\PrintProService.exe" start'
      Pop $0
      Goto PP_done
    PP_nosvc:
      IfSilent PP_done 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "Файл службы не найден (resources\service\PrintProService.exe).$\nПрограмма будет работать, но сервер станет поднимать само окно (без фоновой службы).$\nСм. electron/service/README.md — как добавить WinSW." /SD IDOK

  PP_done:
!macroend

!macro customUnInstall
  ; Останавливаем и удаляем службу (если ставилась). Выполняется и при обычном
  ; удалении, и при обновлении (старый деинсталлятор снимает службу, чтобы
  ; разблокировать файлы перед копированием новой версии).
  IfFileExists "$INSTDIR\resources\service\PrintProService.exe" 0 PPU_done
    nsExec::ExecToLog '"$INSTDIR\resources\service\PrintProService.exe" stop'
    Pop $0
    nsExec::ExecToLog '"$INSTDIR\resources\service\PrintProService.exe" uninstall'
    Pop $0
  PPU_done:
  ; ВАЖНО: папку C:\ProgramData\PrintPro НЕ трогаем — там база, загрузки и
  ; настройки клиента. Их удаление — только вручную и осознанно.
!macroend
