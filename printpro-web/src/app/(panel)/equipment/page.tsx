'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';

const STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'Работает', cls: 'bg-emerald-100 text-emerald-700' },
  REPAIR: { label: 'На ремонте', cls: 'bg-amber-100 text-amber-700' },
  OFF: { label: 'Выключено', cls: 'bg-slate-200 text-slate-600' },
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

  function load() {
    setLoading(true);
    api
      .get(`/equipment?companyId=${cid}`)
      .then(setList)
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    api.get(`/branches?companyId=${cid}`).then(setBranches).catch(() => {});
  }, [cid]);

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

  return (
    <div className="max-w-4xl">
      <h1 className="mb-2 text-2xl font-bold text-slate-800">Оборудование</h1>
      <p className="mb-6 text-sm text-slate-500">
        Принтеры, плоттеры и станки. Выбираются при назначении задания в
        производстве.
      </p>

      {manage && (
        <div className="mb-6 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-slate-700">Добавить оборудование</h2>
          <form onSubmit={create} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px] flex-1">
              <label className="mb-1 block text-sm text-slate-500">Название</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Напр. Epson L1300 №1"
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-500">Тип</label>
              <input
                value={type}
                onChange={(e) => setType(e.target.value)}
                list="eq-types"
                className="w-40 rounded-lg border border-slate-300 px-3 py-2"
              />
              <datalist id="eq-types">
                {TYPES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-500">Модель</label>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="—"
                className="w-36 rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-500">Инв./серийный №</label>
              <input
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                placeholder="—"
                className="w-32 rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            {branches.length > 1 && (
              <div>
                <label className="mb-1 block text-sm text-slate-500">Филиал</label>
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="">—</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button className="rounded-lg bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-700">
              Добавить
            </button>
            {msg && <span className="text-sm text-slate-600">{msg}</span>}
          </form>
        </div>
      )}

      {loading ? (
        <p className="text-slate-400">Загрузка…</p>
      ) : list.length === 0 ? (
        <p className="text-slate-400">Оборудование пока не добавлено.</p>
      ) : (
        <div className="space-y-2">
          {list.map((e) => {
            const st = STATUS[e.status] ?? STATUS.ACTIVE;
            return (
              <div
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-4 shadow-sm"
              >
                <div>
                  <div className="font-medium text-slate-800">
                    {e.name}
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${st.cls}`}>
                      {st.label}
                    </span>
                  </div>
                  <div className="text-sm text-slate-500">
                    {[e.type, e.model, e.serial && `№ ${e.serial}`, e.branch?.name]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </div>
                </div>
                {manage && (
                  <div className="flex items-center gap-2">
                    <select
                      value={e.status}
                      onChange={(ev) => setStatus(e.id, ev.target.value)}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    >
                      <option value="ACTIVE">Работает</option>
                      <option value="REPAIR">На ремонте</option>
                      <option value="OFF">Выключено</option>
                    </select>
                    <button
                      onClick={() => remove(e.id)}
                      className="rounded px-2 py-1 text-rose-500 hover:bg-rose-50"
                      title="Удалить"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
