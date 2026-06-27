'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(n) + ' c.';
}

const TYPE_LABELS: Record<string, string> = {
  INDIVIDUAL: 'Физлицо',
  COMPANY: 'Компания',
  REGULAR: 'Постоянный',
  VIP: 'VIP',
};
const TYPE_COLORS: Record<string, string> = {
  INDIVIDUAL: 'bg-slate-100 text-slate-600',
  COMPANY: 'bg-sky-100 text-sky-700',
  REGULAR: 'bg-emerald-100 text-emerald-700',
  VIP: 'bg-amber-100 text-amber-700',
};
const STATUS_LABELS: Record<string, string> = {
  ACCEPTED: 'Новый',
  AWAITING_DESIGN: 'Ожидает макет',
  IN_DESIGN: 'В дизайне',
  DESIGN_APPROVAL: 'На согласовании',
  DESIGN_APPROVED: 'Согласован',
  IN_PROGRESS: 'В производстве',
  READY: 'Готов',
  DELIVERED: 'Выдан',
  REWORK: 'Переделка',
  CANCELLED: 'Отменён',
};

export default function ClientsPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const canManage = can('clients.manage');

  const [list, setList] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<any | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Форма
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [type, setType] = useState('INDIVIDUAL');
  const [email, setEmail] = useState('');
  const [discount, setDiscount] = useState('');
  const [msg, setMsg] = useState('');

  function load() {
    const q = search ? `&search=${encodeURIComponent(search)}` : '';
    api.get(`/clients?companyId=${cid}${q}`).then(setList).catch(() => {});
  }
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [cid, search]);

  async function openClient(id: string) {
    const full = await api.get(`/clients/${id}`);
    setSelected(full);
    setShowForm(false);
  }

  async function createClient(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await api.post('/clients', {
        companyId: cid,
        phone,
        fullName: fullName || undefined,
        type,
        email: email || undefined,
        discount: discount ? Number(discount) : undefined,
      });
      setFullName('');
      setPhone('');
      setEmail('');
      setDiscount('');
      setType('INDIVIDUAL');
      setShowForm(false);
      setMsg('');
      load();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Клиенты</h1>
        {canManage && (
          <button
            onClick={() => {
              setShowForm((v) => !v);
              setSelected(null);
            }}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            {showForm ? 'Отмена' : '+ Новый клиент'}
          </button>
        )}
      </div>

      {/* Форма нового клиента */}
      {showForm && canManage && (
        <div className="mb-6 rounded-2xl bg-white p-5 shadow-sm">
          <form onSubmit={createClient} className="grid gap-3 md:grid-cols-2">
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="ФИО / название"
              className="rounded-lg border border-slate-300 px-3 py-2"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Телефон *"
              required
              className="rounded-lg border border-slate-300 px-3 py-2"
            />
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2"
            >
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="Email"
              className="rounded-lg border border-slate-300 px-3 py-2"
            />
            <input
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              type="number"
              min="0"
              max="100"
              placeholder="Скидка, %"
              className="rounded-lg border border-slate-300 px-3 py-2"
            />
            <button className="rounded-lg bg-emerald-600 px-5 py-2 font-medium text-white hover:bg-emerald-700">
              Сохранить
            </button>
          </form>
          {msg && <p className="mt-2 text-sm text-rose-600">{msg}</p>}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Список */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по имени или телефону…"
            className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          {list.length === 0 ? (
            <p className="text-slate-400">Клиентов не найдено.</p>
          ) : (
            <div className="space-y-1">
              {list.map((c) => (
                <button
                  key={c.id}
                  onClick={() => openClient(c.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-slate-50 ${
                    selected?.id === c.id ? 'bg-indigo-50' : ''
                  }`}
                >
                  <span>
                    <span className="font-medium text-slate-800">
                      {c.fullName ?? 'Без имени'}
                    </span>
                    <span className="ml-2 text-slate-400">{c.phone}</span>
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${TYPE_COLORS[c.type]}`}
                  >
                    {TYPE_LABELS[c.type]}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Карточка клиента */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          {!selected ? (
            <p className="text-slate-400">Выберите клиента слева.</p>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-800">
                  {selected.fullName ?? 'Без имени'}
                </h2>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs ${TYPE_COLORS[selected.type]}`}
                >
                  {TYPE_LABELS[selected.type]}
                </span>
              </div>

              <div className="mb-4 space-y-1 text-sm text-slate-600">
                <div>📞 {selected.phone}</div>
                {selected.email && <div>✉ {selected.email}</div>}
                {selected.address && <div>📍 {selected.address}</div>}
                {selected.inn && <div>ИНН: {selected.inn}</div>}
                {selected.discount > 0 && (
                  <div className="text-emerald-600">Скидка: {selected.discount}%</div>
                )}
              </div>

              {/* Статистика */}
              <div className="mb-4 grid grid-cols-3 gap-2">
                <Stat label="Заказов" value={String(selected.stats.ordersCount)} />
                <Stat label="Потрачено" value={money(selected.stats.totalSpent)} />
                <Stat
                  label="Долг"
                  value={money(selected.stats.totalDebt)}
                  danger={selected.stats.totalDebt > 0}
                />
              </div>

              {/* История заказов */}
              <h3 className="mb-2 text-sm font-semibold text-slate-700">
                История заказов
              </h3>
              {selected.orders.length === 0 ? (
                <p className="text-sm text-slate-400">Заказов нет.</p>
              ) : (
                <div className="max-h-64 space-y-1 overflow-auto">
                  {selected.orders.map((o: any) => (
                    <div
                      key={o.id}
                      className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0"
                    >
                      <span className="text-slate-600">
                        №{o.orderNumber} ·{' '}
                        <span className="text-slate-400">
                          {STATUS_LABELS[o.status]}
                        </span>
                      </span>
                      <span>
                        <span className="text-slate-700">{money(Number(o.total))}</span>
                        {Number(o.balanceDue) > 0 && (
                          <span className="ml-2 text-rose-600">
                            долг {money(Number(o.balanceDue))}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 text-center">
      <div className={`font-bold ${danger ? 'text-rose-600' : 'text-slate-800'}`}>
        {value}
      </div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
