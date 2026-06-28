'use client';

import { useEffect, useState } from 'react';

export function applyTheme(dark: boolean) {
  const el = document.documentElement;
  if (dark) el.classList.add('dark');
  else el.classList.remove('dark');
}

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    applyTheme(next);
    localStorage.setItem('pp_theme', next ? 'dark' : 'light');
  }

  return (
    <button
      onClick={toggle}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-lg text-slate-500 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      aria-label="Сменить тему"
      title={dark ? 'Светлая тема' : 'Тёмная тема'}
    >
      {dark ? '☀️' : '🌙'}
    </button>
  );
}
