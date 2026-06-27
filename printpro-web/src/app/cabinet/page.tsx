'use client';

import { useState } from 'react';
import Link from 'next/link';
import { API_BASE, DEFAULT_COMPANY_ID } from '@/lib/config';

const STATUS: Record<string, { label: string; cls: string }> = {
  ACCEPTED: { label: 'Принят', cls: 'bg-slate-100 text-slate-600' },
  AWAITING_DESIGN: { label: 'Ожидает макет', cls: 'bg-amber-100 text-amber-700' },
  IN_DESIGN: { label: 'В дизайне', cls: 'bg-violet-100 text-violet-700' },
  DESIGN_APPROVAL: { label: 'Макет на согласовании', cls: 'bg-sky-100 text-sky-700' },
  DESIGN_APPROVED: { label: 'Согласован', cls: 'bg-sky-100 text-sky-700' },
  IN_PROGRESS: { label: 'В производстве', cls: 'bg-sky-100 text-sky-700' },
  READY: { label: 'Готов', cls: 'bg-emerald-100 text-emerald-700' },
  DELIVERED: { label: 'Выдан', cls: 'bg-slate-200 text-slate-500' },
  REWORK: { label: 'Переделка', cls: 'bg-rose-100 text-rose-700' },
  CANCELLED: { label: 'Отменён', cls: 'bg-rose-100 text-rose-700' },
};
const PAY: Record<string, string> = {
  UNPAID: 'Не оплачен',
  PARTIAL: 'Частично',
  PAID: 'Оплачен',
  DEBT: 'В долг',
};

export default function CabinetPage() {
  const cid = DEFAULT_COMPANY_ID;
  const [phone, setPhone] = useState('');
  const [client, setClient] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) return;
    setBusy(true);
    setMsg('');
    try {
      const r = await fetch(
        `${API_BASE}/public/my-orders?companyId=${cid}&phone=${encodeURIComponent(phone.trim())}`,
      ).then((x) => x.json());
      setClient(r.client);
      setOrders(r.orders ?? []);
      setSearched(true);
    } catch {
      setMsg('Не удалось загрузить. Попробуйте позже.');
    } finally {
      setBusy(false);
    }
  }

  async function reorder(orderId: string) {
    setMsg('');
    try {
      const r = await fetch(`${API_BASE}/public/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: cid, phone: phone.trim(), orderId }),
      }).then((x) => x.json());
      if (r.ok) {
        setMsg(`✓ Повторный заказ оформлен: №${r.orderNumber}`);
        // обновим список
        const u = await fetch(
          `${API_BASE}/public/my-orders?companyId=${cid}&phone=${encodeURIComponent(phone.trim())}`,
        ).then((x) => x.json());
        setOrders(u.orders ?? []);
      } else {
        setMsg(r.message ?? 'Не получилось повторить заказ');
      }
    } catch {
      setMsg('Ошибка сети');
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-800">Личный кабинет</h1>
          <Link href="/order" className="text-sm text-indigo-600 hover:underline">
            + Новый заказ
          </Link>
        </div>

        <form
          onSubmit={lookup}
          className="mb-6 flex gap-2 rounded-2xl bg-white p-5 shadow-sm"
        >
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Ваш телефон (как при заказе)"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2"
          />
          <button
            disabled={busy}
            className="rounded-lg bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? 'Поиск…' : 'Найти заказы'}
          </button>
        </form>

        {msg && (
          <div className="mb-4 rounded-lg bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
            {msg}
          </div>
        )}

        {searched && !client && (
          <p className="text-slate-500">
            По этому номеру заказов не найдено. Проверьте телефон или{' '}
            <Link href="/order" className="text-indigo-600 hover:underline">
              оформите новый заказ
            </Link>
            .
          </p>
        )}

        {client && (
          <>
            <div className="mb-3 text-sm text-slate-500">
              {client.fullName ? `${client.fullName} · ` : ''}
              {client.phone} — заказов: {orders.length}
            </div>
            <div className="space-y-3">
              {orders.map((o) => {
                const st = STATUS[o.status] ?? STATUS.ACCEPTED;
                return (
                  <div key={o.id} className="rounded-2xl bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-800">
                        №{o.orderNumber}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs ${st.cls}`}
                      >
                        {st.label}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-slate-500">
                      {o.items
                        ?.map(
                          (it: any) =>
                            `${it.description ?? 'позиция'} ×${Number(it.quantity)}`,
                        )
                        .join(', ')}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className="text-slate-600">
                        {Number(o.total)} c. · {PAY[o.paymentStatus]}
                      </span>
                      <button
                        onClick={() => reorder(o.id)}
                        className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        ↻ Повторить
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
