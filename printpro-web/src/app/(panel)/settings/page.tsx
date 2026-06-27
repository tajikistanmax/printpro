'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';

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
