'use client';

import { ReactNode, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

const NAV = [
  { href: '/dashboard', label: 'Главная', icon: '🏠', perm: null },
  { href: '/orders', label: 'Касса и заказы', icon: '🛒', perm: 'orders.view' },
  { href: '/warehouse', label: 'Склад', icon: '📦', perm: 'stock.view' },
  { href: '/services', label: 'Услуги', icon: '🎨', perm: 'services.view' },
  { href: '/tasks', label: 'Задачи', icon: '📋', perm: 'tasks.view' },
  { href: '/staff', label: 'Сотрудники', icon: '👥', perm: 'users.view' },
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
    <div className="flex min-h-screen">
      {/* Боковое меню */}
      <aside className="flex w-60 flex-col bg-slate-900 text-slate-200">
        <div className="px-6 py-5 text-2xl font-bold text-white">PrintPro</div>
        <nav className="flex-1 space-y-1 px-3">
          {items.map((n) => {
            const active = pathname === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                  active
                    ? 'bg-indigo-600 text-white'
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
          <div className="text-sm font-medium text-white">{user.fullName}</div>
          <div className="text-xs text-slate-400">{user.role}</div>
          <button
            onClick={() => {
              logout();
              router.replace('/login');
            }}
            className="mt-3 w-full rounded-lg bg-slate-800 py-2 text-sm text-slate-300 hover:bg-slate-700"
          >
            Выйти
          </button>
        </div>
      </aside>

      {/* Контент */}
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl p-8">{children}</div>
      </main>
    </div>
  );
}
