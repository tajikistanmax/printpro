'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID, SERVER_ORIGIN } from '@/lib/config';
import { useAuth } from '@/lib/auth';

const STATUS_LABELS: Record<string, string> = {
  ACCEPTED: 'Принят',
  IN_PROGRESS: 'В работе',
  READY: 'Готов',
  DELIVERED: 'Выдан',
  CANCELLED: 'Отменён',
};
const PAY_LABELS: Record<string, string> = {
  UNPAID: 'Не оплачен',
  PARTIAL: 'Частично',
  PAID: 'Оплачен',
  DEBT: 'В долг',
};
const PAY_COLORS: Record<string, string> = {
  UNPAID: 'bg-slate-100 text-slate-600',
  PARTIAL: 'bg-amber-100 text-amber-700',
  PAID: 'bg-emerald-100 text-emerald-700',
  DEBT: 'bg-rose-100 text-rose-700',
};

export default function OrdersPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('CASH');
  const [msg, setMsg] = useState('');

  function load() {
    api.get(`/orders?companyId=${cid}`).then(setOrders).catch(() => {});
  }
  useEffect(load, [cid]);

  async function openOrder(id: string) {
    setMsg('');
    const full = await api.get(`/orders/${id}`);
    setSelected(full);
    setPayAmount(String(full.balanceDue));
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setMsg('');
    try {
      const updated = await api.post(`/orders/${selected.id}/payments`, {
        amount: Number(payAmount),
        method: payMethod,
      });
      setSelected(updated);
      setMsg('✓ Оплата проведена');
      load();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function refund() {
    if (!selected) return;
    if (!confirm('Оформить возврат? Деньги вернутся из кассы, товар — на склад, заказ будет отменён.'))
      return;
    setMsg('');
    try {
      const updated = await api.post(`/orders/${selected.id}/refund`);
      setSelected(updated);
      setMsg('✓ Возврат оформлен');
      load();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Заказы</h1>
        {can('orders.manage') && (
          <Link
            href="/orders/new"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            + Новый заказ
          </Link>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Список заказов */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-slate-700">Заказы</h2>
          {orders.length === 0 ? (
            <p className="text-slate-400">Заказов пока нет.</p>
          ) : (
            <div className="space-y-1">
              {orders.map((o) => (
                <button
                  key={o.id}
                  onClick={() => openOrder(o.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-slate-50 ${
                    selected?.id === o.id ? 'bg-indigo-50' : ''
                  }`}
                >
                  <span>
                    <span className="font-semibold">№{o.orderNumber}</span> ·{' '}
                    {o.client?.fullName ?? o.client?.phone ?? '—'}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-slate-500">{o.total} c.</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        PAY_COLORS[o.paymentStatus]
                      }`}
                    >
                      {PAY_LABELS[o.paymentStatus]}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Детали заказа + касса */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          {!selected ? (
            <p className="text-slate-400">Выберите заказ слева.</p>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold text-slate-700">
                  Заказ №{selected.orderNumber}
                </h2>
                <span className="text-sm text-slate-500">
                  {STATUS_LABELS[selected.status]}
                </span>
              </div>

              <div className="mb-3 text-sm text-slate-600">
                Клиент: {selected.client?.fullName ?? selected.client?.phone ?? '—'}
              </div>

              {/* Позиции */}
              <div className="mb-3 space-y-1">
                {selected.items?.map((it: any) => (
                  <div
                    key={it.id}
                    className="flex justify-between border-b border-slate-100 py-1.5 text-sm"
                  >
                    <span>
                      {it.description ||
                        it.service?.name ||
                        it.product?.name ||
                        'Позиция'}{' '}
                      × {it.quantity}
                    </span>
                    <span className="text-slate-500">{it.lineTotal} c.</span>
                  </div>
                ))}
              </div>

              {/* Прикреплённые файлы (макеты с сайта) */}
              {selected.files?.length > 0 && (
                <div className="mb-3">
                  <div className="mb-1 text-xs font-medium text-slate-500">
                    Файлы клиента
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selected.files.map((f: any) => (
                      <a
                        key={f.id}
                        href={`${SERVER_ORIGIN}${f.fileUrl}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg bg-indigo-50 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-100"
                      >
                        📎 {f.fileName ?? 'файл'}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Итоги */}
              <div className="mb-4 space-y-1 text-sm">
                <Line label="Итого" value={`${selected.total} c.`} bold />
                <Line label="Оплачено" value={`${selected.paid} c.`} />
                <Line
                  label="К оплате"
                  value={`${selected.balanceDue} c.`}
                  danger={Number(selected.balanceDue) > 0}
                />
              </div>

              {/* Касса: оплата */}
              {can('cash.operate') && Number(selected.balanceDue) > 0 && (
                <form onSubmit={pay} className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="mb-1 block text-xs text-slate-500">Сумма</label>
                    <input
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      type="number"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Способ</label>
                    <select
                      value={payMethod}
                      onChange={(e) => setPayMethod(e.target.value)}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="CASH">Наличные</option>
                      <option value="CARD">Карта</option>
                      <option value="TRANSFER">Перевод</option>
                    </select>
                  </div>
                  <button className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
                    Принять оплату
                  </button>
                </form>
              )}
              {/* Возврат */}
              {can('cash.operate') &&
                selected.status !== 'CANCELLED' &&
                Number(selected.paid) > 0 && (
                  <button
                    onClick={refund}
                    className="mt-3 rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50"
                  >
                    Оформить возврат
                  </button>
                )}

              {msg && <p className="mt-2 text-sm text-slate-600">{msg}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Line({
  label,
  value,
  bold,
  danger,
}: {
  label: string;
  value: string;
  bold?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span
        className={`${bold ? 'font-bold' : ''} ${
          danger ? 'text-rose-600' : 'text-slate-700'
        }`}
      >
        {value}
      </span>
    </div>
  );
}
