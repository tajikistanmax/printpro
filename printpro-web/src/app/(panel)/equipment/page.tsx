'use client';

import { useCallback, useEffect, useState } from 'react';
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

const STATUS: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Работает', tone: 'emerald' },
  REPAIR: { label: 'На ремонте', tone: 'amber' },
  OFF: { label: 'Выключено', tone: 'slate' },
};

const TYPES = [
  'Принтер',
  'Плоттер',
  'Ламинатор',
  'Резак',
  'Термопресс',
  'МФУ',
  'Гравёр',
  'Брошюровщик',
];

export default function EquipmentPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const manage = can('settings.manage');

  const [list, setList] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  // Форма
  const [name, setName] = useState('');
  const [type, setType] = useState('Принтер');
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [branchId, setBranchId] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api
      .get(`/equipment?companyId=${cid}`)
      .then(setList)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [cid]);
  useEffect(() => {
    const id = setTimeout(load, 0);
    api
      .get(`/branches?companyId=${cid}`)
      .then((b) => { setBranches(b); if (b[0]) setBranchId(b[0].id); })
      .catch(() => {});
    return () => clearTimeout(id);
  }, [cid, load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await api.post('/equipment', {
        companyId: cid,
        name,
        type,
        model: model || undefined,
        serial: serial || undefined,
        branchId: branchId || undefined,
      });
      setName('');
      setModel('');
      setSerial('');
      setMsg('✓ Оборудование добавлено');
      load();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function setStatus(id: string, status: string) {
    await api.patch(`/equipment/${id}`, { status });
    load();
  }

  async function remove(id: string) {
    if (!confirm('Удалить оборудование из списка?')) return;
    await api.del(`/equipment/${id}`);
    load();
  }

  const activeCount = list.filter((e) => (e.status ?? 'ACTIVE') === 'ACTIVE').length;
  const repairCount = list.filter((e) => e.status === 'REPAIR').length;
  const offCount = list.filter((e) => e.status === 'OFF').length;

  return (
    <div className="max-w-4xl">
      <PageHeader
        icon="equipment"
        title="Оборудование"
        subtitle="Принтеры, плоттеры и станки. Выбираются при назначении задания в производстве."
      />

      <StatGrid cols={4}>
        <StatCard icon="equipment" tone="indigo" label="Всего" value={list.length} highlight />
        <StatCard icon="reports" tone="emerald" label="Работает" value={activeCount} />
        <StatCard icon="complaints" tone="amber" label="На ремонте" value={repairCount} />
        <StatCard icon="settings" tone="slate" label="Выключено" value={offCount} />
      </StatGrid>

      {manage && (
        <Card className="mb-6">
          <SectionTitle>Добавить оборудование</SectionTitle>
          <form onSubmit={create} className="flex flex-wrap items-end gap-3">
            <Field label="Название" className="min-w-[180px] flex-1">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Напр. Epson L1300 №1"
              />
            </Field>
            <Field label="Тип">
              <Input
                value={type}
                onChange={(e) => setType(e.target.value)}
                list="eq-types"
                className="w-40"
              />
              <datalist id="eq-types">
                {TYPES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>
            <Field label="Модель">
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="—"
                className="w-36"
              />
            </Field>
            <Field label="Инв./серийный №">
              <Input
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                placeholder="—"
                className="w-32"
              />
            </Field>
            {branches.length > 1 && (
              <Field label="Филиал">
                <Select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                >
                  <option value="">—</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Button type="submit">Добавить</Button>
            {msg && <span className="text-sm text-slate-600 dark:text-slate-300">{msg}</span>}
          </form>
        </Card>
      )}

      {loading ? (
        <EmptyState title="Загрузка…" />
      ) : list.length === 0 ? (
        <EmptyState icon="equipment" title="Оборудование пока не добавлено." />
      ) : (
        <div className="space-y-2">
          {list.map((e) => {
            const st = STATUS[e.status] ?? STATUS.ACTIVE;
            return (
              <Card
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <div>
                  <div className="font-medium text-slate-800 dark:text-slate-100">
                    {e.name}
                    <Badge tone={st.tone} className="ml-2">
                      {st.label}
                    </Badge>
                  </div>
                  <div className="text-sm text-slate-500 dark:text-slate-400">
                    {[e.type, e.model, e.serial && `№ ${e.serial}`, e.branch?.name]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </div>
                </div>
                {manage && (
                  <div className="flex items-center gap-2">
                    <Select
                      value={e.status}
                      onChange={(ev) => setStatus(e.id, ev.target.value)}
                      className="w-auto"
                    >
                      <option value="ACTIVE">Работает</option>
                      <option value="REPAIR">На ремонте</option>
                      <option value="OFF">Выключено</option>
                    </Select>
                    <button
                      onClick={() => remove(e.id)}
                      className="inline-flex rounded px-2 py-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                      title="Удалить"
                      aria-label="Удалить"
                    >
                      <NavIcon name="close" className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
