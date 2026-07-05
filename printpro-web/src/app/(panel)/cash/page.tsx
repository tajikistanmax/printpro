'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  PageHeader,
  StatGrid,
  StatCard,
  Card,
  TableCard,
  SectionTitle,
  Field,
  Input,
  Select,
  Button,
  Badge,
  EmptyState,
} from '@/components/ui';
import NavIcon from '@/lib/NavIcons';

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

  const load = useCallback(() => {
    setLoading(true);
    api
      .get('/cash/current')
      .then((s) => setShift(s))
      .catch(() => setShift(null))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const id = setTimeout(load, 0);
    return () => clearTimeout(id);
  }, [load]);

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
    return <EmptyState title="Загрузка…" />;
  }

  // ---------- Смена не открыта ----------
  if (!shift) {
    return (
      <div>
        <PageHeader icon="cash" title="Касса" subtitle="Смена закрыта" />
        <Card>
          <div className="mb-4 flex items-center gap-3 text-slate-600 dark:text-slate-300">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-800"><NavIcon name="lock" className="h-6 w-6" /></span>
            <div>
              <div className="font-semibold text-slate-800 dark:text-slate-100">Смена закрыта</div>
              <div className="text-sm text-slate-500 dark:text-slate-400">
                Откройте смену, чтобы принимать оплаты.
              </div>
            </div>
          </div>
          {canOperate ? (
            <form onSubmit={openShift} className="flex flex-wrap items-end gap-3">
              <Field label="Наличные в кассе на старте" className="min-w-[200px]">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={opening}
                  onChange={(e) => setOpening(e.target.value)}
                  placeholder="0"
                />
              </Field>
              <Button type="submit" variant="emerald">Открыть смену</Button>
              {msg && <span className="text-sm text-rose-600">{msg}</span>}
            </form>
          ) : (
            <p className="text-sm text-slate-400 dark:text-slate-500">
              Недостаточно прав для открытия смены.
            </p>
          )}
        </Card>
      </div>
    );
  }

  // ---------- Смена открыта ----------
  const s = shift.summary;
  const cards = [
    { label: 'Наличные', value: s.cash, tone: 'emerald' as const },
    { label: 'Карта', value: s.card, tone: 'indigo' as const },
    { label: 'QR', value: s.qr, tone: 'violet' as const },
    { label: 'Перевод', value: s.transfer, tone: 'sky' as const },
    { label: 'В долг', value: s.debt, tone: 'rose' as const },
  ];

  return (
    <div>
      <PageHeader
        icon="cash"
        title="Касса"
        subtitle={`Смена ${shift.number ? `${shift.number} · ` : ''}открыта · ${shift.user}`}
        actions={
          <>
            <Button variant="ghost" onClick={() => setShowX(true)}><NavIcon name="print" className="h-4 w-4" />X-отчёт</Button>
            <Badge tone="emerald">
              ● Смена {shift.number ? `${shift.number} · ` : ''}открыта · {shift.user}
            </Badge>
          </>
        }
      />

      {/* X-отчёт — промежуточный, без закрытия смены */}
      {showX && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-80 rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl">
            <div className="print-area">
              <div className="text-center">
                <div className="text-lg font-bold text-slate-800 dark:text-slate-100">PrintPro</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">X-отчёт (промежуточный)</div>
              </div>
              <div className="my-3 border-y border-dashed border-slate-300 dark:border-slate-600 py-2 text-xs text-slate-700 dark:text-slate-200">
                {shift.number && <Line2 l="Смена" r={shift.number} />}
                <Line2 l="Кассир" r={shift.user} />
                {shift.branch && <Line2 l="Филиал" r={shift.branch} />}
                <Line2
                  l="Открыта"
                  r={new Date(shift.openedAt).toLocaleString('ru-RU')}
                />
                <Line2 l="Напечатан" r={new Date().toLocaleString('ru-RU')} />
              </div>
              <div className="space-y-1 text-sm text-slate-700 dark:text-slate-200">
                <Line2 l="Наличные" r={money(s.cash)} />
                <Line2 l="Карта" r={money(s.card)} />
                <Line2 l="QR" r={money(s.qr)} />
                <Line2 l="Перевод" r={money(s.transfer)} />
                <Line2 l="В долг" r={money(s.debt)} />
                <Line2 l="Внесения" r={money(s.movementsIn)} />
                <Line2 l="Изъятия" r={money(s.movementsOut)} />
              </div>
              <div className="mt-3 border-t border-dashed border-slate-300 dark:border-slate-600 pt-2 text-sm">
                <div className="flex justify-between font-bold text-slate-800 dark:text-slate-100">
                  <span>Выручка деньгами</span>
                  <span>{money(s.totalRevenue)}</span>
                </div>
                <div className="flex justify-between font-bold text-slate-800 dark:text-slate-100">
                  <span>Наличных в кассе</span>
                  <span>{money(s.expectedCash)}</span>
                </div>
              </div>
              <div className="mt-3 text-center text-xs text-slate-400 dark:text-slate-500">
                Смена не закрыта
              </div>
            </div>
            <div className="no-print mt-5 flex gap-2">
              <Button onClick={() => window.print()} className="flex-1"><NavIcon name="print" className="h-4 w-4" />Печать</Button>
              <Button variant="ghost" onClick={() => setShowX(false)} className="flex-1">Закрыть</Button>
            </div>
          </div>
        </div>
      )}

      {/* Главная цифра + способы оплаты */}
      <StatGrid cols={3}>
        <StatCard
          icon="cash"
          label="Наличных в кассе (расчёт)"
          value={money(s.expectedCash)}
          sub={`старт ${money(s.openingBalance)}`}
          highlight
        />
        <StatCard
          icon="reports"
          tone="indigo"
          label="Выручка деньгами"
          value={money(s.totalRevenue)}
          sub={`${s.paymentsCount} оплат(ы)`}
        />
        <StatCard
          icon="quotes"
          tone="amber"
          label="Внесения / изъятия"
          value={`+${money(s.movementsIn)} / −${money(s.movementsOut)}`}
        />
      </StatGrid>

      {/* Способы оплаты */}
      <StatGrid cols={4}>
        {cards.map((c) => (
          <StatCard key={c.label} tone={c.tone} label={c.label} value={money(c.value)} />
        ))}
      </StatGrid>

      {canOperate && (
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          {/* Внести / изъять */}
          <Card>
            <SectionTitle>Внести / изъять деньги</SectionTitle>
            <form onSubmit={addMovement} className="flex flex-wrap items-end gap-3">
              <Field label="Тип" className="min-w-[120px]">
                <Select
                  value={moveType}
                  onChange={(e) => setMoveType(e.target.value as 'IN' | 'OUT')}
                >
                  <option value="OUT">Изъятие (−)</option>
                  <option value="IN">Внесение (+)</option>
                </Select>
              </Field>
              <Field label="Сумма" className="min-w-[120px]">
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={moveAmount}
                  onChange={(e) => setMoveAmount(e.target.value)}
                  required
                />
              </Field>
              {moveType === 'OUT' && (
                <Field label="Категория" className="min-w-[150px]">
                  <Input
                    value={moveCategory}
                    onChange={(e) => setMoveCategory(e.target.value)}
                    list="expense-cats"
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
                </Field>
              )}
              <Field label="Причина" className="min-w-[160px] flex-1">
                <Input
                  value={moveReason}
                  onChange={(e) => setMoveReason(e.target.value)}
                  placeholder="напр. сдача в банк"
                />
              </Field>
              <Button type="submit" variant="ghost">Записать</Button>
            </form>
            {msg && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{msg}</p>}
          </Card>

          {/* Закрытие смены */}
          <Card>
            <SectionTitle>Закрытие смены</SectionTitle>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Пересчитано наличными (факт)" className="min-w-[160px] flex-1">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={counted}
                  onChange={(e) => setCounted(e.target.value)}
                  placeholder={String(s.expectedCash)}
                />
              </Field>
              <Button variant="danger" onClick={closeShift}>Закрыть смену</Button>
            </div>
            <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
              Расчётный остаток: {money(s.expectedCash)}. Если факт отличается —
              впишите реальную сумму.
            </p>
          </Card>
        </div>
      )}

      {/* Операции */}
      <div className="grid gap-4 md:grid-cols-2">
        <TableCard>
          <Toolbar2 title="Оплаты" />
          {shift.payments.length === 0 ? (
            <EmptyState icon="cash" title="Оплат пока нет" />
          ) : (
            <div className="pp-table-scroll">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th>Операция</th>
                    <th>Способ</th>
                    <th className="text-right">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {shift.payments.map((p: any) => (
                    <tr key={p.id}>
                      <td className="font-medium text-slate-700 dark:text-slate-200">
                        {p.orderNumber ? `Заказ №${p.orderNumber}` : 'Оплата'}
                      </td>
                      <td>
                        <Badge tone="slate">{METHOD_LABELS[p.method]}</Badge>
                      </td>
                      <td className="text-right font-semibold text-slate-800 dark:text-slate-100">
                        {money(p.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TableCard>

        <TableCard>
          <Toolbar2 title="Движения денег" />
          {shift.movements.length === 0 ? (
            <EmptyState icon="cash" title="Движений пока нет" />
          ) : (
            <div className="pp-table-scroll">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th>Категория</th>
                    <th>Причина</th>
                    <th className="text-right">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {shift.movements.map((m: any) => (
                    <tr key={m.id}>
                      <td>
                        {m.category ? (
                          <Badge tone="slate">{m.category}</Badge>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="text-slate-600 dark:text-slate-300">
                        {m.reason || (m.type === 'IN' ? 'Внесение' : 'Изъятие')}
                      </td>
                      <td
                        className={`text-right font-semibold ${
                          m.type === 'IN' ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {m.type === 'IN' ? '+' : '−'}
                        {money(m.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TableCard>
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

function Toolbar2({ title }: { title: string }) {
  return (
    <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-700/60">
      <h2 className="font-semibold text-slate-700 dark:text-slate-200">{title}</h2>
    </div>
  );
}
