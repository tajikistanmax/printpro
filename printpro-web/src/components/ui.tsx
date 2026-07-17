'use client';

import { cloneElement, isValidElement, ReactNode, useId } from 'react';
import NavIcon from '@/lib/NavIcons';

/**
 * Единый набор оформления в чистом стиле MarketPro, но в фирменных
 * индиго-цветах PrintPro и с поддержкой тёмной темы.
 *
 * Базовые блоки страницы:
 *   <PageHeader icon="warehouse" title="Склад" subtitle="…" actions={…} />
 *   <StatGrid cols={4}><StatCard …/>…</StatGrid>
 *   <Tabs tabs={[…]} active={…} onChange={…} />
 *   <TableCard><Toolbar>…</Toolbar><table className="pp-table">…</table></TableCard>
 */

/* ------------------------------------------------------------------ */
/*  Тона (цветовые акценты)                                            */
/* ------------------------------------------------------------------ */

export type Tone =
  | 'indigo'
  | 'emerald'
  | 'amber'
  | 'rose'
  | 'sky'
  | 'violet'
  | 'slate';

/** Подложка + цвет для иконных «плиток» и бейджей. */
const TONE_SOFT: Record<Tone, string> = {
  indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  rose: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
  sky: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300',
};

/** Цвет крупного числа в карточках статистики. */
const TONE_TEXT: Record<Tone, string> = {
  indigo: 'text-indigo-600 dark:text-indigo-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400',
  rose: 'text-rose-600 dark:text-rose-400',
  sky: 'text-sky-600 dark:text-sky-400',
  violet: 'text-violet-600 dark:text-violet-400',
  slate: 'text-slate-800 dark:text-slate-100',
};

/* ------------------------------------------------------------------ */
/*  Заголовок страницы                                                 */
/* ------------------------------------------------------------------ */

export function PageHeader({
  title,
  subtitle,
  icon,
  iconTone = 'indigo',
  actions,
  className = '',
}: {
  title: string;
  subtitle?: ReactNode;
  /** имя иконки из NavIcons (home, warehouse, reports …) или свой узел */
  icon?: string | ReactNode;
  iconTone?: Tone;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mb-6 flex flex-wrap items-center justify-between gap-3 ${className}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${TONE_SOFT[iconTone]}`}
          >
            {typeof icon === 'string' ? (
              <NavIcon name={icon} className="h-[22px] w-[22px]" />
            ) : (
              icon
            )}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-slate-800 dark:text-slate-100">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Карточки                                                           */
/* ------------------------------------------------------------------ */

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm dark:border-slate-700/60 ${className}`}
    >
      {children}
    </div>
  );
}

/** Карточка-обёртка под таблицу: без внутренних отступов. */
export function TableCard({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`pp-table-card rounded-2xl border border-slate-200/70 bg-white shadow-sm dark:border-slate-700/60 ${className}`}
    >
      {children}
    </div>
  );
}

/** Заголовок секции внутри карточки. */
export function SectionTitle({
  children,
  right,
  className = '',
}: {
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-3 flex items-center justify-between gap-3 ${className}`}>
      <h2 className="font-semibold text-slate-700 dark:text-slate-200">
        {children}
      </h2>
      {right}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Статистика (плитки с цифрами)                                      */
/* ------------------------------------------------------------------ */

export function StatGrid({
  cols = 4,
  children,
  className = '',
}: {
  cols?: 2 | 3 | 4;
  children: ReactNode;
  className?: string;
}) {
  const map = {
    2: 'grid-cols-2',
    3: 'grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-2 lg:grid-cols-4',
  } as const;
  return (
    <div className={`mb-5 grid gap-3 ${map[cols]} ${className}`}>{children}</div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = 'indigo',
  highlight = false,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: string | ReactNode;
  tone?: Tone;
  /** Залить карточку фирменным градиентом (для главной цифры). */
  highlight?: boolean;
}) {
  if (highlight) {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 p-4 text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
        {icon && (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20">
            {typeof icon === 'string' ? (
              <NavIcon name={icon} className="h-5 w-5" />
            ) : (
              icon
            )}
          </span>
        )}
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-white/80">
            {label}
          </div>
          <div className="truncate text-2xl font-bold leading-tight">{value}</div>
          {sub && <div className="mt-0.5 text-xs text-white/80">{sub}</div>}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700/60">
      {icon && (
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONE_SOFT[tone]}`}
        >
          {typeof icon === 'string' ? (
            <NavIcon name={icon} className="h-5 w-5" />
          ) : (
            icon
          )}
        </span>
      )}
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          {label}
        </div>
        <div className={`truncate text-2xl font-bold leading-tight ${TONE_TEXT[tone]}`}>
          {value}
        </div>
        {sub && (
          <div className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

/** Совместимость: старый компактный Stat (плитка на сером фоне). */
export function Stat({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: ReactNode;
  tone?: 'slate' | 'indigo' | 'emerald' | 'rose' | 'amber';
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold ${TONE_TEXT[tone as Tone]}`}>
        {value}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Вкладки                                                            */
/* ------------------------------------------------------------------ */

export type TabItem = { key: string; label: string; count?: number };

export function Tabs({
  tabs,
  active,
  onChange,
  className = '',
  ariaLabel = 'Разделы',
}: {
  tabs: TabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`mb-4 flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-200/70 bg-white p-1 shadow-sm dark:border-slate-700/60 ${className}`}
    >
      {tabs.map((t, index) => {
        const on = t.key === active;
        return (
          <button
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            key={t.key}
            onClick={() => onChange(t.key)}
            onKeyDown={(event) => {
              let nextIndex: number | null = null;
              if (event.key === 'ArrowLeft') {
                nextIndex = (index - 1 + tabs.length) % tabs.length;
              } else if (event.key === 'ArrowRight') {
                nextIndex = (index + 1) % tabs.length;
              } else if (event.key === 'Home') {
                nextIndex = 0;
              } else if (event.key === 'End') {
                nextIndex = tabs.length - 1;
              }
              if (nextIndex === null) return;
              event.preventDefault();
              onChange(tabs[nextIndex].key);
              const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                '[role="tab"]',
              );
              buttons?.[nextIndex]?.focus();
            }}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition ${
              on
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            {t.label}
            {typeof t.count === 'number' && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                  on
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Сегментированный переключатель (период: Сегодня / Неделя / Месяц). */
export function Segmented({
  options,
  active,
  onChange,
  className = '',
}: {
  options: { key: string; label: string }[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Переключатель"
      className={`flex gap-1 rounded-lg border border-slate-200/70 bg-white p-1 shadow-sm dark:border-slate-700/60 ${className}`}
    >
      {options.map((o) => (
        <button
          type="button"
          aria-pressed={active === o.key}
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
            active === o.key
              ? 'bg-indigo-600 text-white'
              : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Панель инструментов (поиск / фильтры над таблицей)                 */
/* ------------------------------------------------------------------ */

export function Toolbar({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2.5 border-b border-slate-100 px-4 py-3 dark:border-slate-700/60 ${className}`}
    >
      {children}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Поиск…',
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={`relative min-w-[220px] max-w-md flex-1 ${className}`}>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="search"
        aria-label={placeholder || 'Поиск'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 pl-9 pr-3 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Формы                                                              */
/* ------------------------------------------------------------------ */

const FIELD_BASE =
  'rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm transition focus:border-indigo-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

/**
 * Класс поля. Ширину `w-full` подставляем по умолчанию, но только если
 * вызывающий код не задал свою ширину (w-auto, w-44, w-1/2 …) — иначе
 * базовый w-full перебивал бы её и компактные фильтры растягивались.
 */
function fieldCls(className: string) {
  const hasWidth = /(?:^|\s)w-/.test(className);
  return `${hasWidth ? '' : 'w-full '}${FIELD_BASE} ${className}`.trim();
}

export function Field({
  label,
  children,
  className = '',
}: {
  label?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const generatedId = useId();
  const canLabel = label != null && isValidElement<{ id?: string }>(children);
  const controlId = canLabel ? children.props.id ?? generatedId : undefined;
  const control = canLabel ? cloneElement(children, { id: controlId }) : children;

  return (
    <div className={className}>
      {label != null && (
        <label
          htmlFor={controlId}
          className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400"
        >
          {label}
        </label>
      )}
      {control}
    </div>
  );
}

export function Input({
  className = '',
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={fieldCls(className)} {...props} />;
}

export function Select({
  className = '',
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={fieldCls(className)} {...props}>
      {children}
    </select>
  );
}

/* ------------------------------------------------------------------ */
/*  Кнопки                                                             */
/* ------------------------------------------------------------------ */

type BtnVariant =
  | 'primary'
  | 'ghost'
  | 'danger'
  | 'emerald'
  | 'sky'
  | 'amber';

const BTN_VARIANTS: Record<BtnVariant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700',
  emerald: 'bg-emerald-600 text-white hover:bg-emerald-700',
  sky: 'bg-sky-600 text-white hover:bg-sky-700',
  amber: 'bg-amber-600 text-white hover:bg-amber-700',
  danger: 'bg-rose-600 text-white hover:bg-rose-700',
  ghost:
    'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800',
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: {
  children: ReactNode;
  variant?: BtnVariant;
  size?: 'sm' | 'md';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const sizeCls =
    size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm';
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:opacity-50 ${sizeCls} ${BTN_VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Бейджи / статусы                                                   */
/* ------------------------------------------------------------------ */

const BADGE_TONES: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300',
  indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
  emerald:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
};

export function Badge({
  children,
  tone = 'slate',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Пагинация (низ таблицы)                                            */
/* ------------------------------------------------------------------ */

/**
 * Полоса пагинации под таблицей: «Показывать по N», диапазон «1–10 из 47»
 * и кнопки страниц. Используется внутри <TableCard> после таблицы.
 */
export function Pagination({
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
  sizes = [10, 25, 50, 100],
  className = '',
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
  sizes?: number[];
  className?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(Math.max(page, 1), pages);
  const from = total === 0 ? 0 : (cur - 1) * pageSize + 1;
  const to = Math.min(cur * pageSize, total);

  // Номера: первая, последняя, соседи текущей; между разрывами — «…»
  const nums: (number | '…')[] = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - cur) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }

  const btn =
    'flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-medium transition disabled:opacity-40';

  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 px-4 py-3 dark:border-slate-700/60 ${className}`}
    >
      {onPageSize && (
        <label className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          Показывать по
          <select
            value={pageSize}
            onChange={(e) => {
              onPageSize(Number(e.target.value));
              onPage(1);
            }}
            className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          >
            {sizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      )}

      <span className="text-sm text-slate-400">
        {total === 0 ? 'Нет записей' : `${from}–${to} из ${total}`}
      </span>

      {pages > 1 && (
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => onPage(cur - 1)}
            disabled={cur <= 1}
            aria-label="Предыдущая страница"
            className={`${btn} border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800`}
          >
            ‹
          </button>
          {nums.map((n, i) =>
            n === '…' ? (
              <span key={`e${i}`} className="px-1 text-sm text-slate-400">
                …
              </span>
            ) : (
              <button
                key={n}
                onClick={() => onPage(n)}
                className={`${btn} ${
                  n === cur
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {n}
              </button>
            ),
          )}
          <button
            onClick={() => onPage(cur + 1)}
            disabled={cur >= pages}
            aria-label="Следующая страница"
            className={`${btn} border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800`}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Пустое состояние / загрузка                                        */
/* ------------------------------------------------------------------ */

export function EmptyState({
  icon,
  title,
  hint,
  className = '',
}: {
  icon?: string | ReactNode;
  title: string;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center px-6 py-12 text-center ${className}`}
    >
      {icon && (
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800">
          {typeof icon === 'string' ? (
            <NavIcon name={icon} className="h-6 w-6" />
          ) : (
            icon
          )}
        </span>
      )}
      <div className="text-sm font-medium text-slate-600 dark:text-slate-300">
        {title}
      </div>
      {hint && (
        <div className="mt-1 max-w-sm text-xs text-slate-400">{hint}</div>
      )}
    </div>
  );
}
