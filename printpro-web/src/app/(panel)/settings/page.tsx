'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { POS_LAYOUTS, DEFAULT_POS_LAYOUT } from '@/lib/pos-layouts';

const CURRENCIES = ['TJS', 'USD', 'RUB', 'EUR'];
const LANGUAGES = [
  { k: 'ru', l: 'Русский' },
  { k: 'tg', l: 'Тоҷикӣ' },
  { k: 'en', l: 'English' },
];

export default function SettingsPage() {
  const cid = DEFAULT_COMPANY_ID;
  const [s, setS] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get(`/settings?companyId=${cid}`)
      .then((d) => setS(d ?? {}))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [cid]);

  function set(key: string, value: string) {
    setS((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setMsg('');
    try {
      await api.put('/settings', { companyId: cid, values: s });
      setMsg('✓ Настройки сохранены');
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function downloadBackup() {
    setMsg('Готовлю резервную копию…');
    try {
      const dump = await api.get(`/backup/export?companyId=${cid}`);
      const blob = new Blob([JSON.stringify(dump, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `printpro-backup-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg('✓ Резервная копия скачана');
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function testTelegram() {
    setMsg('Сохраняю и проверяю Telegram…');
    try {
      await api.put('/settings', { companyId: cid, values: s });
      const res = await api.post('/notifications/telegram/test', {
        companyId: cid,
      });
      setMsg(
        res.ok
          ? '✓ Сообщение отправлено в Telegram'
          : 'Не отправлено: проверьте токен бота и chat_id',
      );
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function testEmail() {
    if (!s.smtpUser) {
      setMsg('Сначала укажите логин (email) SMTP');
      return;
    }
    setMsg('Сохраняю и отправляю тестовое письмо…');
    try {
      await api.put('/settings', { companyId: cid, values: s });
      const res = await api.post('/notifications/email/test', {
        companyId: cid,
        to: s.smtpTestTo || s.smtpUser,
      });
      setMsg(
        res.ok
          ? `✓ Тестовое письмо отправлено на ${s.smtpTestTo || s.smtpUser}`
          : 'Не отправлено: ' + (res.message ?? 'проверьте настройки SMTP'),
      );
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  if (loading) return <p className="text-slate-400">Загрузка…</p>;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold text-slate-800">Настройки</h1>

      <div className="space-y-6">
        {/* Общие */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-700">Общие</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Название компании">
              <input
                value={s.companyName ?? ''}
                onChange={(e) => set('companyName', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </Field>
            <Field label="Телефон">
              <input
                value={s.phone ?? ''}
                onChange={(e) => set('phone', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </Field>
            <Field label="Валюта">
              <select
                value={s.currency ?? 'TJS'}
                onChange={(e) => set('currency', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Язык">
              <select
                value={s.language ?? 'ru'}
                onChange={(e) => set('language', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.k} value={l.k}>
                    {l.l}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        {/* Оформление кассы */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-1 font-semibold text-slate-700">Оформление кассы</h2>
          <p className="mb-4 text-xs text-slate-400">
            Выберите внешний вид страницы «Касса — продажа». Изменение применится
            у всех кассиров после сохранения.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {POS_LAYOUTS.map((opt) => {
              const active = (s.posLayout ?? DEFAULT_POS_LAYOUT) === opt.k;
              return (
                <button
                  key={opt.k}
                  type="button"
                  onClick={() => set('posLayout', opt.k)}
                  className={`rounded-xl border-2 p-4 text-left transition ${
                    active
                      ? 'border-indigo-500 bg-indigo-50/50'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-800">{opt.name}</span>
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                        active
                          ? 'border-indigo-500 bg-indigo-500 text-white'
                          : 'border-slate-300'
                      }`}
                    >
                      {active && '✓'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{opt.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Уведомления */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-700">Уведомления</h2>
          <div className="space-y-3">
            <Toggle
              label="Оповещать о низком остатке на складе"
              checked={s.notifyLowStock === 'true'}
              onChange={(v) => set('notifyLowStock', String(v))}
            />
            <Toggle
              label="Оповещать о долгах клиентов"
              checked={s.notifyDebts === 'true'}
              onChange={(v) => set('notifyDebts', String(v))}
            />
            <Toggle
              label="Оповещать о готовности заказа"
              checked={s.notifyOrderReady === 'true'}
              onChange={(v) => set('notifyOrderReady', String(v))}
            />
          </div>
        </div>

        {/* Telegram */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-1 font-semibold text-slate-700">Telegram-уведомления</h2>
          <p className="mb-4 text-xs text-slate-400">
            Создайте бота через @BotFather, вставьте токен и chat_id (свой ID можно
            узнать у @userinfobot). Бот будет писать о готовых заказах и оповещениях.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Токен бота">
              <input
                value={s.telegramBotToken ?? ''}
                onChange={(e) => set('telegramBotToken', e.target.value)}
                placeholder="123456:ABC-..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </Field>
            <Field label="Chat ID">
              <input
                value={s.telegramChatId ?? ''}
                onChange={(e) => set('telegramChatId', e.target.value)}
                placeholder="напр. 123456789"
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </Field>
          </div>
          <button
            onClick={testTelegram}
            className="mt-3 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Сохранить и проверить
          </button>
        </div>

        {/* Email (SMTP) */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-1 font-semibold text-slate-700">Email-уведомления</h2>
          <p className="mb-4 text-xs text-slate-400">
            Gmail: включите 2-этапную аутентификацию и создайте «пароль приложения»
            (myaccount.google.com/apppasswords). Хост <b>smtp.gmail.com</b>, порт{' '}
            <b>587</b>, логин — ваш email, пароль — 16-значный пароль приложения.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="SMTP-хост">
              <input
                value={s.smtpHost ?? ''}
                onChange={(e) => set('smtpHost', e.target.value)}
                placeholder="smtp.gmail.com"
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </Field>
            <Field label="Порт">
              <input
                value={s.smtpPort ?? ''}
                onChange={(e) => set('smtpPort', e.target.value)}
                placeholder="587"
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </Field>
            <Field label="Логин (email)">
              <input
                value={s.smtpUser ?? ''}
                onChange={(e) => set('smtpUser', e.target.value)}
                placeholder="you@gmail.com"
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </Field>
            <Field label="Пароль приложения">
              <input
                value={s.smtpPass ?? ''}
                onChange={(e) => set('smtpPass', e.target.value)}
                type="password"
                placeholder="16 символов"
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </Field>
            <Field label="Отправитель (необяз.)">
              <input
                value={s.smtpFrom ?? ''}
                onChange={(e) => set('smtpFrom', e.target.value)}
                placeholder="PrintPro <you@gmail.com>"
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </Field>
            <Field label="Кому отправить тест">
              <input
                value={s.smtpTestTo ?? ''}
                onChange={(e) => set('smtpTestTo', e.target.value)}
                placeholder="по умолчанию — себе"
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </Field>
          </div>
          <button
            onClick={testEmail}
            className="mt-3 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Сохранить и отправить тест
          </button>
        </div>

        {/* Резервное копирование */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-1 font-semibold text-slate-700">Резервная копия</h2>
          <p className="mb-4 text-xs text-slate-400">
            Скачивает все данные компании (заказы, клиенты, склад, финансы и т.д.)
            одним JSON-файлом. Храните копию в надёжном месте. База в облаке
            дополнительно резервируется на стороне Render.
          </p>
          <button
            onClick={downloadBackup}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            ⬇ Скачать резервную копию (JSON)
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            className="rounded-lg bg-indigo-600 px-6 py-2.5 font-medium text-white hover:bg-indigo-700"
          >
            Сохранить
          </button>
          {msg && <span className="text-sm text-slate-600">{msg}</span>}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between">
      <span className="text-sm text-slate-600">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition ${
          checked ? 'bg-indigo-600' : 'bg-slate-300'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
    </label>
  );
}
