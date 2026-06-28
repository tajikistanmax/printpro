'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(n) + ' c.';
}

export default function PayrollPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const canManage = can('payroll.manage');

  const [staff, setStaff] = useState<any[]>([]);
  const [periods, setPeriods] = useState<any[]>([]);
  const [periodId, setPeriodId] = useState('');
  const [records, setRecords] = useState<any[]>([]);
  const [msg, setMsg] = useState('');

  // Новый период
  const [pName, setPName] = useState('');
  const [pStart, setPStart] = useState('');
  const [pEnd, setPEnd] = useState('');

  // Аванс / время
  const [aUser, setAUser] = useState('');
  const [aAmount, setAAmount] = useState('');
  const [wUser, setWUser] = useState('');
  const [wHours, setWHours] = useState('');

  function loadBase() {
    api.get(`/payroll/staff?companyId=${cid}`).then(setStaff).catch(() => {});
    api
      .get(`/payroll/periods?companyId=${cid}`)
      .then((p) => {
        setPeriods(p);
        if (p[0] && !periodId) setPeriodId(p[0].id);
      })
      .catch(() => {});
  }
  useEffect(loadBase, [cid]);

  function loadRecords() {
    if (!periodId) return setRecords([]);
    api.get(`/payroll/periods/${periodId}/records`).then(setRecords).catch(() => {});
  }
  useEffect(loadRecords, [periodId]);

  async function saveSalary(u: any, salaryType: string, rate: string) {
    await api.patch(`/payroll/staff/${u.id}`, {
      salaryType,
      rate: Number(rate) || 0,
    });
    loadBase();
  }

  async function createPeriod(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      const p = await api.post('/payroll/periods', {
        companyId: cid,
        name: pName,
        startDate: pStart,
        endDate: pEnd,
      });
      setPName('');
      setPStart('');
      setPEnd('');
      setPeriodId(p.id);
      loadBase();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function calculate() {
    setMsg('');
    try {
      const recs = await api.post(`/payroll/periods/${periodId}/calculate`);
      setRecords(recs);
      setMsg('✓ Рассчитано');
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function setBonus(id: string, field: 'bonus' | 'deduction', value: string) {
    await api.patch(`/payroll/records/${id}`, { [field]: Number(value) || 0 });
    loadRecords();
  }

  async function pay(id: string) {
    if (!confirm('Выплатить зарплату? Сумма спишется из кассы.')) return;
    await api.post(`/payroll/records/${id}/pay`);
    loadRecords();
  }

  async function addAdvance(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await api.post('/payroll/advances', {
        companyId: cid,
        userId: aUser || staff[0]?.id,
        amount: Number(aAmount),
      });
      setAAmount('');
      setMsg('✓ Аванс записан');
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function addWorkTime(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await api.post('/payroll/worktime', {
        companyId: cid,
        userId: wUser || staff[0]?.id,
        hours: Number(wHours),
      });
      setWHours('');
      setMsg('✓ Время записано');
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  const period = periods.find((p) => p.id === periodId);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-800 dark:text-slate-100">Зарплата</h1>
      {msg && <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">{msg}</p>}

      {/* Ставки */}
      <div className="mb-6 rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">Ставки сотрудников</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-slate-400 dark:text-slate-500">
              <th className="py-2 font-medium">Сотрудник</th>
              <th className="py-2 font-medium">Должность</th>
              <th className="py-2 font-medium">Тип</th>
              <th className="py-2 text-right font-medium">Ставка / оклад</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((u) => (
              <SalaryRow key={u.id} u={u} canManage={canManage} onSave={saveSalary} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Период + расчёт */}
      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_2fr]">
        <div className="rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">Период</h2>
          <select
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
            className="mb-3 w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
          >
            <option value="">— выберите период —</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.isClosed ? '(закрыт)' : ''}
              </option>
            ))}
          </select>
          {periodId && canManage && !period?.isClosed && (
            <button
              onClick={calculate}
              className="mb-4 w-full rounded-lg bg-indigo-600 py-2 font-medium text-white hover:bg-indigo-700"
            >
              Рассчитать зарплату
            </button>
          )}

          {canManage && (
            <form onSubmit={createPeriod} className="space-y-2 border-t border-slate-100 dark:border-slate-700 pt-3">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Новый период</p>
              <input
                value={pName}
                onChange={(e) => setPName(e.target.value)}
                placeholder="Напр. Июнь 2026"
                required
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={pStart}
                  onChange={(e) => setPStart(e.target.value)}
                  type="date"
                  required
                  className="rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-2 py-2 text-sm"
                />
                <input
                  value={pEnd}
                  onChange={(e) => setPEnd(e.target.value)}
                  type="date"
                  required
                  className="rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-2 py-2 text-sm"
                />
              </div>
              <button className="w-full rounded-lg bg-slate-700 dark:bg-slate-600 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:hover:bg-slate-500">
                Создать период
              </button>
            </form>
          )}
        </div>

        {/* Расчётная ведомость */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">Ведомость</h2>
          {records.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">
              Нет расчёта. Выберите период и нажмите «Рассчитать».
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-slate-400 dark:text-slate-500">
                  <th className="py-2 font-medium">Сотрудник</th>
                  <th className="py-2 text-right font-medium">База</th>
                  <th className="py-2 text-right font-medium">Аванс</th>
                  <th className="py-2 text-right font-medium">Бонус</th>
                  <th className="py-2 text-right font-medium">Удерж.</th>
                  <th className="py-2 text-right font-medium">К выплате</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 dark:border-slate-800 last:border-0">
                    <td className="py-2 text-slate-700 dark:text-slate-200">{r.name}</td>
                    <td className="py-2 text-right text-slate-500 dark:text-slate-400">{money(r.base)}</td>
                    <td className="py-2 text-right text-amber-600 dark:text-amber-300">−{money(r.advance)}</td>
                    <td className="py-2 text-right">
                      <input
                        defaultValue={r.bonus}
                        onBlur={(e) => setBonus(r.id, 'bonus', e.target.value)}
                        disabled={!canManage || r.isPaid}
                        type="number"
                        className="w-16 rounded border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-1 py-0.5 text-right text-xs"
                      />
                    </td>
                    <td className="py-2 text-right">
                      <input
                        defaultValue={r.deduction}
                        onBlur={(e) => setBonus(r.id, 'deduction', e.target.value)}
                        disabled={!canManage || r.isPaid}
                        type="number"
                        className="w-16 rounded border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-1 py-0.5 text-right text-xs"
                      />
                    </td>
                    <td className="py-2 text-right font-semibold text-slate-800 dark:text-slate-100">
                      {money(r.total)}
                    </td>
                    <td className="py-2 text-right">
                      {r.isPaid ? (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400">выплачено</span>
                      ) : (
                        canManage && (
                          <button
                            onClick={() => pay(r.id)}
                            className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                          >
                            Выплатить
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Аванс / Время */}
      {canManage && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">Выдать аванс</h2>
            <form onSubmit={addAdvance} className="flex flex-wrap items-end gap-2">
              <select
                value={aUser}
                onChange={(e) => setAUser(e.target.value)}
                className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm"
              >
                {staff.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </select>
              <input
                value={aAmount}
                onChange={(e) => setAAmount(e.target.value)}
                type="number"
                placeholder="Сумма"
                required
                className="w-28 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm"
              />
              <button className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700">
                Выдать
              </button>
            </form>
          </div>

          <div className="rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">Учёт времени (часы)</h2>
            <form onSubmit={addWorkTime} className="flex flex-wrap items-end gap-2">
              <select
                value={wUser}
                onChange={(e) => setWUser(e.target.value)}
                className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm"
              >
                {staff.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </select>
              <input
                value={wHours}
                onChange={(e) => setWHours(e.target.value)}
                type="number"
                step="0.5"
                placeholder="Часов"
                required
                className="w-28 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm"
              />
              <button className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700">
                Записать
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function SalaryRow({
  u,
  canManage,
  onSave,
}: {
  u: any;
  canManage: boolean;
  onSave: (u: any, type: string, rate: string) => void;
}) {
  const [type, setType] = useState(u.salaryType);
  const [rate, setRate] = useState(String(u.rate));

  return (
    <tr className="border-b border-slate-50 dark:border-slate-800 last:border-0">
      <td className="py-2 text-slate-700 dark:text-slate-200">{u.fullName}</td>
      <td className="py-2 text-slate-400 dark:text-slate-500">{u.position ?? '—'}</td>
      <td className="py-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          disabled={!canManage}
          className="rounded border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-1 py-0.5 text-xs"
        >
          <option value="MONTHLY">Оклад</option>
          <option value="HOURLY">Почасовая</option>
        </select>
      </td>
      <td className="py-2 text-right">
        <input
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          disabled={!canManage}
          type="number"
          className="w-24 rounded border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-1 py-0.5 text-right text-xs"
        />
        {canManage && (
          <button
            onClick={() => onSave(u, type, rate)}
            className="ml-2 rounded bg-indigo-600 px-2 py-0.5 text-xs text-white hover:bg-indigo-700"
          >
            ✓
          </button>
        )}
      </td>
    </tr>
  );
}
