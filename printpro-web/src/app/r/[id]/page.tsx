'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { API_BASE } from '@/lib/config';

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(n) + ' c.';
}

const PAY_STATUS: Record<string, { label: string; cls: string }> = {
  PAID: { label: 'Оплачено', cls: 'bg-emerald-100 text-emerald-700' },
  PARTIAL: { label: 'Частично', cls: 'bg-amber-100 text-amber-700' },
  UNPAID: { label: 'Не оплачено', cls: 'bg-rose-100 text-rose-700' },
  DEBT: { label: 'Долг', cls: 'bg-rose-100 text-rose-700' },
};

export default function PublicReceiptPage() {
  const params = useParams();
  const id = String(params?.id ?? '');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetch(`${API_BASE}/public/receipt/${id}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ found: false }))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="flex min-h-screen items-start justify-center bg-gradient-to-br from-violet-50 via-white to-indigo-50 px-4 py-10">
      <div className="w-full max-w-sm">
        {loading ? (
          <div className="py-20 text-center text-slate-400">Загрузка…</div>
        ) : !data?.found ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="text-lg font-semibold text-slate-700">Чек не найден</div>
            <p className="mt-1 text-sm text-slate-400">Возможно, ссылка устарела.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {/* Шапка */}
            <div className="bg-gradient-to-br from-indigo-500 to-violet-600 px-6 py-6 text-center text-white">
              <div className="text-xl font-extrabold tracking-tight">{data.company.name}</div>
              {data.company.address && (
                <div className="mt-1 text-xs text-white/80">{data.company.address}</div>
              )}
              {data.company.phone && (
                <div className="text-xs text-white/80">тел. {data.company.phone}</div>
              )}
            </div>

            {/* Тело */}
            <div className="px-6 py-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-400">Заказ</div>
                  <div className="text-lg font-bold text-slate-800">№{data.orderNumber}</div>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    PAY_STATUS[data.paymentStatus]?.cls ?? 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {PAY_STATUS[data.paymentStatus]?.label ?? data.paymentStatus}
                </span>
              </div>

              <div className="text-xs text-slate-400">
                {new Date(data.date).toLocaleString('ru-RU')}
              </div>

              <div className="my-4 space-y-2 border-y border-dashed border-slate-200 py-4">
                {data.items.map((it: any, i: number) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="min-w-0 truncate pr-2 text-slate-700">
                      {it.name} <span className="text-slate-400">×{it.quantity}</span>
                    </span>
                    <span className="shrink-0 font-medium text-slate-800">
                      {money(it.lineTotal)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between">
                <span className="text-base font-semibold text-slate-500">Итого</span>
                <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-2xl font-black text-transparent">
                  {money(data.total)}
                </span>
              </div>
              {data.balanceDue > 0 && (
                <div className="mt-1 flex items-center justify-between text-sm text-rose-600">
                  <span>К доплате</span>
                  <span className="font-semibold">{money(data.balanceDue)}</span>
                </div>
              )}

              {data.company.inn && (
                <div className="mt-5 text-center text-[11px] text-slate-400">
                  ИНН {data.company.inn}
                </div>
              )}
              <div className="mt-1 text-center text-xs text-slate-400">Спасибо за покупку!</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
