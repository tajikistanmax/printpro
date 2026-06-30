'use client';

import { useState } from 'react';
import { api, fileUrl } from '@/lib/api';

// Загрузка одного изображения (фото товара/услуги, QR оплаты и т.п.).
// Файл уходит на /uploads/image, в onChange прилетает путь /uploads/<имя>.
export default function ImageUpload({
  value,
  onChange,
  label = 'Фото',
  size = 'h-16 w-16',
}: {
  value?: string;
  onChange: (url: string) => void;
  label?: string;
  size?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function onFile(f: File) {
    setErr('');
    setBusy(true);
    try {
      const r = await api.upload<{ url: string }>('/uploads/image', f);
      onChange(r.url);
    } catch (e: any) {
      setErr(e?.message ?? 'Ошибка загрузки');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {label && (
        <div className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      )}
      <div className="flex items-center gap-3">
        <div
          className={`flex ${size} shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800`}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl(value)} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs text-slate-300">нет</span>
          )}
        </div>
        <div className="flex flex-col items-start gap-1">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800">
            {busy ? 'Загрузка…' : value ? 'Заменить фото' : 'Загрузить фото'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={busy}
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
          </label>
          {value && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="text-xs text-rose-500 hover:text-rose-600"
            >
              Убрать
            </button>
          )}
        </div>
      </div>
      {err && <p className="mt-1 text-xs text-rose-500">{err}</p>}
    </div>
  );
}
