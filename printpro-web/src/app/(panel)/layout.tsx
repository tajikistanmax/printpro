'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import NotificationBell from '@/lib/NotificationBell';
import ThemeToggle from '@/lib/ThemeToggle';
import SyncIndicator from '@/lib/SyncIndicator';
import GlobalSearch from '@/lib/GlobalSearch';
import NavIcon from '@/lib/NavIcons';
import { useFeatureFlags, NAV_FLAG_BY_HREF } from '@/lib/feature-flags';

type NavItem = { href: string; label: string; icon: string; perm: string | null };
type NavGroup = { label: string | null; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ href: '/dashboard', label: 'Главная', icon: 'home', perm: null }],
  },
  {
    label: 'Продажи',
    items: [
      { href: '/orders', label: 'Заказы', icon: 'orders', perm: 'orders.view' },
      { href: '/pos', label: 'Продажа', icon: 'pos', perm: 'cash.operate' },
      { href: '/cash', label: 'Касса', icon: 'cash', perm: 'cash.view' },
      { href: '/quotes', label: 'КП', icon: 'quotes', perm: 'orders.view' },
      { href: '/promocodes', label: 'Промокоды', icon: 'promo', perm: 'orders.view' },
    ],
  },
  {
    label: 'Производство',
    items: [
      { href: '/production', label: 'Производство', icon: 'production', perm: 'production.view' },
      { href: '/design', label: 'Дизайн-макеты', icon: 'design', perm: 'design.view' },
      { href: '/equipment', label: 'Оборудование', icon: 'equipment', perm: 'production.view' },
    ],
  },
  {
    label: 'Склад',
    items: [
      { href: '/warehouse', label: 'Склад', icon: 'warehouse', perm: 'stock.view' },
      { href: '/purchasing', label: 'Закупки', icon: 'purchasing', perm: 'stock.view' },
      { href: '/services', label: 'Услуги', icon: 'services', perm: 'services.view' },
    ],
  },
  {
    label: 'Клиенты',
    items: [
      { href: '/clients', label: 'Клиенты', icon: 'clients', perm: 'clients.view' },
      { href: '/complaints', label: 'Рекламации', icon: 'complaints', perm: 'clients.view' },
      { href: '/tasks', label: 'Задачи', icon: 'tasks', perm: 'tasks.view' },
    ],
  },
  {
    label: 'Аналитика',
    items: [
      { href: '/reports', label: 'Отчёты', icon: 'reports', perm: 'reports.view' },
      { href: '/audit', label: 'Журнал', icon: 'audit', perm: 'audit.view' },
    ],
  },
  {
    label: 'Управление',
    items: [
      { href: '/staff', label: 'Сотрудники', icon: 'staff', perm: 'users.view' },
      { href: '/payroll', label: 'Зарплата', icon: 'payroll', perm: 'payroll.view' },
      { href: '/settings', label: 'Настройки', icon: 'settings', perm: 'settings.manage' },
    ],
  },
];

export default function PanelLayout({ children }: { children: ReactNode }) {
  const { user, loading, logout, can } = useAuth();
  const { isEnabled } = useFeatureFlags();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);

  // Закрывать меню при переходе на другую страницу (мобильный)
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Состояние «узкой рейки» запоминаем между визитами (только десктоп)
  useEffect(() => {
    setRailCollapsed(localStorage.getItem('pp_nav_collapsed') === '1');
  }, []);

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

  function toggleRail() {
    setRailCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('pp_nav_collapsed', next ? '1' : '0');
      return next;
    });
  }

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/');

  // Классы, скрывающие подписи только на десктопе, когда меню свёрнуто в рейку
  const hideOnRail = railCollapsed ? 'lg:hidden' : '';

  return (
    <div className="flex min-h-screen bg-slate-100">
      {/* Затемнение под меню на мобильном */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/45 backdrop-blur-[2px] lg:hidden"
        />
      )}

      {/* Боковое меню (на мобильном — выезжающее) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-slate-200 bg-white shadow-[2px_0_8px_rgba(0,0,0,0.04)] transition-[transform,width] duration-200 lg:static lg:z-auto lg:translate-x-0 ${
          railCollapsed ? 'lg:w-[68px]' : 'lg:w-60'
        } ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Логотип */}
        <div
          className={`flex h-16 items-center gap-2.5 border-b border-slate-100 px-4 ${
            railCollapsed ? 'lg:justify-center lg:px-0' : ''
          }`}
        >
          <svg width="32" height="32" viewBox="0 0 58 58" fill="none" className="shrink-0">
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
          <span
            className={`text-xl font-extrabold italic tracking-tight text-slate-800 ${hideOnRail}`}
          >
            Print<span className="text-violet-500">Pro</span>
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 py-3">
          {NAV_GROUPS.map((group, gi) => {
            const items = group.items.filter((n) => {
              if (n.perm && !can(n.perm)) return false;
              const flag = NAV_FLAG_BY_HREF[n.href];
              if (flag && !isEnabled(flag)) return false;
              return true;
            });
            if (items.length === 0) return null;
            return (
              <div key={group.label ?? `g${gi}`} className="mb-1">
                {group.label && (
                  <div
                    className={`px-2.5 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400 ${hideOnRail}`}
                  >
                    {group.label}
                  </div>
                )}
                {items.map((n) => {
                  const active = isActive(n.href);
                  return (
                    <Link
                      key={n.href}
                      href={n.href}
                      title={railCollapsed ? n.label : undefined}
                      className={`group/navlink mb-0.5 flex items-center gap-3 rounded-lg border-l-[3px] py-2 pl-2.5 pr-3 text-sm transition-colors ${
                        railCollapsed ? 'lg:justify-center lg:px-0' : ''
                      } ${
                        active
                          ? 'border-indigo-500 bg-indigo-50 font-semibold text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300'
                          : 'border-transparent font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                    >
                      <NavIcon name={n.icon} className="h-[18px] w-[18px] shrink-0" />
                      <span className={`truncate ${hideOnRail}`}>{n.label}</span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* Профиль пользователя */}
        <div className="border-t border-slate-100 p-3">
          <div className={`flex items-center gap-2.5 ${railCollapsed ? 'lg:justify-center' : ''}`}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-sm font-bold text-white">
              {(user.fullName ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <div className={`min-w-0 flex-1 ${hideOnRail}`}>
              <div className="truncate text-sm font-semibold text-slate-800">
                {user.fullName}
              </div>
              <div className="truncate text-xs text-slate-400">{user.role}</div>
            </div>
            <button
              onClick={() => {
                logout();
                router.replace('/login');
              }}
              title="Выйти"
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-rose-500 dark:hover:bg-slate-800 ${hideOnRail}`}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Свернуть/развернуть рейку — только десктоп */}
        <button
          onClick={toggleRail}
          className="mx-2.5 mb-2.5 hidden items-center justify-center rounded-lg border border-slate-200 bg-slate-50 py-1.5 text-xs font-semibold text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 lg:flex dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
          title={railCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
        >
          {railCollapsed ? '▶' : '◀ Свернуть'}
        </button>
      </aside>

      {/* Контент */}
      <main className="min-w-0 flex-1 overflow-auto">
        {/* Шапка: поиск слева, действия справа — единой полосой */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur-md sm:px-8 dark:bg-slate-900/80">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-xl text-slate-600 transition hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label="Меню"
            >
              ☰
            </button>
            <GlobalSearch />
          </div>
          <div className="flex items-center gap-1.5">
            <SyncIndicator />
            <ThemeToggle />
            <NotificationBell />
          </div>
        </header>
        <div className="mx-auto max-w-6xl px-4 pb-10 pt-6 sm:px-8">{children}</div>
      </main>
    </div>
  );
}
