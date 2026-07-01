'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import {
  PageHeader,
  StatGrid,
  StatCard,
  Card,
  SectionTitle,
  Field,
  Input,
  Select,
  Button,
  Badge,
  EmptyState,
  Tone,
} from '@/components/ui';
import NavIcon from '@/lib/NavIcons';
import FeatureGate from '@/lib/FeatureGate';

interface Line {
  itemType: 'SERVICE' | 'PRODUCT';
  refId: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Черновик', tone: 'slate' },
  SENT: { label: 'Отправлено', tone: 'sky' },
  ACCEPTED: { label: 'Принято', tone: 'emerald' },
  REJECTED: { label: 'Отклонено', tone: 'rose' },
};

function QuotesInner() {
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

  const acceptedCount = quotes.filter((q) => q.status === 'ACCEPTED').length;
  const sentCount = quotes.filter((q) => q.status === 'SENT').length;
  const quotesValue = quotes.reduce((s, q) => s + (Number(q.total) || 0), 0);

  return (
    <div>
      <PageHeader icon="quotes" title="Коммерческие предложения" subtitle="Создание КП и превращение их в заказы" />

      <StatGrid cols={4}>
        <StatCard icon="quotes" tone="indigo" label="Всего КП" value={quotes.length} highlight />
        <StatCard icon="reports" tone="sky" label="Отправлено" value={sentCount} />
        <StatCard icon="orders" tone="emerald" label="Принято" value={acceptedCount} />
        <StatCard icon="cash" tone="violet" label="Сумма" value={`${quotesValue} c.`} />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Создание КП */}
        {manage && (
          <Card>
            <SectionTitle>Новое КП</SectionTitle>
            <form onSubmit={create} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="Телефон клиента"
                />
                <Input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Имя / компания"
                />
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Заголовок (напр. Печать каталога)"
                />
                <Input
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                  type="date"
                  title="Действительно до"
                />
              </div>

              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => addLine('SERVICE')}>
                  + Услуга
                </Button>
                <Button type="button" variant="ghost" onClick={() => addLine('PRODUCT')}>
                  + Товар
                </Button>
              </div>

              {lines.map((l, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Select
                    value={l.refId}
                    onChange={(e) => pickRef(i, e.target.value)}
                    className="min-w-[150px] flex-1"
                  >
                    <option value="">— выбрать —</option>
                    {(l.itemType === 'SERVICE' ? services : products).map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </Select>
                  <Input
                    type="number"
                    value={l.quantity}
                    min={0.001}
                    step="0.001"
                    onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
                    className="w-16"
                  />
                  <Input
                    type="number"
                    value={l.unitPrice}
                    min={0}
                    step="0.01"
                    onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) })}
                    className="w-20"
                  />
                  <span className="w-16 text-right text-sm text-slate-600 dark:text-slate-300">
                    {(l.quantity * l.unitPrice).toFixed(2)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                    aria-label="Удалить"
                    className="inline-flex px-1 text-rose-500"
                  >
                    <NavIcon name="close" className="h-4 w-4" />
                  </button>
                </div>
              ))}

              <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-700 pt-3">
                <span className="text-lg font-bold text-slate-800 dark:text-slate-100">
                  Итого: {total.toFixed(2)} c.
                </span>
                <Button type="submit" disabled={creating}>
                  {creating ? 'Создание…' : 'Создать КП'}
                </Button>
              </div>
              {msg && <p className="text-sm text-slate-600 dark:text-slate-300">{msg}</p>}
            </form>
          </Card>
        )}

        {/* Список + детали */}
        <Card>
          <SectionTitle>Список КП</SectionTitle>
          {quotes.length === 0 ? (
            <EmptyState icon="quotes" title="КП пока нет" hint="Создайте первое коммерческое предложение в форме слева." />
          ) : (
            <div className="space-y-1">
              {quotes.map((q) => {
                const st = STATUS[q.status] ?? STATUS.DRAFT;
                return (
                  <div
                    key={q.id}
                    className="rounded-lg border border-slate-100 dark:border-slate-700 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm">
                        <span className="font-semibold">№{q.number}</span> ·{' '}
                        {q.client?.fullName ?? q.client?.phone ?? '—'}
                        {q.title ? ` · ${q.title}` : ''}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-slate-500 dark:text-slate-400">{q.total} c.</span>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </span>
                    </div>
                    {manage && q.status !== 'ACCEPTED' && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {q.status === 'DRAFT' && (
                          <Button variant="sky" size="sm" onClick={() => setStatus(q.id, 'SENT')}>
                            Отправлено
                          </Button>
                        )}
                        <Button variant="emerald" size="sm" onClick={() => convert(q.id)}>
                          → В заказ
                        </Button>
                        <Button variant="ghost" size="sm" className="text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20" onClick={() => setStatus(q.id, 'REJECTED')}>
                          Отклонить
                        </Button>
                        <Button variant="ghost" size="sm" className="text-slate-400 hover:text-rose-600 dark:text-slate-500" onClick={() => remove(q.id)}>
                          Удалить
                        </Button>
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
        </Card>
      </div>
    </div>
  );
}

export default function QuotesPage() {
  return (
    <FeatureGate flag="feature.quotes">
      <QuotesInner />
    </FeatureGate>
  );
}
