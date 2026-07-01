'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
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

  const totalPayroll = records.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
  const paidCount = records.filter((r) => r.isPaid).length;
  const unpaidCount = records.length - paidCount;

  return (
    <div>
      <PageHeader
        icon="payroll"
        title="Зарплата"
        subtitle={period ? `Период: ${period.name}` : 'Ставки, ведомость и выплаты'}
      />
      {msg && <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">{msg}</p>}

      <StatGrid cols={4}>
        <StatCard icon="cash" tone="indigo" label="К выплате за период" value={money(totalPayroll)} sub={period?.name} highlight />
        <StatCard icon="staff" tone="sky" label="Сотрудников" value={staff.length} />
        <StatCard icon="reports" tone="emerald" label="Выплачено" value={paidCount} />
        <StatCard icon="complaints" tone="amber" label="К выплате" value={unpaidCount} />
      </StatGrid>

      {/* Ставки */}
      <TableCard className="mb-6">
        <div className="px-4 pt-4">
          <SectionTitle>Ставки сотрудников</SectionTitle>
        </div>
        <div className="pp-table-scroll">
          <table className="pp-table">
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Должность</th>
                <th>Тип</th>
                <th className="text-right">Ставка / оклад</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((u) => (
                <SalaryRow key={u.id} u={u} canManage={canManage} onSave={saveSalary} />
              ))}
            </tbody>
          </table>
        </div>
      </TableCard>

      {/* Период + расчёт */}
      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_2fr]">
        <Card>
          <SectionTitle>Период</SectionTitle>
          <Select
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
            className="mb-3"
          >
            <option value="">— выберите период —</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.isClosed ? '(закрыт)' : ''}
              </option>
            ))}
          </Select>
          {periodId && canManage && !period?.isClosed && (
            <Button onClick={calculate} className="mb-4 w-full">
              Рассчитать зарплату
            </Button>
          )}

          {canManage && (
            <form onSubmit={createPeriod} className="space-y-2 border-t border-slate-100 dark:border-slate-700 pt-3">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Новый период</p>
              <Input
                value={pName}
                onChange={(e) => setPName(e.target.value)}
                placeholder="Напр. Июнь 2026"
                required
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={pStart}
                  onChange={(e) => setPStart(e.target.value)}
                  type="date"
                  required
                />
                <Input
                  value={pEnd}
                  onChange={(e) => setPEnd(e.target.value)}
                  type="date"
                  required
                />
              </div>
              <Button type="submit" variant="ghost" className="w-full">
                Создать период
              </Button>
            </form>
          )}
        </Card>

        {/* Расчётная ведомость */}
        <TableCard>
          <div className="px-4 pt-4">
            <SectionTitle>Ведомость</SectionTitle>
          </div>
          {records.length === 0 ? (
            <EmptyState icon="payroll" title="Нет расчёта" hint="Выберите период и нажмите «Рассчитать»." />
          ) : (
            <div className="pp-table-scroll">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th>Сотрудник</th>
                    <th className="text-right">База</th>
                    <th className="text-right">Аванс</th>
                    <th className="text-right">Бонус</th>
                    <th className="text-right">Удерж.</th>
                    <th className="text-right">К выплате</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td className="font-medium text-slate-700 dark:text-slate-200">{r.name}</td>
                      <td className="text-right text-slate-500 dark:text-slate-400">{money(r.base)}</td>
                      <td className="text-right text-amber-600 dark:text-amber-300">−{money(r.advance)}</td>
                      <td className="text-right">
                        <input
                          defaultValue={r.bonus}
                          onBlur={(e) => setBonus(r.id, 'bonus', e.target.value)}
                          disabled={!canManage || r.isPaid}
                          type="number"
                          className="w-16 rounded border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-1 py-0.5 text-right text-xs"
                        />
                      </td>
                      <td className="text-right">
                        <input
                          defaultValue={r.deduction}
                          onBlur={(e) => setBonus(r.id, 'deduction', e.target.value)}
                          disabled={!canManage || r.isPaid}
                          type="number"
                          className="w-16 rounded border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-1 py-0.5 text-right text-xs"
                        />
                      </td>
                      <td className="text-right font-semibold text-slate-800 dark:text-slate-100">
                        {money(r.total)}
                      </td>
                      <td className="text-right">
                        {r.isPaid ? (
                          <Badge tone="emerald">выплачено</Badge>
                        ) : (
                          canManage && (
                            <Button variant="emerald" size="sm" onClick={() => pay(r.id)}>
                              Выплатить
                            </Button>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TableCard>
      </div>

      {/* Аванс / Время */}
      {canManage && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <SectionTitle>Выдать аванс</SectionTitle>
            <form onSubmit={addAdvance} className="flex flex-wrap items-end gap-2">
              <Select
                value={aUser}
                onChange={(e) => setAUser(e.target.value)}
                className="flex-1"
              >
                {staff.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </Select>
              <Input
                value={aAmount}
                onChange={(e) => setAAmount(e.target.value)}
                type="number"
                placeholder="Сумма"
                required
                className="w-28"
              />
              <Button type="submit" variant="amber">
                Выдать
              </Button>
            </form>
          </Card>

          <Card>
            <SectionTitle>Учёт времени (часы)</SectionTitle>
            <form onSubmit={addWorkTime} className="flex flex-wrap items-end gap-2">
              <Select
                value={wUser}
                onChange={(e) => setWUser(e.target.value)}
                className="flex-1"
              >
                {staff.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </Select>
              <Input
                value={wHours}
                onChange={(e) => setWHours(e.target.value)}
                type="number"
                step="0.5"
                placeholder="Часов"
                required
                className="w-28"
              />
              <Button type="submit" variant="sky">
                Записать
              </Button>
            </form>
          </Card>
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
    <tr>
      <td className="font-medium text-slate-700 dark:text-slate-200">{u.fullName}</td>
      <td className="text-slate-400 dark:text-slate-500">{u.position ?? '—'}</td>
      <td>
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
      <td className="text-right">
        <input
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          disabled={!canManage}
          type="number"
          className="w-24 rounded border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-1 py-0.5 text-right text-xs"
        />
        {canManage && (
          <Button size="sm" onClick={() => onSave(u, type, rate)} className="ml-2 px-2 py-0.5" title="Сохранить" aria-label="Сохранить">
            <NavIcon name="check" className="h-4 w-4" />
          </Button>
        )}
      </td>
    </tr>
  );
}
