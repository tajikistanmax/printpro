'use client'; // Границы ошибок обязаны быть Client Component

import './globals.css';

/**
 * Крайний fallback: срабатывает, если упал сам корневой layout (a не только
 * содержимое страницы). Должен сам объявлять <html>/<body> — на это время он
 * ПОЛНОСТЬЮ заменяет собой root layout, поэтому явно подключает глобальные
 * стили, иначе окажется без оформления.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="min-h-full bg-slate-100 text-slate-800">
        <div className="flex min-h-screen w-full items-center justify-center px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-500">
              <svg
                className="h-7 w-7"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
                <path
                  d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-800">Что-то пошло не так</h1>
            <p className="mt-2 text-sm text-slate-500">
              Приложение столкнулось с критической ошибкой. Попробуйте обновить
              страницу — обычно это помогает.
            </p>
            {error.digest && (
              <p className="mt-2 text-xs text-slate-400">Код ошибки: {error.digest}</p>
            )}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={() => reset()}
                className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:from-indigo-600 hover:to-purple-700"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Обновить
              </button>
              <a
                href="/login"
                className="flex items-center justify-center rounded-xl border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                На страницу входа
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
