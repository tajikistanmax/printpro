'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

export default function SyncIndicator() {
  const [state, setState] = useState<
    'loading' | 'offline' | 'online' | 'synced' | 'stale'
  >('loading');
  const [time, setTime] = useState<string>('');

  async function check() {
    try {
      const r = await api.get<{ lastSyncAt: string | null }>('/sync/status');
      if (!r.lastSyncAt) {
        setState('online');
        setTime('');
        return;
      }
      const last = new Date(r.lastSyncAt);
      const ageMin = (Date.now() - last.getTime()) / 60000;
      setTime(
        last.toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      );
      setState(ageMin < 10 ? 'synced' : 'stale');
    } catch {
      setState('offline');
    }
  }

  useEffect(() => {
    const first = setTimeout(check, 0);
    const t = setInterval(check, 30000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  const cfg = {
    loading: { dot: 'bg-slate-300', text: '…', cls: 'text-slate-400' },
    offline: { dot: 'bg-rose-500', text: 'Нет связи', cls: 'text-rose-600' },
    online: { dot: 'bg-emerald-500', text: 'Онлайн', cls: 'text-slate-600' },
    synced: {
      dot: 'bg-emerald-500',
      text: `Синхр. ${time}`,
      cls: 'text-slate-600',
    },
    stale: {
      dot: 'bg-amber-500',
      text: `Синхр. ${time}`,
      cls: 'text-amber-600',
    },
  }[state];

  return (
    <div
      className="hidden items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-sm sm:flex dark:bg-slate-800"
      title="Состояние синхронизации с облаком"
    >
      <span className={`h-2.5 w-2.5 rounded-full ${cfg.dot}`} />
      <span className={cfg.cls}>{cfg.text}</span>
    </div>
  );
}
