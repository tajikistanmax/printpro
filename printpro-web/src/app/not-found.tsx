import Link from 'next/link';

/**
 * Экран 404 — показывается для несуществующих адресов внутри приложения.
 * Ссылка ведёт на «/»: он сам решит, куда отправить — на /dashboard (если
 * вход выполнен) или на /login (см. src/app/page.tsx).
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 text-indigo-500">
          <svg
            className="h-7 w-7"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
            <path d="M8.5 11h5" strokeLinecap="round" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-slate-800">Страница не найдена</h1>
        <p className="mt-2 text-sm text-slate-500">
          Такой страницы не существует или она была перемещена. Проверьте адрес
          или вернитесь на главную.
        </p>

        <div className="mt-6">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:from-indigo-600 hover:to-purple-700"
          >
            На главную
          </Link>
        </div>
      </div>
    </div>
  );
}
