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
      className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-lg shadow-sm transition hover:opacity-80"
      aria-label="Сменить тему"
      title={dark ? 'Светлая тема' : 'Тёмная тема'}
    >
      {dark ? '☀️' : '🌙'}
    </button>
  );
}
