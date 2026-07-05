'use client';

// Хаб отчётов PrintPro: общая панель фильтров (период, филиал, гранулярность,
// сравнение) + вкладки. Каждая вкладка — самостоятельная секция из sections.tsx,
// которая грузит свои эндпоинты по общим фильтрам.

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import {
  PageHeader,
  Card,
  Segmented,
  Tabs,
  Button,
  Field,
  Input,
  Select,
  type TabItem,
} from '@/components/ui';
import NavIcon from '@/lib/NavIcons';
import {
  periodRange,
  isoToDateInput,
  PERIOD_OPTIONS,
  type PeriodPreset,
  type Branch,
} from './lib';
import {
  OverviewSection,
  SalesSection,
  ItemsSection,
  ProfitSection,
  FinanceSection,
  DebtsSection,
  WarehouseSection,
  PurchasingSection,
  ProductionSection,
  StaffSection,
  type Filters,
} from './sections';

const TABS: TabItem[] = [
  { key: 'overview', label: 'Обзор' },
  { key: 'sales', label: 'Продажи' },
  { key: 'items', label: 'Услуги/товары' },
  { key: 'profit', label: 'Прибыль' },
  { key: 'finance', label: 'Финансы' },
  { key: 'debts', label: 'Долги' },
  { key: 'warehouse', label: 'Склад' },
  { key: 'purchasing', label: 'Закупки' },
  { key: 'production', label: 'Производство' },
  { key: 'staff', label: 'Сотрудники' },
];

export default function ReportsPage() {
  const cid = DEFAULT_COMPANY_ID;

  const [tab, setTab] = useState('overview');
  const [preset, setPreset] = useState<PeriodPreset>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [branchId, setBranchId] = useState('');
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day');
  const [compare, setCompare] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);

  // Список филиалов для фильтра
  useEffect(() => {
    api
      .get<Branch[]>(`/branches?companyId=${cid}`)
      .then((b) => setBranches(Array.isArray(b) ? b : []))
      .catch(() => {});
  }, [cid]);

  // Смена пресета. При первом переходе на «Произвольный» заполняем поля дат
  // текущим месяцем — в обработчике события, а не в эффекте (иначе каскадный
  // ре-рендер: react-hooks/set-state-in-effect).
  function changePreset(k: string) {
    const p = k as PeriodPreset;
    if (p === 'custom' && !customFrom && !customTo) {
      const { from, to } = periodRange('month');
      setCustomFrom(isoToDateInput(from));
      setCustomTo(isoToDateInput(to));
    }
    setPreset(p);
  }

  // Единый объект фильтров, стабильный по значению (передаётся в секции)
  const filters: Filters = useMemo(() => {
    const { from, to } = periodRange(preset, customFrom, customTo);
    return { cid, from, to, branchId, groupBy, compare };
  }, [cid, preset, customFrom, customTo, branchId, groupBy, compare]);

  // Гранулярность нужна только на вкладках с временными рядами
  const showGranularity = tab === 'overview' || tab === 'sales' || tab === 'finance';
  const showCompare = tab === 'overview';

  return (
    <div className="print-area">
      <PageHeader
        icon="reports"
        title="Отчёты и финансы"
        subtitle="Выручка, прибыль, долги, склад, производство и эффективность"
        actions={
          <div className="no-print flex items-center gap-2">
            <Button variant="ghost" onClick={() => window.print()}>
              <NavIcon name="print" className="h-4 w-4" />
              Печать / PDF
            </Button>
          </div>
        }
      />

      {/* Панель фильтров */}
      <Card className="mb-4 no-print">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Период">
            <Segmented
              options={PERIOD_OPTIONS}
              active={preset}
              onChange={changePreset}
            />
          </Field>

          {preset === 'custom' && (
            <>
              <Field label="С">
                <Input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="w-40"
                />
              </Field>
              <Field label="По">
                <Input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="w-40"
                />
              </Field>
            </>
          )}

          <Field label="Филиал">
            <Select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="w-48"
            >
              <option value="">Все филиалы</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>

          {showGranularity && (
            <Field label="Гранулярность">
              <Segmented
                options={[
                  { key: 'day', label: 'Дни' },
                  { key: 'week', label: 'Недели' },
                  { key: 'month', label: 'Месяцы' },
                ]}
                active={groupBy}
                onChange={(k) => setGroupBy(k as 'day' | 'week' | 'month')}
              />
            </Field>
          )}

          {showCompare && (
            <Field label="Сравнение">
              <label className="flex h-[38px] cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <input
                  type="checkbox"
                  checked={compare}
                  onChange={(e) => setCompare(e.target.checked)}
                  className="h-4 w-4 accent-indigo-600"
                />
                с пред. периодом
              </label>
            </Field>
          )}
        </div>
      </Card>

      {/* Вкладки */}
      <div className="no-print">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>

      {/* Содержимое активной вкладки */}
      {tab === 'overview' && <OverviewSection f={filters} />}
      {tab === 'sales' && <SalesSection f={filters} />}
      {tab === 'items' && <ItemsSection f={filters} />}
      {tab === 'profit' && <ProfitSection f={filters} />}
      {tab === 'finance' && <FinanceSection f={filters} />}
      {tab === 'debts' && <DebtsSection f={filters} />}
      {tab === 'warehouse' && <WarehouseSection f={filters} />}
      {tab === 'purchasing' && <PurchasingSection f={filters} />}
      {tab === 'production' && <ProductionSection f={filters} />}
      {tab === 'staff' && <StaffSection f={filters} />}
    </div>
  );
}
