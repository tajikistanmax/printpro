'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';

const PRICING_LABELS: Record<string, string> = {
  FIXED: 'Фиксированная',
  QUANTITY_TIER: 'По тиражу',
  BY_SIZE: 'По размеру',
  BY_AREA: 'По площади',
  MANUAL: 'Договорная',
};

const inp =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const inp2 =
  'rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

export default function ServicesPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const canManage = can('services.manage');

  const [services, setServices] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Категории
  const [catName, setCatName] = useState('');
  const [filterCat, setFilterCat] = useState('ALL');

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

  const filtered = services.filter((s) => filterCat === 'ALL' || s.categoryId === filterCat);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Услуги</h1>
        {canManage && (
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            {showAddForm ? 'Отмена' : '+ Добавить услугу'}
          </button>
        )}
      </div>

      {/* Категории */}
      {canManage && (
        <div className="mb-6 rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-900">
          <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">Категории услуг</h2>
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
            <input
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCategory()}
              placeholder="Новая категория"
              className={`${inp} sm:max-w-xs`}
            />
            <button onClick={addCategory} className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
              + Категория
            </button>
          </div>
        </div>
      )}

      {/* Форма добавления */}
      {showAddForm && canManage && (
        <div className="mb-6 rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-900">
          <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">Новая услуга</h2>
          <form onSubmit={createService} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-sm text-slate-500">Название *</label>
              <input value={newF.name} onChange={(e) => setNewF((f) => ({ ...f, name: e.target.value }))}
                required placeholder="напр. Печать баннеров" className={inp} />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-500">Категория</label>
              <select value={newF.categoryId} onChange={(e) => setNewF((f) => ({ ...f, categoryId: e.target.value }))}
                className={inp2}>
                <option value="">— без категории —</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-500">Тип цены</label>
              <select value={newF.pricingType} onChange={(e) => setNewF((f) => ({ ...f, pricingType: e.target.value }))}
                className={inp2}>
                {Object.entries(PRICING_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="w-28">
              <label className="mb-1 block text-sm text-slate-500">Цена, c.</label>
              <input type="number" value={newF.basePrice} onChange={(e) => setNewF((f) => ({ ...f, basePrice: e.target.value }))}
                placeholder="0" className={inp2} />
            </div>
            <div className="w-28">
              <label className="mb-1 block text-sm text-slate-500">Себест-ть</label>
              <input type="number" value={newF.costPrice} onChange={(e) => setNewF((f) => ({ ...f, costPrice: e.target.value }))}
                placeholder="0" className={inp2} />
            </div>
            <div className="w-24">
              <label className="mb-1 block text-sm text-slate-500">Время, мин</label>
              <input type="number" value={newF.leadTime} onChange={(e) => setNewF((f) => ({ ...f, leadTime: e.target.value }))}
                placeholder="—" className={inp2} />
            </div>
            <div className="w-32">
              <label className="mb-1 block text-sm text-slate-500">Дизайн +</label>
              <input type="number" value={newF.designSurcharge} onChange={(e) => setNewF((f) => ({ ...f, designSurcharge: e.target.value }))}
                placeholder="0" className={inp2} />
            </div>
            <button className="rounded-lg bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-700">
              Добавить
            </button>
            {addMsg && <span className="text-sm text-slate-600">{addMsg}</span>}
          </form>
        </div>
      )}

      {/* Фильтр по категориям */}
      {categories.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button onClick={() => setFilterCat('ALL')}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${filterCat === 'ALL' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 shadow-sm hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300'}`}>
            Все
          </button>
          {categories.map((c) => (
            <button key={c.id} onClick={() => setFilterCat(c.id)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${filterCat === c.id ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 shadow-sm hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300'}`}>
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* Список услуг */}
      {loading ? (
        <p className="text-slate-400">Загрузка…</p>
      ) : filtered.length === 0 ? (
        <p className="text-slate-400">Услуг нет.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => (
            <div key={s.id} className="rounded-2xl bg-white shadow-sm dark:bg-slate-900">
              {/* Заголовок карточки */}
              <div className="flex items-start justify-between p-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-800 dark:text-slate-100">{s.name}</span>
                    {s.category?.name && (
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">
                        {s.category.name}
                      </span>
                    )}
                    {!s.isActive && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-700">
                        неактивна
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {PRICING_LABELS[s.pricingType] ?? s.pricingType}
                    {Number(s.designSurcharge) > 0 && ` · доплата за дизайн ${s.designSurcharge} c.`}
                    {s.leadTimeMin ? ` · ${s.leadTimeMin} мин` : ''}
                  </div>
                </div>
                <div className="ml-4 flex shrink-0 items-center gap-2">
                  {Number(s.basePrice) > 0 && (
                    <div className="text-right">
                      <div className="text-lg font-bold text-indigo-600">{s.basePrice} c.</div>
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
                      <button
                        onClick={() => openEdit(s)}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        ✎ Изменить
                      </button>
                      <button
                        onClick={() => deleteService(s.id)}
                        className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-900/20"
                      >
                        Удалить
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Форма редактирования */}
              {editId === s.id && (
                <div className="border-t border-slate-100 p-5 dark:border-slate-700">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Редактирование</span>
                    <button onClick={() => setEditId(null)} className="text-xs text-slate-400 hover:text-slate-600">Отмена</button>
                  </div>

                  {/* Основные поля */}
                  <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="lg:col-span-2">
                      <label className="mb-1 block text-xs text-slate-500">Название *</label>
                      <input value={ef.name} onChange={(e) => setEf((f: any) => ({ ...f, name: e.target.value }))}
                        className={inp} placeholder="Название услуги" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">Категория</label>
                      <select value={ef.categoryId} onChange={(e) => setEf((f: any) => ({ ...f, categoryId: e.target.value }))}
                        className={inp}>
                        <option value="">— без категории —</option>
                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">Тип цены</label>
                      <select value={ef.pricingType} onChange={(e) => setEf((f: any) => ({ ...f, pricingType: e.target.value }))}
                        className={inp}>
                        {Object.entries(PRICING_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">Цена, c.</label>
                      <input type="number" value={ef.basePrice} onChange={(e) => setEf((f: any) => ({ ...f, basePrice: e.target.value }))}
                        className={inp} placeholder="0" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">Себестоимость, c.</label>
                      <input type="number" value={ef.costPrice} onChange={(e) => setEf((f: any) => ({ ...f, costPrice: e.target.value }))}
                        className={inp} placeholder="0" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">Время выполнения, мин</label>
                      <input type="number" value={ef.leadTime} onChange={(e) => setEf((f: any) => ({ ...f, leadTime: e.target.value }))}
                        className={inp} placeholder="—" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">Наценка за дизайн, c.</label>
                      <input type="number" value={ef.designSurcharge} onChange={(e) => setEf((f: any) => ({ ...f, designSurcharge: e.target.value }))}
                        className={inp} placeholder="0" />
                    </div>
                    <div className="flex items-end gap-2">
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                        <input type="checkbox" checked={ef.isActive} onChange={(e) => setEf((f: any) => ({ ...f, isActive: e.target.checked }))}
                          className="h-4 w-4 rounded" />
                        Активна
                      </label>
                    </div>
                  </div>

                  {/* Тиры цен (для По тиражу) */}
                  {ef.pricingType === 'QUANTITY_TIER' && (
                    <div className="mb-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-800">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Тиры по тиражу</span>
                        <button onClick={addTier} className="rounded bg-indigo-600 px-2.5 py-1 text-xs text-white hover:bg-indigo-700">
                          + Тир
                        </button>
                      </div>
                      {ef.priceTiers.length === 0 && (
                        <p className="text-xs text-slate-400">Нет тиров — нажмите «+ Тир»</p>
                      )}
                      <div className="space-y-2">
                        {ef.priceTiers.map((t: any) => (
                          <div key={t._k} className="flex items-center gap-2">
                            <input value={t.minQty} onChange={(e) => updTier(t._k, 'minQty', e.target.value)}
                              type="number" placeholder="от (шт)" className={`${inp2} w-24`} />
                            <span className="text-xs text-slate-400">—</span>
                            <input value={t.maxQty} onChange={(e) => updTier(t._k, 'maxQty', e.target.value)}
                              type="number" placeholder="до (∞)" className={`${inp2} w-24`} />
                            <span className="text-xs text-slate-400">шт</span>
                            <input value={t.price} onChange={(e) => updTier(t._k, 'price', e.target.value)}
                              type="number" placeholder="цена" className={`${inp2} w-24`} />
                            <span className="text-xs text-slate-400">c./шт</span>
                            <button onClick={() => rmTier(t._k)} className="text-rose-400 hover:text-rose-600">✕</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Размеры (для По размеру) */}
                  {ef.pricingType === 'BY_SIZE' && (
                    <div className="mb-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-800">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Форматы / размеры</span>
                        <button onClick={addSize} className="rounded bg-indigo-600 px-2.5 py-1 text-xs text-white hover:bg-indigo-700">
                          + Размер
                        </button>
                      </div>
                      {ef.sizes.length === 0 && <p className="text-xs text-slate-400">Нет форматов</p>}
                      <div className="space-y-2">
                        {ef.sizes.map((sz: any) => (
                          <div key={sz._k} className="flex items-center gap-2">
                            <input value={sz.label} onChange={(e) => updSize(sz._k, 'label', e.target.value)}
                              placeholder="напр. A4, 10x15" className={`${inp2} flex-1`} />
                            <input value={sz.price} onChange={(e) => updSize(sz._k, 'price', e.target.value)}
                              type="number" placeholder="цена c." className={`${inp2} w-28`} />
                            <button onClick={() => rmSize(sz._k)} className="text-rose-400 hover:text-rose-600">✕</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Опции */}
                  <div className="mb-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-800">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Опции (тип бумаги, срочность и т.д.)</span>
                      <button onClick={addOpt} className="rounded bg-slate-700 px-2.5 py-1 text-xs text-white hover:bg-slate-800">
                        + Опция
                      </button>
                    </div>
                    {ef.options.length === 0 && <p className="text-xs text-slate-400">Нет опций</p>}
                    <div className="space-y-2">
                      {ef.options.map((o: any) => (
                        <div key={o._k} className="flex items-center gap-2">
                          <input value={o.name} onChange={(e) => updOpt(o._k, 'name', e.target.value)}
                            placeholder="напр. Глянцевая бумага" className={`${inp2} flex-1`} />
                          <span className="text-xs text-slate-400">+</span>
                          <input value={o.priceModifier} onChange={(e) => updOpt(o._k, 'priceModifier', e.target.value)}
                            type="number" placeholder="0" className={`${inp2} w-24`} />
                          <span className="text-xs text-slate-400">c.</span>
                          <button onClick={() => rmOpt(o._k)} className="text-rose-400 hover:text-rose-600">✕</button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {editMsg && <p className="mb-2 text-sm text-rose-600">{editMsg}</p>}
                  <div className="flex gap-2">
                    <button onClick={saveEdit}
                      className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700">
                      Сохранить
                    </button>
                    <button onClick={() => setEditId(null)}
                      className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">
                      Отмена
                    </button>
                  </div>
                </div>
              )}

              {/* Тиры / размеры / опции (только просмотр, когда не редактируем) */}
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

                  {/* Материалы (спецификация) */}
                  {canManage && (
                    <div className="mt-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
                      <div className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                        Материалы (расход на 1 ед. — спишутся при производстве)
                      </div>
                      {s.materials?.length > 0 ? (
                        <div className="mb-2 flex flex-wrap gap-2">
                          {s.materials.map((m: any) => (
                            <span key={m.id}
                              className="flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-xs text-slate-700 shadow-sm dark:bg-slate-700 dark:text-slate-200">
                              {m.product?.name} — {Number(m.qtyPerUnit)} {m.product?.unit?.shortName ?? ''}
                              <button onClick={() => removeMaterial(m.id)} className="text-rose-400 hover:text-rose-600">✕</button>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="mb-2 text-xs text-slate-400">Материалы не заданы.</p>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={matForm[s.id]?.productId ?? ''}
                          onChange={(e) => setMatForm((m) => ({ ...m, [s.id]: { productId: e.target.value, qty: m[s.id]?.qty ?? '' } }))}
                          className={inp2}>
                          <option value="">— материал —</option>
                          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <input
                          value={matForm[s.id]?.qty ?? ''}
                          onChange={(e) => setMatForm((m) => ({ ...m, [s.id]: { productId: m[s.id]?.productId ?? '', qty: e.target.value } }))}
                          type="number" step="0.001" placeholder="расход"
                          className={`${inp2} w-24`} />
                        <button onClick={() => addMaterial(s.id)}
                          className="rounded bg-slate-700 px-2.5 py-1 text-xs text-white hover:bg-slate-800">
                          + Добавить
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
