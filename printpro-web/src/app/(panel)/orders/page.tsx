'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID, SERVER_ORIGIN } from '@/lib/config';
import { useAuth } from '@/lib/auth';

const STATUS_LABELS: Record<string, string> = {
  ACCEPTED: 'Новый',
  AWAITING_DESIGN: 'Ожидает макет',
  IN_DESIGN: 'В дизайне',
  DESIGN_APPROVAL: 'Макет на согласовании',
  DESIGN_APPROVED: 'Согласован',
  IN_PROGRESS: 'В производстве',
  READY: 'Готов',
  DELIVERED: 'Выдан',
  REWORK: 'Возврат / переделка',
  CANCELLED: 'Отменён',
};
// Порядок жизненного цикла для ручной смены статуса
const STATUS_FLOW = [
  'ACCEPTED',
  'AWAITING_DESIGN',
  'IN_DESIGN',
  'DESIGN_APPROVAL',
  'DESIGN_APPROVED',
  'IN_PROGRESS',
  'READY',
  'DELIVERED',
  'REWORK',
  'CANCELLED',
];
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
const URGENCY_LABELS: Record<string, string> = {
  NORMAL: 'Обычная',
  URGENT: 'Срочно',
  EXPRESS: 'Экспресс',
};

export default function OrdersPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const pageSize = 25;
  const [selected, setSelected] = useState<any | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('CASH');
  const [msg, setMsg] = useState('');

  function load() {
    const q = `companyId=${cid}&page=${page}&pageSize=${pageSize}${
      search ? `&search=${encodeURIComponent(search)}` : ''
    }`;
    api
      .get(`/orders?${q}`)
      .then((r) => {
        setOrders(r.items ?? []);
        setTotal(r.total ?? 0);
      })
      .catch(() => {});
  }
  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [cid, page, search]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

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

  async function changeStatus(status: string) {
    if (!selected) return;
    setMsg('');
    try {
      const updated = await api.patch(`/orders/${selected.id}/status`, { status });
      setSelected(updated);
      load();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function reorder() {
    if (!selected) return;
    setMsg('');
    try {
      const created = await api.post(`/orders/${selected.id}/reorder`);
      setMsg(`✓ Создан повторный заказ №${created.orderNumber}`);
      load();
      openOrder(created.id);
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
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-700">Заказы</h2>
            <span className="text-xs text-slate-400">всего: {total}</span>
          </div>
          <input
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder="Поиск по №, имени, телефону…"
            className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          {orders.length === 0 ? (
            <p className="text-slate-400">Заказов нет.</p>
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
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                ← Назад
              </button>
              <span className="text-slate-500">
                Стр. {page} из {pages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page >= pages}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                Вперёд →
              </button>
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
                <div className="flex items-center gap-3">
                  {can('orders.manage') && (
                    <button
                      onClick={reorder}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      ↻ Повторить
                    </button>
                  )}
                  <Link
                    href={`/order-card?id=${selected.id}`}
                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    🖨 Тех-карта
                  </Link>
                  {can('orders.manage') ? (
                    <select
                      value={selected.status}
                      onChange={(e) => changeStatus(e.target.value)}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-600"
                    >
                      {STATUS_FLOW.map((st) => (
                        <option key={st} value={st}>
                          {STATUS_LABELS[st]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-sm text-slate-500">
                      {STATUS_LABELS[selected.status]}
                    </span>
                  )}
                </div>
              </div>

              <div className="mb-3 text-sm text-slate-600">
                Клиент: {selected.client?.fullName ?? selected.client?.phone ?? '—'}
              </div>

              {/* Характеристики заказа */}
              {(selected.format ||
                selected.colorMode ||
                (selected.urgency && selected.urgency !== 'NORMAL') ||
                selected.designer ||
                selected.operator ||
                selected.deadline) && (
                <div className="mb-3 flex flex-wrap gap-2 text-xs">
                  {selected.urgency && selected.urgency !== 'NORMAL' && (
                    <span
                      className={`rounded-full px-2 py-0.5 ${
                        selected.urgency === 'EXPRESS'
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {URGENCY_LABELS[selected.urgency]}
                    </span>
                  )}
                  {selected.format && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                      Формат: {selected.format}
                    </span>
                  )}
                  {selected.colorMode && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                      {selected.colorMode}
                    </span>
                  )}
                  {selected.designer && (
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-violet-700">
                      Дизайнер: {selected.designer.fullName}
                    </span>
                  )}
                  {selected.operator && (
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-700">
                      Оператор: {selected.operator.fullName}
                    </span>
                  )}
                  {selected.deadline && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                      Срок: {new Date(selected.deadline).toLocaleString('ru-RU', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                </div>
              )}

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

              {/* История статусов */}
              {selected.statusHistory?.length > 0 && (
                <details className="mb-3 rounded-lg bg-slate-50 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium text-slate-500">
                    История статусов ({selected.statusHistory.length})
                  </summary>
                  <div className="mt-2 space-y-1">
                    {selected.statusHistory.map((h: any) => (
                      <div
                        key={h.id}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="text-slate-600">
                          {STATUS_LABELS[h.status] ?? h.status}
                          {h.reason ? ` · ${h.reason}` : ''}
                        </span>
                        <span className="shrink-0 text-slate-400">
                          {h.userName} ·{' '}
                          {new Date(h.createdAt).toLocaleString('ru-RU', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

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
                      <option value="QR">QR</option>
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
