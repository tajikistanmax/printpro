'use client';

import { ReactNode, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import NotificationBell from '@/lib/NotificationBell';
import ThemeToggle from '@/lib/ThemeToggle';

const NAV = [
  { href: '/dashboard', label: 'Главная', icon: '🏠', perm: null },
  { href: '/orders', label: 'Заказы', icon: '🛒', perm: 'orders.view' },
  { href: '/pos', label: 'Продажа', icon: '🧾', perm: 'cash.operate' },
  { href: '/cash', label: 'Касса', icon: '💰', perm: 'cash.view' },
  { href: '/production', label: 'Производство', icon: '🏭', perm: 'production.view' },
  { href: '/design', label: 'Дизайн-макеты', icon: '🎨', perm: 'design.view' },
  { href: '/warehouse', label: 'Склад', icon: '📦', perm: 'stock.view' },
  { href: '/purchasing', label: 'Закупки', icon: '🚚', perm: 'stock.view' },
  { href: '/services', label: 'Услуги', icon: '🛠️', perm: 'services.view' },
  { href: '/clients', label: 'Клиенты', icon: '🧑', perm: 'clients.view' },
  { href: '/tasks', label: 'Задачи', icon: '📋', perm: 'tasks.view' },
  { href: '/reports', label: 'Отчёты', icon: '📊', perm: 'reports.view' },
  { href: '/staff', label: 'Сотрудники', icon: '👥', perm: 'users.view' },
  { href: '/payroll', label: 'Зарплата', icon: '💵', perm: 'payroll.view' },
  { href: '/settings', label: 'Настройки', icon: '⚙️', perm: 'settings.manage' },
  { href: '/audit', label: 'Журнал', icon: '📜', perm: 'audit.view' },
];

export default function PanelLayout({ children }: { children: ReactNode }) {
  const { user, loading, logout, can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        Загрузка…
      </div>
    );
  }

  const items = NAV.filter((n) => !n.perm || can(n.perm));

  return (
    <div className="flex min-h-screen bg-slate-100">
      {/* Боковое меню */}
      <aside className="flex w-60 flex-col bg-slate-900 text-slate-200">
        {/* Логотип */}
        <div className="flex items-center gap-2.5 px-5 py-5">
          <svg width="32" height="32" viewBox="0 0 58 58" fill="none">
            <defs>
              <linearGradient id="navlogo" x1="6" y1="2" x2="50" y2="46">
                <stop stopColor="#3B82F6" />
                <stop offset="0.5" stopColor="#9333EA" />
                <stop offset="1" stopColor="#EC4899" />
              </linearGradient>
            </defs>
            <path
              d="M8 3h19a14 14 0 0 1 0 28H18v9H8V3Zm10 8v12h9a6 6 0 0 0 0-12h-9Z"
              fill="url(#navlogo)"
            />
            <path d="M20 13.5l7 4-7 4v-8Z" fill="#22D3EE" />
          </svg>
          <span className="text-xl font-extrabold italic tracking-tight text-white">
            Print<span className="text-violet-400">Pro</span>
          </span>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {items.map((n) => {
            const active = pathname === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                  active
                    ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-900/40'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span className="text-lg">{n.icon}</span>
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 p-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-sm font-bold text-white">
              {(user.fullName ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-white">
                {user.fullName}
              </div>
              <div className="truncate text-xs text-slate-400">{user.role}</div>
            </div>
          </div>
          <button
            onClick={() => {
              logout();
              router.replace('/login');
            }}
            className="mt-3 w-full rounded-lg bg-slate-800 py-2 text-sm text-slate-300 transition hover:bg-slate-700"
          >
            Выйти
          </button>
        </div>
      </aside>

      {/* Контент */}
      <main className="flex-1 overflow-auto">
        {/* Верхняя панель: тема + уведомления */}
        <div className="flex justify-end gap-2 px-8 pt-5">
          <ThemeToggle />
          <NotificationBell />
        </div>
        <div className="mx-auto max-w-6xl px-8 pb-8 pt-2">{children}</div>
      </main>
    </div>
  );
}
