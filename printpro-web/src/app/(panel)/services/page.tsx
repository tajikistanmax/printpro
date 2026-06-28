'use client';

import { Fragment, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import {
  PageHeader,
  StatGrid,
  StatCard,
  TableCard,
  Toolbar,
  SearchInput,
  Tabs,
  Card,
  SectionTitle,
  Field,
  Input,
  Select,
  Button,
  Badge,
  EmptyState,
} from '@/components/ui';
import type { Tone } from '@/components/ui';

const PRICING_LABELS: Record<string, string> = {
  FIXED: 'Фиксированная',
  QUANTITY_TIER: 'По тиражу',
  BY_SIZE: 'По размеру',
  BY_AREA: 'По площади',
  MANUAL: 'Договорная',
};

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0)) + ' c.';
}

// Минуты → читабельный срок выполнения
function fmtLead(min?: number | null) {
  if (!min) return '—';
  if (min < 60) return `${min} мин`;
  if (min < 1440) {
    const h = Math.round((min / 60) * 10) / 10;
    return `${h} ч`;
  }
  const d = Math.round((min / 1440) * 10) / 10;
  return `${d} дн`;
}

// Стабильный цвет бейджа по названию категории
const CAT_TONES: Tone[] = ['indigo', 'sky', 'amber', 'violet', 'emerald', 'rose'];
function catTone(name: string): Tone {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CAT_TONES[h % CAT_TONES.length];
}
const TILE_BG: Record<Tone, string> = {
  indigo: '#6366f1', sky: '#0ea5e9', amber: '#f59e0b',
  violet: '#8b5cf6', emerald: '#10b981', rose: '#f43f5e', slate: '#64748b',
};
function initial(name: string) {
  const t = (name || '').trim();
  return t ? t[0].toUpperCase() : '?';
}

export default function ServicesPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const canManage = can('services.manage');

  const [services, setServices] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthRevenue, setMonthRevenue] = useState<number | null>(null);

  // Вид + фильтры
  const [view, setView] = useState<'table' | 'cards'>('table');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [filterCat, setFilterCat] = useState('ALL');
  const [showCats, setShowCats] = useState(false);

  // Категории
  const [catName, setCatName] = useState('');

  // Добавление услуги
  const [showAddForm, setShowAddForm] = useState(false);
  const [newF, setNewF] = useState({
    name: '', categoryId: '', pricingType: 'FIXED',
    basePrice: '', costPrice: '', leadTime: '', designSurcharge: '',
  });
  const [addMsg, setAddMsg] = useState('');

  // Редактирование услуги
  const [editId, setEditId] = useState<string | null>(null);
  const [ef, setEf] = useState<any>({});
  const [editMsg, setEditMsg] = useState('');

  // Материалы
  const [matForm, setMatForm] = useState<Record<string, { productId: string; qty: string }>>({});

  function load() {
    setLoading(true);
    Promise.all([
      api.get(`/services?companyId=${cid}`),
      api.get(`/service-categories?companyId=${cid}`),
      api.get(`/products?companyId=${cid}`),
    ])
      .then(([s, c, p]) => { setServices(s); setCategories(c); setProducts(p); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [cid]);

  // Выручка от услуг за текущий месяц (реальные данные из отчётов)
  useEffect(() => {
    const from = new Date(); from.setDate(1); from.setHours(0, 0, 0, 0);
    const to = new Date();
    api
      .get(`/reports/sales-by-item?companyId=${cid}&from=${from.toISOString()}&to=${to.toISOString()}`)
      .then((rows: any[]) => {
        const sum = (rows ?? [])
          .filter((r) => r.type === 'SERVICE')
          .reduce((s, r) => s + Number(r.revenue || 0), 0);
        setMonthRevenue(sum);
      })
      .catch(() => setMonthRevenue(null));
  }, [cid]);

  // ---- категории ----
  async function addCategory() {
    if (!catName.trim()) return;
    await api.post('/service-categories', { companyId: cid, name: catName.trim() });
    setCatName(''); load();
  }
  async function removeCategory(id: string) {
    if (!confirm('Удалить категорию?')) return;
    await api.del(`/service-categories/${id}`);
    if (filterCat === id) setFilterCat('ALL');
    load();
  }

  // ---- создать услугу ----
  async function createService(e: React.FormEvent) {
    e.preventDefault(); setAddMsg('');
    try {
      await api.post('/services', {
        companyId: cid,
        name: newF.name,
        categoryId: newF.categoryId || undefined,
        pricingType: newF.pricingType,
        basePrice: newF.basePrice ? Number(newF.basePrice) : 0,
        costPrice: newF.costPrice ? Number(newF.costPrice) : 0,
        leadTimeMin: newF.leadTime ? Number(newF.leadTime) : undefined,
        designSurcharge: newF.designSurcharge ? Number(newF.designSurcharge) : 0,
      });
      setNewF({ name: '', categoryId: '', pricingType: 'FIXED', basePrice: '', costPrice: '', leadTime: '', designSurcharge: '' });
      setAddMsg('✓ Услуга добавлена');
      setShowAddForm(false);
      load();
    } catch (err: any) { setAddMsg('Ошибка: ' + err.message); }
  }

  // ---- редактирование ----
  function openEdit(s: any) {
    setEditId(s.id);
    setEditMsg('');
    setEf({
      name: s.name,
      categoryId: s.categoryId ?? '',
      pricingType: s.pricingType,
      basePrice: String(Number(s.basePrice) || ''),
      costPrice: String(Number(s.costPrice) || ''),
      leadTime: s.leadTimeMin ? String(s.leadTimeMin) : '',
      designSurcharge: String(Number(s.designSurcharge) || ''),
      isActive: s.isActive ?? true,
      priceTiers: (s.priceTiers ?? []).map((t: any) => ({
        _k: t.id, minQty: String(t.minQty), maxQty: t.maxQty ? String(t.maxQty) : '', price: String(Number(t.price)),
      })),
      sizes: (s.sizes ?? []).map((sz: any) => ({
        _k: sz.id, label: sz.label, price: String(Number(sz.price)),
      })),
      options: (s.options ?? []).map((o: any) => ({
        _k: o.id, name: o.name, priceModifier: String(Number(o.priceModifier)),
      })),
    });
  }

  async function saveEdit() {
    if (!editId) return; setEditMsg('');
    try {
      const priceTiers = ef.priceTiers
        .filter((t: any) => t.minQty && t.price)
        .map((t: any) => ({ minQty: Number(t.minQty), maxQty: t.maxQty ? Number(t.maxQty) : null, price: Number(t.price) }));
      const sizes = ef.sizes
        .filter((s: any) => s.label && s.price)
        .map((s: any) => ({ label: s.label, price: Number(s.price) }));
      const options = ef.options
        .filter((o: any) => o.name)
        .map((o: any) => ({ name: o.name, priceModifier: Number(o.priceModifier) || 0 }));

      await api.patch(`/services/${editId}`, {
        name: ef.name,
        categoryId: ef.categoryId || undefined,
        pricingType: ef.pricingType,
        basePrice: ef.basePrice ? Number(ef.basePrice) : 0,
        costPrice: ef.costPrice ? Number(ef.costPrice) : 0,
        leadTimeMin: ef.leadTime ? Number(ef.leadTime) : null,
        designSurcharge: ef.designSurcharge ? Number(ef.designSurcharge) : 0,
        isActive: ef.isActive,
        priceTiers: priceTiers.length > 0 ? priceTiers : [],
        sizes: sizes.length > 0 ? sizes : [],
        options: options.length > 0 ? options : [],
      });
      setEditId(null);
      load();
    } catch (err: any) { setEditMsg('Ошибка: ' + err.message); }
  }

  async function deleteService(id: string) {
    if (!confirm('Удалить услугу? Это действие необратимо.')) return;
    try { await api.del(`/services/${id}`); } catch {}
    if (editId === id) setEditId(null);
    load();
  }

  // ---- тиры / размеры / опции в форме редактирования ----
  const addTier = () =>
    setEf((f: any) => ({ ...f, priceTiers: [...f.priceTiers, { _k: Date.now(), minQty: '', maxQty: '', price: '' }] }));
  const rmTier = (k: any) =>
    setEf((f: any) => ({ ...f, priceTiers: f.priceTiers.filter((t: any) => t._k !== k) }));
  const updTier = (k: any, field: string, val: string) =>
    setEf((f: any) => ({ ...f, priceTiers: f.priceTiers.map((t: any) => t._k === k ? { ...t, [field]: val } : t) }));

  const addSize = () =>
    setEf((f: any) => ({ ...f, sizes: [...f.sizes, { _k: Date.now(), label: '', price: '' }] }));
  const rmSize = (k: any) =>
    setEf((f: any) => ({ ...f, sizes: f.sizes.filter((s: any) => s._k !== k) }));
  const updSize = (k: any, field: string, val: string) =>
    setEf((f: any) => ({ ...f, sizes: f.sizes.map((s: any) => s._k === k ? { ...s, [field]: val } : s) }));

  const addOpt = () =>
    setEf((f: any) => ({ ...f, options: [...f.options, { _k: Date.now(), name: '', priceModifier: '' }] }));
  const rmOpt = (k: any) =>
    setEf((f: any) => ({ ...f, options: f.options.filter((o: any) => o._k !== k) }));
  const updOpt = (k: any, field: string, val: string) =>
    setEf((f: any) => ({ ...f, options: f.options.map((o: any) => o._k === k ? { ...o, [field]: val } : o) }));

  // ---- материалы ----
  async function addMaterial(serviceId: string) {
    const f = matForm[serviceId];
    if (!f?.productId || !f.qty) return;
    await api.post(`/services/${serviceId}/materials`, { productId: f.productId, qtyPerUnit: Number(f.qty) });
    setMatForm((m) => ({ ...m, [serviceId]: { productId: '', qty: '' } }));
    load();
  }
  async function removeMaterial(materialId: string) {
    await api.del(`/services/materials/${materialId}`); load();
  }

  // ---- производные ----
  const ql = search.trim().toLowerCase();
  const filtered = services.filter((s) => {
    if (filterCat !== 'ALL' && s.categoryId !== filterCat) return false;
    if (statusFilter === 'active' && s.isActive === false) return false;
    if (statusFilter === 'inactive' && s.isActive !== false) return false;
    if (ql && !s.name.toLowerCase().includes(ql) && !(s.category?.name ?? '').toLowerCase().includes(ql)) return false;
    return true;
  });

  const activeCount = services.filter((s) => s.isActive !== false).length;
  const inactiveCount = services.filter((s) => s.isActive === false).length;

  const catTabs = [
    { key: 'ALL', label: 'Все услуги', count: services.length },
    ...categories.map((c) => ({
      key: c.id,
      label: c.name,
      count: services.filter((s) => s.categoryId === c.id).length,
    })),
  ];

  // ---- форма редактирования (используется в таблице и в карточках) ----
  function renderEditForm(s: any) {
    return (
      <div className="border-t border-slate-100 p-5 dark:border-slate-700">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Редактирование</span>
          <button onClick={() => setEditId(null)} className="text-xs text-slate-400 hover:text-slate-600">Отмена</button>
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Название *" className="lg:col-span-2">
            <Input value={ef.name} onChange={(e) => setEf((f: any) => ({ ...f, name: e.target.value }))} placeholder="Название услуги" />
          </Field>
          <Field label="Категория">
            <Select value={ef.categoryId} onChange={(e) => setEf((f: any) => ({ ...f, categoryId: e.target.value }))}>
              <option value="">— без категории —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Тип цены">
            <Select value={ef.pricingType} onChange={(e) => setEf((f: any) => ({ ...f, pricingType: e.target.value }))}>
              {Object.entries(PRICING_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Цена, c.">
            <Input type="number" value={ef.basePrice} onChange={(e) => setEf((f: any) => ({ ...f, basePrice: e.target.value }))} placeholder="0" />
          </Field>
          <Field label="Себестоимость, c.">
            <Input type="number" value={ef.costPrice} onChange={(e) => setEf((f: any) => ({ ...f, costPrice: e.target.value }))} placeholder="0" />
          </Field>
          <Field label="Время выполнения, мин">
            <Input type="number" value={ef.leadTime} onChange={(e) => setEf((f: any) => ({ ...f, leadTime: e.target.value }))} placeholder="—" />
          </Field>
          <Field label="Наценка за дизайн, c.">
            <Input type="number" value={ef.designSurcharge} onChange={(e) => setEf((f: any) => ({ ...f, designSurcharge: e.target.value }))} placeholder="0" />
          </Field>
          <div className="flex items-end gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={ef.isActive} onChange={(e) => setEf((f: any) => ({ ...f, isActive: e.target.checked }))} className="h-4 w-4 rounded" />
              Активна
            </label>
          </div>
        </div>

        {ef.pricingType === 'QUANTITY_TIER' && (
          <div className="mb-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-800">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Тиры по тиражу</span>
              <Button size="sm" onClick={addTier}>+ Тир</Button>
            </div>
            {ef.priceTiers.length === 0 && <p className="text-xs text-slate-400">Нет тиров — нажмите «+ Тир»</p>}
            <div className="space-y-2">
              {ef.priceTiers.map((t: any) => (
                <div key={t._k} className="flex items-center gap-2">
                  <Input value={t.minQty} onChange={(e) => updTier(t._k, 'minQty', e.target.value)} type="number" placeholder="от (шт)" className="w-24" />
                  <span className="text-xs text-slate-400">—</span>
                  <Input value={t.maxQty} onChange={(e) => updTier(t._k, 'maxQty', e.target.value)} type="number" placeholder="до (∞)" className="w-24" />
                  <span className="text-xs text-slate-400">шт</span>
                  <Input value={t.price} onChange={(e) => updTier(t._k, 'price', e.target.value)} type="number" placeholder="цена" className="w-24" />
                  <span className="text-xs text-slate-400">c./шт</span>
                  <button onClick={() => rmTier(t._k)} className="text-rose-400 hover:text-rose-600">✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {ef.pricingType === 'BY_SIZE' && (
          <div className="mb-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-800">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Форматы / размеры</span>
              <Button size="sm" onClick={addSize}>+ Размер</Button>
            </div>
            {ef.sizes.length === 0 && <p className="text-xs text-slate-400">Нет форматов</p>}
            <div className="space-y-2">
              {ef.sizes.map((sz: any) => (
                <div key={sz._k} className="flex items-center gap-2">
                  <Input value={sz.label} onChange={(e) => updSize(sz._k, 'label', e.target.value)} placeholder="напр. A4, 10x15" className="flex-1" />
                  <Input value={sz.price} onChange={(e) => updSize(sz._k, 'price', e.target.value)} type="number" placeholder="цена c." className="w-28" />
                  <button onClick={() => rmSize(sz._k)} className="text-rose-400 hover:text-rose-600">✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-800">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Опции (тип бумаги, срочность и т.д.)</span>
            <Button variant="ghost" size="sm" onClick={addOpt}>+ Опция</Button>
          </div>
          {ef.options.length === 0 && <p className="text-xs text-slate-400">Нет опций</p>}
          <div className="space-y-2">
            {ef.options.map((o: any) => (
              <div key={o._k} className="flex items-center gap-2">
                <Input value={o.name} onChange={(e) => updOpt(o._k, 'name', e.target.value)} placeholder="напр. Глянцевая бумага" className="flex-1" />
                <span className="text-xs text-slate-400">+</span>
                <Input value={o.priceModifier} onChange={(e) => updOpt(o._k, 'priceModifier', e.target.value)} type="number" placeholder="0" className="w-24" />
                <span className="text-xs text-slate-400">c.</span>
                <button onClick={() => rmOpt(o._k)} className="text-rose-400 hover:text-rose-600">✕</button>
              </div>
            ))}
          </div>
        </div>

        {/* Материалы */}
        {canManage && (
          <div className="mb-4 rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
            <div className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              Материалы (расход на 1 ед. — спишутся при производстве)
            </div>
            {s.materials?.length > 0 ? (
              <div className="mb-2 flex flex-wrap gap-2">
                {s.materials.map((m: any) => (
                  <span key={m.id} className="flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-xs text-slate-700 shadow-sm dark:bg-slate-700 dark:text-slate-200">
                    {m.product?.name} — {Number(m.qtyPerUnit)} {m.product?.unit?.shortName ?? ''}
                    <button onClick={() => removeMaterial(m.id)} className="text-rose-400 hover:text-rose-600">✕</button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="mb-2 text-xs text-slate-400">Материалы не заданы.</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Select value={matForm[s.id]?.productId ?? ''} onChange={(e) => setMatForm((m) => ({ ...m, [s.id]: { productId: e.target.value, qty: m[s.id]?.qty ?? '' } }))} className="w-auto">
                <option value="">— материал —</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <Input value={matForm[s.id]?.qty ?? ''} onChange={(e) => setMatForm((m) => ({ ...m, [s.id]: { productId: m[s.id]?.productId ?? '', qty: e.target.value } }))} type="number" step="0.001" placeholder="расход" className="w-24" />
              <Button variant="ghost" size="sm" onClick={() => addMaterial(s.id)}>+ Добавить</Button>
            </div>
          </div>
        )}

        {editMsg && <p className="mb-2 text-sm text-rose-600">{editMsg}</p>}
        <div className="flex gap-2">
          <Button onClick={saveEdit}>Сохранить</Button>
          <Button variant="ghost" onClick={() => setEditId(null)}>Отмена</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        icon="services"
        title="Услуги"
        subtitle={`${services.length} услуг · ${categories.length} категорий`}
        actions={
          canManage && (
            <Button variant={showAddForm ? 'ghost' : 'primary'} onClick={() => setShowAddForm((v) => !v)}>
              {showAddForm ? 'Отмена' : '+ Добавить услугу'}
            </Button>
          )
        }
      />

      <StatGrid cols={4}>
        <StatCard icon="services" tone="indigo" label="Всего услуг" value={services.length} highlight />
        <StatCard icon="reports" tone="emerald" label="Активных" value={activeCount} />
        <StatCard icon="complaints" tone="rose" label="Отключённые" value={inactiveCount} />
        <StatCard icon="warehouse" tone="violet" label="Категорий" value={categories.length} />
        <StatCard icon="cash" tone="sky" label="Выручка за месяц" value={monthRevenue === null ? '—' : money(monthRevenue)} sub="по услугам" />
      </StatGrid>

      {/* Форма добавления */}
      {showAddForm && canManage && (
        <Card className="mb-6">
          <SectionTitle>Новая услуга</SectionTitle>
          <form onSubmit={createService} className="flex flex-wrap items-end gap-3">
            <Field label="Название *" className="min-w-[200px] flex-1">
              <Input value={newF.name} onChange={(e) => setNewF((f) => ({ ...f, name: e.target.value }))} required placeholder="напр. Печать баннеров" />
            </Field>
            <Field label="Категория">
              <Select value={newF.categoryId} onChange={(e) => setNewF((f) => ({ ...f, categoryId: e.target.value }))}>
                <option value="">— без категории —</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Тип цены">
              <Select value={newF.pricingType} onChange={(e) => setNewF((f) => ({ ...f, pricingType: e.target.value }))}>
                {Object.entries(PRICING_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Цена, c." className="w-28">
              <Input type="number" value={newF.basePrice} onChange={(e) => setNewF((f) => ({ ...f, basePrice: e.target.value }))} placeholder="0" />
            </Field>
            <Field label="Себест-ть" className="w-28">
              <Input type="number" value={newF.costPrice} onChange={(e) => setNewF((f) => ({ ...f, costPrice: e.target.value }))} placeholder="0" />
            </Field>
            <Field label="Время, мин" className="w-24">
              <Input type="number" value={newF.leadTime} onChange={(e) => setNewF((f) => ({ ...f, leadTime: e.target.value }))} placeholder="—" />
            </Field>
            <Field label="Дизайн +" className="w-32">
              <Input type="number" value={newF.designSurcharge} onChange={(e) => setNewF((f) => ({ ...f, designSurcharge: e.target.value }))} placeholder="0" />
            </Field>
            <Button type="submit">Добавить</Button>
            {addMsg && <span className="text-sm text-slate-600">{addMsg}</span>}
          </form>
        </Card>
      )}

      {/* Категории (управление) — сворачиваемое */}
      {canManage && (
        <div className="mb-4">
          <button onClick={() => setShowCats((v) => !v)} className="text-sm font-medium text-slate-500 hover:text-indigo-600 dark:text-slate-400">
            {showCats ? '▾' : '▸'} Управление категориями ({categories.length})
          </button>
          {showCats && (
            <Card className="mt-2">
              <div className="flex flex-wrap items-center gap-2">
                {categories.map((c) => (
                  <span key={c.id} className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {c.name}
                    <button onClick={() => removeCategory(c.id)} className="text-rose-400 hover:text-rose-600">✕</button>
                  </span>
                ))}
                {categories.length === 0 && <span className="text-sm text-slate-400">Категорий нет</span>}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Input value={catName} onChange={(e) => setCatName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCategory()} placeholder="Новая категория" className="sm:max-w-xs" />
                <Button variant="ghost" onClick={addCategory} className="shrink-0">+ Категория</Button>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Вкладки-категории */}
      <Tabs tabs={catTabs} active={filterCat} onChange={setFilterCat} />

      <TableCard>
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Поиск по услугам…" />
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto">
            <option value="ALL">Все статусы</option>
            <option value="active">Активные</option>
            <option value="inactive">Отключённые</option>
          </Select>
          <span className="text-sm text-slate-400">Найдено: {filtered.length}</span>
          <div className="ml-auto flex gap-1 rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
            <button onClick={() => setView('table')} className={`rounded-md px-3 py-1 text-sm font-medium transition ${view === 'table' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>▦ Таблица</button>
            <button onClick={() => setView('cards')} className={`rounded-md px-3 py-1 text-sm font-medium transition ${view === 'cards' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>▤ Карточки</button>
          </div>
        </Toolbar>

        {loading ? (
          <EmptyState title="Загрузка…" />
        ) : filtered.length === 0 ? (
          <EmptyState icon="services" title="Услуг нет" hint={canManage ? 'Добавьте первую услугу кнопкой «+ Добавить услугу».' : undefined} />
        ) : view === 'table' ? (
          /* ===== ТАБЛИЦА ===== */
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Услуга</th>
                  <th>Категория</th>
                  <th>Тип цены</th>
                  <th className="text-right">Цена от</th>
                  <th>Срок</th>
                  <th>Статус</th>
                  {canManage && <th className="text-right">Действия</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <Fragment key={s.id}>
                    <tr>
                      <td>
                        <div className="flex items-center gap-3">
                          <span
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
                            style={{ background: TILE_BG[catTone(s.category?.name ?? s.name)] }}
                          >
                            {initial(s.name)}
                          </span>
                          <span className="font-medium text-slate-700 dark:text-slate-200">{s.name}</span>
                        </div>
                      </td>
                      <td>{s.category?.name ? <Badge tone={catTone(s.category.name)}>{s.category.name}</Badge> : <span className="text-slate-400">—</span>}</td>
                      <td className="text-slate-600 dark:text-slate-300">{PRICING_LABELS[s.pricingType] ?? s.pricingType}</td>
                      <td className="text-right font-semibold text-indigo-600 dark:text-indigo-400">{money(s.basePrice)}</td>
                      <td className="text-slate-600 dark:text-slate-300">{fmtLead(s.leadTimeMin)}</td>
                      <td>{s.isActive === false ? <Badge tone="slate">Отключена</Badge> : <Badge tone="emerald">Активна</Badge>}</td>
                      {canManage && (
                        <td className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="sm" onClick={() => (editId === s.id ? setEditId(null) : openEdit(s))}>✎</Button>
                            <Button variant="ghost" size="sm" className="text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20" onClick={() => deleteService(s.id)}>✕</Button>
                          </div>
                        </td>
                      )}
                    </tr>
                    {editId === s.id && (
                      <tr>
                        <td colSpan={canManage ? 7 : 6} className="!p-0">
                          {renderEditForm(s)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* ===== КАРТОЧКИ ===== */
          <div className="space-y-3 p-4">
            {filtered.map((s) => (
              <Card key={s.id} className="!p-0">
                <div className="flex items-start justify-between p-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{s.name}</span>
                      {s.category?.name && <Badge tone={catTone(s.category.name)}>{s.category.name}</Badge>}
                      {!s.isActive && <Badge tone="slate">неактивна</Badge>}
                    </div>
                    <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {PRICING_LABELS[s.pricingType] ?? s.pricingType}
                      {Number(s.designSurcharge) > 0 && ` · доплата за дизайн ${s.designSurcharge} c.`}
                      {s.leadTimeMin ? ` · ${fmtLead(s.leadTimeMin)}` : ''}
                    </div>
                  </div>
                  <div className="ml-4 flex shrink-0 items-center gap-2">
                    {Number(s.basePrice) > 0 && (
                      <div className="text-right">
                        <div className="text-lg font-bold text-indigo-600">{money(s.basePrice)}</div>
                        {Number(s.costPrice) > 0 && (
                          <div className="text-xs text-emerald-600">
                            прибыль {(Number(s.basePrice) - Number(s.costPrice)).toFixed(0)} c.
                            {` (${(((Number(s.basePrice) - Number(s.costPrice)) / Number(s.basePrice)) * 100).toFixed(0)}%)`}
                          </div>
                        )}
                      </div>
                    )}
                    {canManage && editId !== s.id && (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>✎ Изменить</Button>
                        <Button variant="danger" size="sm" onClick={() => deleteService(s.id)}>Удалить</Button>
                      </div>
                    )}
                  </div>
                </div>

                {editId === s.id && renderEditForm(s)}

                {editId !== s.id && (
                  <div className="px-5 pb-4">
                    {s.priceTiers?.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {s.priceTiers.map((t: any) => (
                          <span key={t.id} className="rounded-lg bg-slate-100 px-3 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {t.minQty}{t.maxQty ? `–${t.maxQty}` : '+'} шт = {t.price} c.
                          </span>
                        ))}
                      </div>
                    )}
                    {s.sizes?.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {s.sizes.map((sz: any) => (
                          <span key={sz.id} className="rounded-lg bg-sky-50 px-3 py-1 text-xs text-sky-700 dark:bg-sky-900/20 dark:text-sky-300">
                            {sz.label} — {sz.price} c.
                          </span>
                        ))}
                      </div>
                    )}
                    {s.options?.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {s.options.map((o: any) => (
                          <span key={o.id} className="rounded-lg bg-emerald-50 px-3 py-1 text-xs text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                            {o.name} +{o.priceModifier} c.
                          </span>
                        ))}
                      </div>
                    )}
                    {s.materials?.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {s.materials.map((m: any) => (
                          <span key={m.id} className="rounded-lg bg-white px-2.5 py-1 text-xs text-slate-600 shadow-sm dark:bg-slate-700 dark:text-slate-200">
                            📦 {m.product?.name} — {Number(m.qtyPerUnit)} {m.product?.unit?.shortName ?? ''}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </TableCard>
    </div>
  );
}
