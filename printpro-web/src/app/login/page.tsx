'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { API_BASE, DEFAULT_COMPANY_ID } from '@/lib/config';

export default function LoginPage() {
  const router = useRouter();
  const { login, loginPin } = useAuth();
  const [mode, setMode] = useState<'password' | 'pin'>('password');
  const [loginValue, setLoginValue] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // PIN-вход кассира
  const [pin, setPin] = useState('');
  const pushPin = useCallback((d: string) => {
    setError('');
    setPin((p) => (p.length >= 6 ? p : p + d));
  }, []);
  const submitPin = useCallback(async (value: string) => {
    setError('');
    setBusy(true);
    try {
      await loginPin(value);
      router.replace('/pos');
    } catch (err: any) {
      setError(err.message ?? 'Неверный PIN');
      setPin('');
    } finally {
      setBusy(false);
    }
  }, [loginPin, router]);
  // Ввод PIN с физической клавиатуры (цифры, Backspace, Enter, Esc)
  useEffect(() => {
    if (mode !== 'pin') return;
    const onKey = (e: KeyboardEvent) => {
      if (busy) return;
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        pushPin(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setError('');
        setPin((p) => p.slice(0, -1));
      } else if (e.key === 'Escape' || e.key === 'Delete') {
        e.preventDefault();
        setPin('');
      } else if (e.key === 'Enter' && pin.length >= 4) {
        e.preventDefault();
        void submitPin(pin);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, busy, pin, pushPin, submitPin]);

  // «Забыли пароль?»
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotLogin, setForgotLogin] = useState('');
  const [forgotMsg, setForgotMsg] = useState('');
  const [forgotBusy, setForgotBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(loginValue, password);
      router.replace('/dashboard');
    } catch (err: any) {
      setError(err.message ?? 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  }

  async function requestReset(e: React.FormEvent) {
    e.preventDefault();
    if (!forgotLogin.trim()) return;
    setForgotBusy(true);
    setForgotMsg('');
    try {
      const res = await fetch(`${API_BASE}/public/password-reset-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: DEFAULT_COMPANY_ID,
          login: forgotLogin.trim(),
        }),
      });
      if (!res.ok) {
        let message = 'Не удалось отправить запрос. Обратитесь к администратору напрямую.';
        try {
          const body = await res.json();
          message = body?.message ?? message;
        } catch {
          // Оставляем дефолтное сообщение.
        }
        throw new Error(Array.isArray(message) ? message.join(', ') : message);
      }
      setForgotMsg(
        'Запрос отправлен администратору. Он сбросит ваш пароль в разделе «Сотрудники» и сообщит вам новый.',
      );
    } catch (err: any) {
      setForgotMsg(
        err?.message ?? 'Не удалось отправить запрос. Обратитесь к администратору напрямую.',
      );
    } finally {
      setForgotBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen w-full bg-white">
      {/* ==================== Левая панель: форма (на весь экран) ==================== */}
      <div className="flex w-full flex-col justify-between px-8 py-10 sm:px-14 sm:py-12 lg:w-[480px] lg:shrink-0 lg:px-16">
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
          {/* Логотип */}
          <div className="mb-8">
            <Logo />
            <p className="mt-4 max-w-[280px] text-sm leading-snug text-slate-500">
              Система управления типографией
              <br />и полиграфическим производством
            </p>
          </div>

          {/* Приветствие */}
          <h1 className="text-2xl font-bold text-slate-800">Добро пожаловать!</h1>
          <p className="mb-6 mt-1 text-sm text-slate-400">
            Войдите в систему, чтобы продолжить
          </p>

          {/* Переключатель способа входа */}
          <div className="mb-5 flex gap-1 rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => { setMode('password'); setError(''); }}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${mode === 'password' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Логин и пароль
            </button>
            <button
              type="button"
              onClick={() => { setMode('pin'); setError(''); }}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${mode === 'pin' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              PIN кассира
            </button>
          </div>

          {mode === 'pin' && (
            <div className="space-y-4">
              {/* Точки-индикатор введённого PIN */}
              <div className="flex justify-center gap-3 py-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <span
                    key={`pin-dot-${i}`}
                    className={`h-3.5 w-3.5 rounded-full transition ${i < pin.length ? 'bg-indigo-500' : 'bg-slate-200'}`}
                  />
                ))}
              </div>

              {error && (
                <div className="rounded-lg bg-rose-50 px-3 py-2 text-center text-sm text-rose-600">
                  {error}
                </div>
              )}

              {/* Клавиатура PIN */}
              <div className="grid grid-cols-3 gap-2.5">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => pushPin(d)}
                    className="rounded-xl border border-slate-200 bg-slate-50 py-4 text-xl font-semibold text-slate-700 transition hover:bg-slate-100 active:scale-95"
                  >
                    {d}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPin('')}
                  className="rounded-xl border border-slate-200 bg-slate-50 py-4 text-sm font-medium text-slate-400 transition hover:bg-slate-100"
                >
                  Сброс
                </button>
                <button
                  type="button"
                  onClick={() => pushPin('0')}
                  className="rounded-xl border border-slate-200 bg-slate-50 py-4 text-xl font-semibold text-slate-700 transition hover:bg-slate-100 active:scale-95"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={() => setPin((p) => p.slice(0, -1))}
                  className="rounded-xl border border-slate-200 bg-slate-50 py-4 text-slate-400 transition hover:bg-slate-100"
                  aria-label="Стереть"
                >
                  ⌫
                </button>
              </div>

              <button
                type="button"
                disabled={busy || pin.length < 4}
                onClick={() => submitPin(pin)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 py-3.5 text-base font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:from-indigo-600 hover:to-purple-700 disabled:opacity-60"
              >
                {busy ? 'Вход…' : 'Войти на кассу'}
                {!busy && <ArrowIcon className="h-5 w-5" />}
              </button>

              <p className="text-center text-xs text-slate-400">
                Можно набирать PIN с клавиатуры: цифры, ⌫ — стереть, Enter — войти
              </p>
            </div>
          )}

          {mode === 'password' && (
          <form onSubmit={onSubmit} className="space-y-4">
            {/* Логин */}
            <div className="relative">
              <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={loginValue}
                onChange={(e) => setLoginValue(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-base text-slate-700 outline-none transition focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                placeholder="Логин или e-mail"
                autoFocus
              />
            </div>

            {/* Пароль */}
            <div className="relative">
              <LockIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-11 text-base text-slate-700 outline-none transition focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                placeholder="Пароль"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                tabIndex={-1}
                aria-label="Показать пароль"
              >
                <EyeIcon className="h-5 w-5" open={showPassword} />
              </button>
            </div>

            {/* Запомнить / Забыли пароль */}
            <div className="flex items-center justify-between pt-1 text-sm">
              <label className="flex cursor-pointer select-none items-center gap-2 text-slate-600">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-indigo-600"
                />
                Запомнить меня
              </label>
              <button
                type="button"
                onClick={() => {
                  setForgotOpen(true);
                  setForgotMsg('');
                  setForgotLogin(loginValue);
                }}
                className="font-medium text-indigo-600 hover:text-indigo-700"
              >
                Забыли пароль?
              </button>
            </div>

            {error && (
              <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
                {error}
              </div>
            )}

            {/* Кнопка входа */}
            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 py-3.5 text-base font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:from-indigo-600 hover:to-purple-700 disabled:opacity-60"
            >
              {busy ? 'Вход…' : 'Войти в систему'}
              {!busy && <ArrowIcon className="h-5 w-5" />}
            </button>
          </form>
          )}
        </div>

        {/* Низ панели */}
        <div className="mt-8">
          <div className="flex items-center justify-between text-sm text-slate-500">
            <button
              type="button"
              className="flex items-center gap-2 hover:text-slate-700"
            >
              <GlobeIcon className="h-4 w-4 text-indigo-500" />
              Язык: Русский
              <ChevronDown className="h-4 w-4" />
            </button>
            <span className="text-slate-400">Версия 2.5.0.0</span>
          </div>
          <p className="mt-4 text-xs text-slate-400">
            © 2025 MaxSoft. Все права защищены.
          </p>
        </div>
      </div>

      {/* ==================== Правая панель: hero ==================== */}
      <div className="relative hidden flex-1 overflow-hidden lg:block min-h-[540px]">
        {/* Фон-фото (положите файл в public/login-hero.jpg) + тёмная подложка */}
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('/login-hero.jpg')" }}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900/95 via-slate-900/85 to-slate-800/80" />

        {/* Контент поверх */}
        <div className="relative flex h-full flex-col justify-between p-9 text-white">
          <div>
            <h2 className="text-4xl font-bold leading-tight">
              Все процессы
              <br />
              под{' '}
              <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                контролем
              </span>
            </h2>
            <p className="mt-3 max-w-md text-base text-slate-300">
              Управляйте заказами, клиентами, производством, дизайном и финансами
              из одного места
            </p>

            {/* Карточки статистики */}
            <div className="mt-8 flex flex-wrap gap-3">
              <Stat
                value="87"
                label="Заказов сегодня"
                color="from-indigo-500 to-purple-600"
                icon={<DocIcon />}
              />
              <Stat
                value="52 000"
                label="Напечатано листов"
                color="from-sky-500 to-blue-600"
                icon={<PrinterIcon />}
              />
              <Stat
                value="143"
                label="Макетов создано"
                color="from-pink-500 to-rose-600"
                icon={<PaletteIcon />}
              />
              <Stat
                value="1 245"
                label="Клиентов"
                color="from-emerald-500 to-green-600"
                icon={<UsersIcon />}
              />
              <Stat
                value="24 800"
                label="Выручка (сомони)"
                color="from-amber-500 to-orange-600"
                icon={<ChartIcon />}
              />
            </div>
          </div>

          {/* Нижние бейджи */}
          <div className="flex items-end justify-between">
            <div className="flex items-center gap-3 rounded-2xl bg-slate-800/70 px-5 py-4 backdrop-blur">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                <ShieldIcon className="h-5 w-5" />
              </span>
              <div>
                <div className="font-semibold">Система защищена</div>
                <div className="text-sm text-slate-400">
                  Ваши данные в безопасности
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400" />
              Сервер: Онлайн
            </div>
          </div>
        </div>
      </div>

      {/* ==================== Модалка «Забыли пароль?» ==================== */}
      {forgotOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">
                Восстановление пароля
              </h2>
              <button
                onClick={() => setForgotOpen(false)}
                className="text-slate-400 hover:text-slate-600"
                aria-label="Закрыть"
              >
                ✕
              </button>
            </div>
            {forgotMsg ? (
              <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
                {forgotMsg}
              </div>
            ) : (
              <form onSubmit={requestReset}>
                <p className="mb-3 text-sm text-slate-500">
                  Введите свой логин — мы отправим запрос администратору, он
                  сбросит пароль и сообщит вам новый.
                </p>
                <input
                  value={forgotLogin}
                  onChange={(e) => setForgotLogin(e.target.value)}
                  placeholder="Ваш логин"
                  autoFocus
                  className="mb-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-700 outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                />
                <button
                  type="submit"
                  disabled={forgotBusy}
                  className="w-full rounded-xl bg-indigo-600 py-3 text-base font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {forgotBusy ? 'Отправка…' : 'Отправить запрос'}
                </button>
              </form>
            )}
            <button
              onClick={() => setForgotOpen(false)}
              className="mt-3 w-full rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ==================== Карточка статистики ==================== */
function Stat({
  value,
  label,
  color,
  icon,
}: {
  value: string;
  label: string;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="w-[150px] rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
      <span
        className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br ${color} text-white`}
      >
        {icon}
      </span>
      <div className="text-2xl font-bold">{value}</div>
      <div className="mt-0.5 text-xs text-slate-400">{label}</div>
    </div>
  );
}

/* ==================== Логотип ==================== */
function Logo() {
  return (
    <div>
      {/* Знак бренда «P» (логотип компании) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="PrintPro" width={84} height={84} className="object-contain" />

      {/* Слово PrintPro (курсивное, как в макете) */}
      <div className="mt-2 text-[40px] font-extrabold italic leading-none tracking-tight text-slate-900">
        Print<span className="text-violet-600">Pro</span>
      </div>
    </div>
  );
}

/* ==================== Иконки (инлайн SVG) ==================== */
type IconProps = { className?: string };

function UserIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" strokeLinecap="round" />
    </svg>
  );
}
function LockIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
    </svg>
  );
}
function EyeIcon({ className, open }: IconProps & { open?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" />
      {!open && <path d="M3 3l18 18" strokeLinecap="round" />}
    </svg>
  );
}
function ArrowIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ShieldIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3Z" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function GlobeIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
    </svg>
  );
}
function ChevronDown({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function DocIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 2h8l4 4v16H6V2Z" strokeLinejoin="round" />
      <path d="M14 2v4h4M9 13h6M9 17h6" strokeLinecap="round" />
    </svg>
  );
}
function PrinterIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 9V3h12v6M6 18H4v-7h16v7h-2" strokeLinejoin="round" />
      <rect x="7" y="15" width="10" height="6" />
    </svg>
  );
}
function PaletteIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2 0-1.5 1-2 2.5-2H18a3 3 0 0 0 3-3 9 9 0 0 0-9-9Z" strokeLinejoin="round" />
      <circle cx="7.5" cy="11" r="1" fill="currentColor" />
      <circle cx="12" cy="7.5" r="1" fill="currentColor" />
      <circle cx="16" cy="11" r="1" fill="currentColor" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20a6 6 0 0 1 12 0M16 5a3.5 3.5 0 0 1 0 7M18 20a6 6 0 0 0-3-5" strokeLinecap="round" />
    </svg>
  );
}
function ChartIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6" strokeLinecap="round" />
    </svg>
  );
}
