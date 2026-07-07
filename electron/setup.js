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

function updateVisibility() {
  cashHostBlock.style.display = roleCash.checked ? 'block' : 'none';
  updateSaveEnabled();
}

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
