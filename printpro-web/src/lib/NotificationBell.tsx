'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from './api';
import { DEFAULT_COMPANY_ID } from './config';

const LEVEL_DOT: Record<string, string> = {
  danger: 'bg-rose-500',
  warning: 'bg-amber-500',
  info: 'bg-sky-500',
};

export default function NotificationBell() {
  const [items, setItems] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  function load() {
    api
      .get(`/notifications?companyId=${DEFAULT_COMPANY_ID}`)
      .then(setItems)
      .catch(() => {});
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 60000); // обновлять раз в минуту
    return () => clearInterval(t);
  }, []);

  // Закрытие по клику вне
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        aria-label="Уведомления"
      >
        <span className="text-lg">🔔</span>
        {items.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1 text-xs font-semibold text-white">
            {items.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-2xl bg-white p-2 shadow-xl ring-1 ring-slate-100">
          <div className="px-3 py-2 text-sm font-semibold text-slate-700">
            Уведомления
          </div>
          {items.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-slate-400">
              Всё спокойно 👌
            </p>
          ) : (
            <div className="max-h-80 space-y-0.5 overflow-auto">
              {items.map((n, i) => (
                <Link
                  key={i}
                  href={n.link}
                  onClick={() => setOpen(false)}
                  className="flex items-start gap-2.5 rounded-lg px-3 py-2 text-sm transition hover:bg-slate-50"
                >
                  <span
                    className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${
                      LEVEL_DOT[n.level] ?? 'bg-slate-400'
                    }`}
                  />
                  <span className="text-slate-600">{n.title}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
