'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';

interface Line {
  itemType: 'SERVICE' | 'PRODUCT';
  refId: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Черновик', cls: 'bg-slate-100 text-slate-600' },
  SENT: { label: 'Отправлено', cls: 'bg-sky-100 text-sky-700' },
  ACCEPTED: { label: 'Принято', cls: 'bg-emerald-100 text-emerald-700' },
  REJECTED: { label: 'Отклонено', cls: 'bg-rose-100 text-rose-700' },
};

export default function QuotesPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const manage = can('orders.manage');
  const router = useRouter();

  const [quotes, setQuotes] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [msg, setMsg] = useState('');

  // Форма
  const [clientPhone, setClientPhone] = useState('');
  const [clientName, setClientName] = useState('');
  const [title, setTitle] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [creating, setCreating] = useState(false);

  function load() {
    api.get(`/quotes?companyId=${cid}`).then(setQuotes).catch(() => {});
  }
  useEffect(() => {
    load();
    api.get(`/services?companyId=${cid}`).then(setServices).catch(() => {});
    api.get(`/products?companyId=${cid}`).then(setProducts).catch(() => {});
  }, [cid]);

  function addLine(itemType: 'SERVICE' | 'PRODUCT') {
    setLines((l) => [
      ...l,
      { itemType, refId: '', description: '', quantity: 1, unitPrice: 0 },
    ]);
  }
  function updateLine(i: number, patch: Partial<Line>) {
    setLines((l) => l.map((ln, idx) => (idx === i ? { ...ln, ...patch } : ln)));
  }
  function pickRef(i: number, refId: string) {
    const line = lines[i];
    if (line.itemType === 'SERVICE') {
      const s = services.find((x) => x.id === refId);
      updateLine(i, { refId, description: s?.name ?? '', unitPrice: Number(s?.basePrice ?? 0) });
    } else {
      const p = products.find((x) => x.id === refId);
      updateLine(i, { refId, description: p?.name ?? '', unitPrice: Number(p?.salePrice ?? 0) });
    }
  }

  const total = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    if (lines.length === 0) return setMsg('Добавьте хотя бы одну позицию');
    setCreating(true);
    try {
      await api.post('/quotes', {
        companyId: cid,
        clientPhone: clientPhone || undefined,
        clientName: clientName || undefined,
        title: title || undefined,
        validUntil: validUntil ? new Date(validUntil).toISOString() : undefined,
        items: lines.map((l) => ({
          itemType: l.itemType,
          serviceId: l.itemType === 'SERVICE' ? l.refId || undefined : undefined,
          productId: l.itemType === 'PRODUCT' ? l.refId || undefined : undefined,
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
        })),
      });
      setClientPhone('');
      setClientName('');
      setTitle('');
      setValidUntil('');
      setLines([]);
      setMsg('✓ КП создано');
      load();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    } finally {
      setCreating(false);
    }
  }

  async function setStatus(id: string, status: string) {
    await api.patch(`/quotes/${id}/status`, { status });
    load();
    if (selected?.id === id) setSelected({ ...selected, status });
  }

  async function convert(id: string) {
    if (!confirm('Превратить КП в заказ?')) return;
    try {
      const order = await api.post(`/quotes/${id}/convert`);
      setMsg(`✓ Создан заказ №${order.orderNumber}`);
      router.push(`/orders?created=${order.orderNumber}`);
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function remove(id: string) {
    if (!confirm('Удалить КП?')) return;
    await api.del(`/quotes/${id}`);
    setSelected(null);
    load();
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-800">
        Коммерческие предложения
      </h1>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Создание КП */}
        {manage && (
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-slate-700">Новое КП</h2>
            <form onSubmit={create} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="Телефон клиента"
                  className="rounded-lg border border-slate-300 px-3 py-2"
                />
                <input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Имя / компания"
                  className="rounded-lg border border-slate-300 px-3 py-2"
                />
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Заголовок (напр. Печать каталога)"
                  className="rounded-lg border border-slate-300 px-3 py-2"
                />
                <input
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                  type="date"
                  title="Действительно до"
                  className="rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => addLine('SERVICE')}
                  className="rounded-lg bg-indigo-100 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-200"
                >
                  + Услуга
                </button>
                <button
                  type="button"
                  onClick={() => addLine('PRODUCT')}
                  className="rounded-lg bg-emerald-100 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-200"
                >
                  + Товар
                </button>
              </div>

              {lines.map((l, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <select
                    value={l.refId}
                    onChange={(e) => pickRef(i, e.target.value)}
                    className="min-w-[150px] flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">— выбрать —</option>
                    {(l.itemType === 'SERVICE' ? services : products).map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={l.quantity}
                    min={0.001}
                    step="0.001"
                    onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
                    className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    type="number"
                    value={l.unitPrice}
                    min={0}
                    step="0.01"
                    onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) })}
                    className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <span className="w-16 text-right text-sm text-slate-600">
                    {(l.quantity * l.unitPrice).toFixed(2)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                    className="px-1 text-rose-500"
                  >
                    ✕
                  </button>
                </div>
              ))}

              <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                <span className="text-lg font-bold text-slate-800">
                  Итого: {total.toFixed(2)} c.
                </span>
                <button
                  disabled={creating}
                  className="rounded-lg bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {creating ? 'Создание…' : 'Создать КП'}
                </button>
              </div>
              {msg && <p className="text-sm text-slate-600">{msg}</p>}
            </form>
          </div>
        )}

        {/* Список + детали */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-slate-700">Список КП</h2>
          {quotes.length === 0 ? (
            <p className="text-slate-400">КП пока нет.</p>
          ) : (
            <div className="space-y-1">
              {quotes.map((q) => {
                const st = STATUS[q.status] ?? STATUS.DRAFT;
                return (
                  <div
                    key={q.id}
                    className="rounded-lg border border-slate-100 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm">
                        <span className="font-semibold">№{q.number}</span> ·{' '}
                        {q.client?.fullName ?? q.client?.phone ?? '—'}
                        {q.title ? ` · ${q.title}` : ''}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-slate-500">{q.total} c.</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${st.cls}`}>
                          {st.label}
                        </span>
                      </span>
                    </div>
                    {manage && q.status !== 'ACCEPTED' && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {q.status === 'DRAFT' && (
                          <button
                            onClick={() => setStatus(q.id, 'SENT')}
                            className="rounded bg-sky-100 px-2.5 py-1 text-xs text-sky-700 hover:bg-sky-200"
                          >
                            Отправлено
                          </button>
                        )}
                        <button
                          onClick={() => convert(q.id)}
                          className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                        >
                          → В заказ
                        </button>
                        <button
                          onClick={() => setStatus(q.id, 'REJECTED')}
                          className="rounded px-2.5 py-1 text-xs text-rose-600 hover:bg-rose-50"
                        >
                          Отклонить
                        </button>
                        <button
                          onClick={() => remove(q.id)}
                          className="rounded px-2 py-1 text-xs text-slate-400 hover:text-rose-600"
                        >
                          Удалить
                        </button>
                      </div>
                    )}
                    {q.convertedOrderId && (
                      <div className="mt-1 text-xs text-emerald-600">
                        → превращено в заказ
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
