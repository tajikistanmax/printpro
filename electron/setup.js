// PrintPro Desktop — логика экрана первого запуска (setup.html).
// Выполняется в изолированном renderer-контексте; с главным процессом
// общается только через window.electronAPI (см. preload.js).

'use strict';

const roleMain = document.getElementById('roleMain');
const roleCash = document.getElementById('roleCash');
const cashHostBlock = document.getElementById('cashHostBlock');
const mainHostInput = document.getElementById('mainHost');
const cloudSyncCheckbox = document.getElementById('cloudSync');
const saveBtn = document.getElementById('saveBtn');
const errorEl = document.getElementById('error');
const lanHint = document.getElementById('lanHint');
const backupCard = document.getElementById('backupCard');
const backupDirVal = document.getElementById('backupDirVal');
const pickBackupBtn = document.getElementById('pickBackupBtn');
const driveHint = document.getElementById('driveHint');
const restoreBtn = document.getElementById('restoreBtn');
const restoreMsg = document.getElementById('restoreMsg');

function updateVisibility() {
  cashHostBlock.style.display = roleCash.checked ? 'block' : 'none';
  // Настройка копий и восстановление нужны только на главном ПК (там база).
  backupCard.style.display = roleMain.checked ? 'block' : 'none';
  updateSaveEnabled();
}

// Показать текущую папку для копий (или «не задана» красным).
function renderBackupDir(dir) {
  if (dir) {
    backupDirVal.textContent = dir;
    backupDirVal.classList.remove('unset');
  } else {
    backupDirVal.textContent = 'не задана';
    backupDirVal.classList.add('unset');
  }
}

// Подтянуть инфо о копиях: текущая папка + подсказка про найденные диски.
function loadBackupInfo() {
  window.electronAPI
    .getBackupInfo()
    .then((info) => {
      if (!info) return;
      renderBackupDir(info.backupDir);
      if (info.drives && info.drives.length) {
        driveHint.style.display = 'block';
        driveHint.textContent =
          'Найдены диски: ' + info.drives.join('  ') + ' — можно выбрать флешку или диск D.';
      } else {
        driveHint.style.display = 'block';
        driveHint.textContent =
          'Второй диск/флешка не найдены. Вставьте флешку и нажмите «Выбрать папку…».';
      }
    })
    .catch(() => {});
}

pickBackupBtn.addEventListener('click', async () => {
  try {
    const chosen = await window.electronAPI.pickBackupDir();
    if (chosen) renderBackupDir(chosen);
  } catch (err) {
    restoreMsg.style.color = '#c0392b';
    restoreMsg.textContent = 'Не удалось выбрать папку: ' + (err && err.message ? err.message : err);
  }
});

restoreBtn.addEventListener('click', async () => {
  restoreMsg.style.color = '#556';
  restoreMsg.textContent = 'Выберите папку с копией…';
  try {
    // При успехе главный процесс сам перезапустит приложение — сообщение ниже
    // покажется только при отмене/ошибке.
    const res = await window.electronAPI.restoreAtSetup();
    if (res && res.canceled) {
      restoreMsg.textContent = '';
    } else if (res && !res.ok) {
      restoreMsg.style.color = '#c0392b';
      restoreMsg.textContent = 'Не удалось восстановить: ' + (res.reason || 'неизвестная ошибка');
    }
  } catch (err) {
    restoreMsg.style.color = '#c0392b';
    restoreMsg.textContent = 'Ошибка восстановления: ' + (err && err.message ? err.message : err);
  }
});

function updateSaveEnabled() {
  const roleChosen = roleMain.checked || roleCash.checked;
  const cashHostOk = roleCash.checked ? mainHostInput.value.trim().length > 0 : true;
  saveBtn.disabled = !(roleChosen && cashHostOk);
}

roleMain.addEventListener('change', updateVisibility);
roleCash.addEventListener('change', updateVisibility);
mainHostInput.addEventListener('input', updateSaveEnabled);

saveBtn.addEventListener('click', async () => {
  errorEl.textContent = '';
  saveBtn.disabled = true;
  saveBtn.textContent = 'Сохраняем…';

  const config = {
    role: roleMain.checked ? 'main' : 'cash',
    mainHost: roleCash.checked ? mainHostInput.value.trim() : '',
    cloudSync: cloudSyncCheckbox.checked,
  };

  try {
    // После успешного сохранения главный процесс сам перезапускает
    // приложение (app.relaunch()) — это окно закроется само.
    await window.electronAPI.saveConfig(config);
  } catch (err) {
    errorEl.textContent = 'Не удалось сохранить настройки: ' + (err && err.message ? err.message : err);
    saveBtn.disabled = false;
    saveBtn.textContent = 'Сохранить и продолжить';
  }
});

// Показываем LAN-адрес этого ПК сразу — полезно продиктовать заранее, даже
// до выбора роли (пригодится и на самом главном ПК, и просто для справки).
window.electronAPI
  .getLanIp()
  .then((ip) => {
    lanHint.textContent = `Адрес этого компьютера в локальной сети: ${ip}`;
  })
  .catch(() => {
    lanHint.textContent = 'Не удалось определить адрес в локальной сети.';
  });

// Если пользователь вернулся на этот экран повторно (например, роль была
// сброшена из-за некорректного mainHost) — подставляем то, что уже было.
window.electronAPI
  .getConfig()
  .then((cfg) => {
    if (!cfg) return;
    if (cfg.role === 'main') roleMain.checked = true;
    if (cfg.role === 'cash') roleCash.checked = true;
    if (cfg.mainHost) mainHostInput.value = cfg.mainHost;
    if (cfg.cloudSync) cloudSyncCheckbox.checked = true;
    updateVisibility();
  })
  .catch(() => {});

// Текущая папка для копий и подсказка про диски (для карточки главного ПК).
loadBackupInfo();
