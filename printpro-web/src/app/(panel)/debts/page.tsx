'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import {
  PageHeader,
  StatGrid,
  StatCard,
  TableCard,
  Toolbar,
  SectionTitle,
  Field,
  Input,
  Select,
  Button,
  EmptyState,
} from '@/components/ui';
import NavIcon from '@/lib/NavIcons';

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(n) + ' c.';
}

function fmtDate(s?: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('ru-RU');
}

// YYYY-MM-DD для <input type="date">
function toDateInput(s?: string | null) {
  if (!s) return '';
  const d = new Date(s);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

const CLIENT_METHODS = [
  { value: 'CASH', label: 'Наличные' },
  { value: 'CARD', label: 'Карта' },
  { value: 'QR', label: 'QR' },
  { value: 'TRANSFER', label: 'Перевод' },
];

export default function DebtsPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const canPay = can('cash.operate');
  const canPaySupplier = can('stock.manage');

  const [clientDebts, setClientDebts] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);

  // Приём оплаты долга клиента
  const [payClient, setPayClient] = useState<any | null>(null);
  const [cAmount, setCAmount] = useState('');
  const [cMethod, setCMethod] = useState('CASH');
  const [cMsg, setCMsg] = useState('');

  // Оплата долга поставщику
  const [paySupplier, setPaySupplier] = useState<any | null>(null);
  const [sAmount, setSAmount] = useState('');
  const [sMsg, setSMsg] = useState('');

  // Срок погашения долга клиента
  const [dueTarget, setDueTarget] = useState<any | null>(null);
  const [dueVal, setDueVal] = useState('');
  const [dueMsg, setDueMsg] = useState('');

  function load() {
    api.get(`/orders/debts?companyId=${cid}`).then(setClientDebts).catch(() => {});
    api.get(`/purchasing/suppliers?companyId=${cid}`).then(setSuppliers).catch(() => {});
  }
  useEffect(load, [cid]);

  const supplierDebts = suppliers.filter((s) => Number(s.debt) > 0);
  const clientTotal = clientDebts.reduce((s, d) => s + Number(d.debt || 0), 0);
  const supplierTotal = supplierDebts.reduce((s, d) => s + Number(d.debt || 0), 0);

  // ---- оплата клиента ----
  function openClient(d: any) {
    setPayClient(d);
    setCAmount(String(Number(d.debt) || ''));
    setCMethod('CASH');
    setCMsg('');
  }
  async function submitClient(e: React.FormEvent) {
    e.preventDefault();
    if (!payClient) return;
    const amount = Number(cAmount);
    const debt = Number(payClient.debt) || 0;
    if (!amount || amount <= 0) {
      setCMsg('Введите сумму больше нуля');
      return;
    }
    if (amount > debt + 0.01) {
      setCMsg(`Сумма больше долга (${money(debt)})`);
      return;
    }
    try {
      await api.post(`/orders/${payClient.orderId}/payments`, { amount, method: cMethod });
      setPayClient(null);
      load();
    } catch (err: any) {
      setCMsg('Ошибка: ' + err.message);
    }
  }

  // ---- срок погашения ----
  function openDue(d: any) {
    setDueTarget(d);
    setDueVal(toDateInput(d.dueDate));
    setDueMsg('');
  }
  async function submitDue(e: React.FormEvent) {
    e.preventDefault();
    if (!dueTarget) return;
    try {
      await api.patch(`/orders/${dueTarget.orderId}/debt-due`, {
        dueDate: dueVal || null,
      });
      setDueTarget(null);
      load();
    } catch (err: any) {
      setDueMsg('Ошибка: ' + err.message);
    }
  }

  // ---- оплата поставщика ----
  function openSupplier(s: any) {
    setPaySupplier(s);
    setSAmount(String(Number(s.debt) || ''));
    setSMsg('');
  }
  async function submitSupplier(e: React.FormEvent) {
    e.preventDefault();
    if (!paySupplier) return;
    const amount = Number(sAmount);
    const debt = Number(paySupplier.debt) || 0;
    if (!amount || amount <= 0) {
      setSMsg('Введите сумму больше нуля');
      return;
    }
    if (amount > debt + 0.01) {
      setSMsg(`Сумма больше долга (${money(debt)})`);
      return;
    }
    try {
      await api.post(`/purchasing/suppliers/${paySupplier.id}/pay-debt`, { amount });
      setPaySupplier(null);
      load();
    } catch (err: any) {
      setSMsg('Ошибка: ' + err.message);
    }
  }

  return (
    <div>
      <PageHeader icon="alert" title="Долги" subtitle="Кто должен нам (клиенты) и кому должны мы (поставщики)" />

      <StatGrid cols={2}>
        <StatCard
          icon="clients"
          tone="rose"
          label="Долги клиентов (нам должны)"
          value={money(clientTotal)}
          sub={`${clientDebts.length} заказ(ов)`}
          highlight
        />
        <StatCard
          icon="purchasing"
          tone="amber"
          label="Долги поставщикам (мы должны)"
          value={money(supplierTotal)}
          sub={`${supplierDebts.length} поставщик(ов)`}
        />
      </StatGrid>

      {/* ============ ДОЛГИ КЛИЕНТОВ ============ */}
      <TableCard className="mb-6">
        <Toolbar>
          <SectionTitle className="mb-0">Долги клиентов — нам должны</SectionTitle>
        </Toolbar>
        {clientDebts.length === 0 ? (
          <EmptyState icon="check" title="Долгов клиентов нет" hint="Все заказы оплачены." />
        ) : (
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Заказ</th>
                  <th>Клиент</th>
                  <th>Телефон</th>
                  <th className="text-right">Сумма</th>
                  <th className="text-right">Долг</th>
                  <th>Срок</th>
                  {canPay && <th className="text-right">Действие</th>}
                </tr>
              </thead>
              <tbody>
                {clientDebts.map((d) => (
                  <tr key={d.orderId} className={d.overdue ? 'bg-rose-50/60 dark:bg-rose-500/10' : ''}>
                    <td className="font-medium text-slate-700 dark:text-slate-200">{d.orderNumber}</td>
                    <td className="text-slate-700 dark:text-slate-200">{d.client}</td>
                    <td className="text-slate-500 dark:text-slate-400">{d.phone || '—'}</td>
                    <td className="text-right text-slate-500 dark:text-slate-400">{money(Number(d.total))}</td>
                    <td className="text-right font-semibold text-rose-600 dark:text-rose-400">{money(Number(d.debt))}</td>
                    <td>
                      {d.dueDate ? (
                        <span className={d.overdue ? 'font-semibold text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}>
                          {fmtDate(d.dueDate)}{d.overdue ? ' · просрочено' : ''}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    {canPay && (
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openDue(d)} title="Срок погашения">Срок</Button>
                          <Button size="sm" variant="ghost" onClick={() => openClient(d)}>Принять оплату</Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>

      {/* ============ ДОЛГИ ПОСТАВЩИКАМ ============ */}
      <TableCard>
        <Toolbar>
          <SectionTitle className="mb-0">Долги поставщикам — мы должны</SectionTitle>
        </Toolbar>
        {supplierDebts.length === 0 ? (
          <EmptyState icon="check" title="Долгов поставщикам нет" hint="Все приёмки оплачены." />
        ) : (
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Поставщик</th>
                  <th>Телефон</th>
                  <th className="text-right">Долг</th>
                  {canPaySupplier && <th className="text-right">Действие</th>}
                </tr>
              </thead>
              <tbody>
                {supplierDebts.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium text-slate-700 dark:text-slate-200">{s.name}</td>
                    <td className="text-slate-500 dark:text-slate-400">{s.phone || '—'}</td>
                    <td className="text-right font-semibold text-amber-600 dark:text-amber-400">{money(Number(s.debt))}</td>
                    {canPaySupplier && (
                      <td className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => openSupplier(s)}>Оплатить</Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>

      {/* ===================== ОПЛАТА ДОЛГА КЛИЕНТА ===================== */}
      {payClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={() => setPayClient(null)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Приём оплаты</h3>
              <button onClick={() => setPayClient(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <NavIcon name="close" className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/40">
              <div className="font-medium text-slate-700 dark:text-slate-200">{payClient.orderNumber} — {payClient.client}</div>
              <div className="mt-0.5 text-rose-600 dark:text-rose-400">Долг: <b>{money(Number(payClient.debt) || 0)}</b></div>
            </div>

            <form onSubmit={submitClient} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Сумма">
                  <Input value={cAmount} onChange={(e) => setCAmount(e.target.value)} type="number" step="0.01" min="0" autoFocus required />
                </Field>
                <Field label="Способ">
                  <Select value={cMethod} onChange={(e) => setCMethod(e.target.value)}>
                    {CLIENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </Select>
                </Field>
              </div>
              {cMsg && <p className="text-sm text-rose-600">{cMsg}</p>}
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setPayClient(null)} className="flex-1">Отмена</Button>
                <Button type="submit" variant="emerald" className="flex-1">Принять</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================== СРОК ПОГАШЕНИЯ ДОЛГА ===================== */}
      {dueTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={() => setDueTarget(null)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Срок погашения долга</h3>
              <button onClick={() => setDueTarget(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <NavIcon name="close" className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/40">
              <div className="font-medium text-slate-700 dark:text-slate-200">{dueTarget.orderNumber} — {dueTarget.client}</div>
              <div className="mt-0.5 text-rose-600 dark:text-rose-400">Долг: <b>{money(Number(dueTarget.debt) || 0)}</b></div>
            </div>

            <form onSubmit={submitDue} className="space-y-3">
              <Field label="Оплатить до">
                <Input value={dueVal} onChange={(e) => setDueVal(e.target.value)} type="date" autoFocus />
              </Field>
              <p className="-mt-1 text-xs text-slate-400">Просроченные долги подсветятся и попадут в напоминания. Пусто — убрать срок.</p>
              {dueMsg && <p className="text-sm text-rose-600">{dueMsg}</p>}
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setDueTarget(null)} className="flex-1">Отмена</Button>
                <Button type="submit" variant="emerald" className="flex-1">Сохранить</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================== ОПЛАТА ДОЛГА ПОСТАВЩИКУ ===================== */}
      {paySupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={() => setPaySupplier(null)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Оплата поставщику</h3>
              <button onClick={() => setPaySupplier(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <NavIcon name="close" className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/40">
              <div className="font-medium text-slate-700 dark:text-slate-200">{paySupplier.name}</div>
              <div className="mt-0.5 text-amber-600 dark:text-amber-400">Долг: <b>{money(Number(paySupplier.debt) || 0)}</b></div>
            </div>

            <form onSubmit={submitSupplier} className="space-y-3">
              <Field label="Сумма оплаты">
                <Input value={sAmount} onChange={(e) => setSAmount(e.target.value)} type="number" step="0.01" min="0" autoFocus required />
              </Field>
              <p className="-mt-1 text-xs text-slate-400">Спишется из кассы (расход) и уменьшит долг поставщику.</p>
              {sMsg && <p className="text-sm text-rose-600">{sMsg}</p>}
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setPaySupplier(null)} className="flex-1">Отмена</Button>
                <Button type="submit" variant="emerald" className="flex-1">Оплатить</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
