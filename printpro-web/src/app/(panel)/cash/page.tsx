'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Наличные',
  CARD: 'Карта',
  QR: 'QR',
  TRANSFER: 'Перевод',
  DEBT: 'В долг',
};

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(n) + ' c.';
}

export default function CashPage() {
  const { can } = useAuth();
  const canOperate = can('cash.operate');

  const [shift, setShift] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  // Формы
  const [opening, setOpening] = useState('');
  const [moveType, setMoveType] = useState<'IN' | 'OUT'>('OUT');
  const [moveAmount, setMoveAmount] = useState('');
  const [moveCategory, setMoveCategory] = useState('');
  const [moveReason, setMoveReason] = useState('');
  const [counted, setCounted] = useState('');
  const [showX, setShowX] = useState(false);

  function load() {
    setLoading(true);
    api
      .get('/cash/current')
      .then((s) => setShift(s))
      .catch(() => setShift(null))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
  }, []);

  async function openShift(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await api.post('/cash/shifts/open', {
        openingBalance: opening ? Number(opening) : 0,
      });
      setOpening('');
      load();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function addMovement(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      const updated = await api.post('/cash/movements', {
        type: moveType,
        amount: Number(moveAmount),
        category: moveType === 'OUT' ? moveCategory || undefined : undefined,
        reason: moveReason || undefined,
      });
      setShift(updated);
      setMoveAmount('');
      setMoveReason('');
      setMsg('✓ Движение записано');
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function closeShift() {
    if (!confirm('Закрыть смену? Касса будет закрыта.')) return;
    setMsg('');
    try {
      await api.post(`/cash/shifts/${shift.id}/close`, {
        countedBalance: counted ? Number(counted) : undefined,
      });
      setCounted('');
      load();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  if (loading) {
    return <p className="text-slate-400">Загрузка…</p>;
  }

  // ---------- Смена не открыта ----------
  if (!shift) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold text-slate-800">Касса</h1>
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-3 text-slate-600">
            <span className="text-3xl">🔒</span>
            <div>
              <div className="font-semibold text-slate-800">Смена закрыта</div>
              <div className="text-sm text-slate-500">
                Откройте смену, чтобы принимать оплаты.
              </div>
            </div>
          </div>
          {canOperate ? (
            <form onSubmit={openShift} className="flex flex-wrap items-end gap-3">
              <div className="min-w-[200px]">
                <label className="mb-1 block text-sm text-slate-500">
                  Наличные в кассе на старте
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={opening}
                  onChange={(e) => setOpening(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="0"
                />
              </div>
              <button className="rounded-lg bg-emerald-600 px-5 py-2 font-medium text-white hover:bg-emerald-700">
                Открыть смену
              </button>
              {msg && <span className="text-sm text-rose-600">{msg}</span>}
            </form>
          ) : (
            <p className="text-sm text-slate-400">
              Недостаточно прав для открытия смены.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ---------- Смена открыта ----------
  const s = shift.summary;
  const cards = [
    { label: 'Наличные', value: s.cash, color: 'text-emerald-600' },
    { label: 'Карта', value: s.card, color: 'text-indigo-600' },
    { label: 'QR', value: s.qr, color: 'text-violet-600' },
    { label: 'Перевод', value: s.transfer, color: 'text-sky-600' },
    { label: 'В долг', value: s.debt, color: 'text-rose-600' },
  ];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Касса</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowX(true)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            🖨 X-отчёт
          </button>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-700">
            ● Смена открыта · {shift.user}
          </span>
        </div>
      </div>

      {/* X-отчёт — промежуточный, без закрытия смены */}
      {showX && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-80 rounded-2xl bg-white p-6 shadow-2xl">
            <div className="print-area">
              <div className="text-center">
                <div className="text-lg font-bold">PrintPro</div>
                <div className="text-xs text-slate-500">X-отчёт (промежуточный)</div>
              </div>
              <div className="my-3 border-y border-dashed border-slate-300 py-2 text-xs">
                <Line2 l="Кассир" r={shift.user} />
                {shift.branch && <Line2 l="Филиал" r={shift.branch} />}
                <Line2
                  l="Открыта"
                  r={new Date(shift.openedAt).toLocaleString('ru-RU')}
                />
                <Line2 l="Напечатан" r={new Date().toLocaleString('ru-RU')} />
              </div>
              <div className="space-y-1 text-sm">
                <Line2 l="Наличные" r={money(s.cash)} />
                <Line2 l="Карта" r={money(s.card)} />
                <Line2 l="QR" r={money(s.qr)} />
                <Line2 l="Перевод" r={money(s.transfer)} />
                <Line2 l="В долг" r={money(s.debt)} />
                <Line2 l="Внесения" r={money(s.movementsIn)} />
                <Line2 l="Изъятия" r={money(s.movementsOut)} />
              </div>
              <div className="mt-3 border-t border-dashed border-slate-300 pt-2 text-sm">
                <div className="flex justify-between font-bold">
                  <span>Выручка деньгами</span>
                  <span>{money(s.totalRevenue)}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>Наличных в кассе</span>
                  <span>{money(s.expectedCash)}</span>
                </div>
              </div>
              <div className="mt-3 text-center text-xs text-slate-400">
                Смена не закрыта
              </div>
            </div>
            <div className="no-print mt-5 flex gap-2">
              <button
                onClick={() => window.print()}
                className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                🖨 Печать
              </button>
              <button
                onClick={() => setShowX(false)}
                className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Итоги */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="text-sm text-slate-500">{c.label}</div>
            <div className={`text-xl font-bold ${c.color}`}>{money(c.value)}</div>
          </div>
        ))}
      </div>

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">Выручка деньгами</div>
          <div className="text-xl font-bold text-slate-800">
            {money(s.totalRevenue)}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            {s.paymentsCount} оплат(ы)
          </div>
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">Внесения / изъятия</div>
          <div className="text-xl font-bold text-slate-800">
            +{money(s.movementsIn)} / −{money(s.movementsOut)}
          </div>
        </div>
        <div className="rounded-2xl bg-indigo-600 p-4 text-white shadow-sm">
          <div className="text-sm text-indigo-100">Наличных в кассе (расчёт)</div>
          <div className="text-2xl font-bold">{money(s.expectedCash)}</div>
          <div className="mt-1 text-xs text-indigo-200">
            старт {money(s.openingBalance)}
          </div>
        </div>
      </div>

      {canOperate && (
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          {/* Внести / изъять */}
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-slate-700">
              Внести / изъять деньги
            </h2>
            <form onSubmit={addMovement} className="flex flex-wrap items-end gap-3">
              <div className="min-w-[120px]">
                <label className="mb-1 block text-sm text-slate-500">Тип</label>
                <select
                  value={moveType}
                  onChange={(e) => setMoveType(e.target.value as 'IN' | 'OUT')}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="OUT">Изъятие (−)</option>
                  <option value="IN">Внесение (+)</option>
                </select>
              </div>
              <div className="min-w-[120px]">
                <label className="mb-1 block text-sm text-slate-500">Сумма</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={moveAmount}
                  onChange={(e) => setMoveAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  required
                />
              </div>
              {moveType === 'OUT' && (
                <div className="min-w-[150px]">
                  <label className="mb-1 block text-sm text-slate-500">
                    Категория
                  </label>
                  <input
                    value={moveCategory}
                    onChange={(e) => setMoveCategory(e.target.value)}
                    list="expense-cats"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    placeholder="Расход"
                  />
                  <datalist id="expense-cats">
                    <option value="Аренда" />
                    <option value="Зарплата" />
                    <option value="Материалы" />
                    <option value="Коммунальные" />
                    <option value="Реклама" />
                    <option value="Инкассация" />
                    <option value="Прочее" />
                  </datalist>
                </div>
              )}
              <div className="min-w-[160px] flex-1">
                <label className="mb-1 block text-sm text-slate-500">Причина</label>
                <input
                  value={moveReason}
                  onChange={(e) => setMoveReason(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="напр. сдача в банк"
                />
              </div>
              <button className="rounded-lg bg-slate-700 px-5 py-2 font-medium text-white hover:bg-slate-800">
                Записать
              </button>
            </form>
            {msg && <p className="mt-2 text-sm text-slate-600">{msg}</p>}
          </div>

          {/* Закрытие смены */}
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-slate-700">Закрытие смены</h2>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[160px] flex-1">
                <label className="mb-1 block text-sm text-slate-500">
                  Пересчитано наличными (факт)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={counted}
                  onChange={(e) => setCounted(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder={String(s.expectedCash)}
                />
              </div>
              <button
                onClick={closeShift}
                className="rounded-lg bg-rose-600 px-5 py-2 font-medium text-white hover:bg-rose-700"
              >
                Закрыть смену
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Расчётный остаток: {money(s.expectedCash)}. Если факт отличается —
              впишите реальную сумму.
            </p>
          </div>
        </div>
      )}

      {/* Операции */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-slate-700">Оплаты</h2>
          {shift.payments.length === 0 ? (
            <p className="text-sm text-slate-400">Оплат пока нет.</p>
          ) : (
            <div className="space-y-1.5">
              {shift.payments.map((p: any) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-slate-600">
                    {p.orderNumber ? `Заказ №${p.orderNumber}` : 'Оплата'} ·{' '}
                    <span className="text-slate-400">
                      {METHOD_LABELS[p.method]}
                    </span>
                  </span>
                  <span className="font-medium text-slate-800">
                    {money(p.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-slate-700">Движения денег</h2>
          {shift.movements.length === 0 ? (
            <p className="text-sm text-slate-400">Движений пока нет.</p>
          ) : (
            <div className="space-y-1.5">
              {shift.movements.map((m: any) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-slate-600">
                    {m.category && (
                      <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                        {m.category}
                      </span>
                    )}
                    {m.reason || (m.type === 'IN' ? 'Внесение' : 'Изъятие')}
                  </span>
                  <span
                    className={`font-medium ${
                      m.type === 'IN' ? 'text-emerald-600' : 'text-rose-600'
                    }`}
                  >
                    {m.type === 'IN' ? '+' : '−'}
                    {money(m.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Line2({ l, r }: { l: string; r: string }) {
  return (
    <div className="flex justify-between">
      <span>{l}</span>
      <span>{r}</span>
    </div>
  );
}
