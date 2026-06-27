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

export default function ServicesPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const [services, setServices] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Добавление материала к услуге: { [serviceId]: {productId, qty} }
  const [matForm, setMatForm] = useState<
    Record<string, { productId: string; qty: string }>
  >({});

  // Форма новой услуги
  const [name, setName] = useState('');
  const [pricingType, setPricingType] = useState('FIXED');
  const [basePrice, setBasePrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [leadTime, setLeadTime] = useState('');
  const [designSurcharge, setDesignSurcharge] = useState('');
  const [msg, setMsg] = useState('');

  // Инлайн-правка себестоимости
  const [editCostId, setEditCostId] = useState<string | null>(null);
  const [editCostVal, setEditCostVal] = useState('');

  function load() {
    setLoading(true);
    api
      .get(`/services?companyId=${cid}`)
      .then(setServices)
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    api.get(`/products?companyId=${cid}`).then(setProducts).catch(() => {});
  }, [cid]);

  async function addMaterial(serviceId: string) {
    const f = matForm[serviceId];
    if (!f?.productId || !f.qty) return;
    try {
      await api.post(`/services/${serviceId}/materials`, {
        productId: f.productId,
        qtyPerUnit: Number(f.qty),
      });
      setMatForm((m) => ({ ...m, [serviceId]: { productId: '', qty: '' } }));
      load();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function removeMaterial(materialId: string) {
    await api.del(`/services/materials/${materialId}`);
    load();
  }

  async function createService(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await api.post('/services', {
        companyId: cid,
        name,
        pricingType,
        basePrice: basePrice ? Number(basePrice) : 0,
        costPrice: costPrice ? Number(costPrice) : 0,
        leadTimeMin: leadTime ? Number(leadTime) : undefined,
        designSurcharge: designSurcharge ? Number(designSurcharge) : 0,
      });
      setName('');
      setBasePrice('');
      setCostPrice('');
      setLeadTime('');
      setDesignSurcharge('');
      setMsg('✓ Услуга добавлена');
      load();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function saveCost(id: string) {
    try {
      await api.patch(`/services/${id}`, {
        costPrice: editCostVal ? Number(editCostVal) : 0,
      });
      setEditCostId(null);
      load();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-800">Услуги</h1>

      {can('services.manage') && (
        <div className="mb-6 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-slate-700">Новая услуга</h2>
          <form onSubmit={createService} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="mb-1 block text-sm text-slate-500">Название</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Например: Печать баннеров"
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-500">Тип цены</label>
              <select
                value={pricingType}
                onChange={(e) => setPricingType(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="FIXED">Фиксированная</option>
                <option value="QUANTITY_TIER">По тиражу</option>
                <option value="BY_SIZE">По размеру</option>
                <option value="BY_AREA">По площади</option>
                <option value="MANUAL">Договорная</option>
              </select>
            </div>
            <div className="w-28">
              <label className="mb-1 block text-sm text-slate-500">Цена</label>
              <input
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                type="number"
                placeholder="0"
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div className="w-28">
              <label className="mb-1 block text-sm text-slate-500">Себест-ть</label>
              <input
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                type="number"
                placeholder="0"
                title="Себестоимость — для расчёта прибыли"
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div className="w-24">
              <label className="mb-1 block text-sm text-slate-500">Время, мин</label>
              <input
                value={leadTime}
                onChange={(e) => setLeadTime(e.target.value)}
                type="number"
                placeholder="—"
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div className="w-32">
              <label className="mb-1 block text-sm text-slate-500">Дизайн +</label>
              <input
                value={designSurcharge}
                onChange={(e) => setDesignSurcharge(e.target.value)}
                type="number"
                placeholder="0"
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <button className="rounded-lg bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-700">
              Добавить
            </button>
            {msg && <span className="text-sm text-slate-600">{msg}</span>}
          </form>
        </div>
      )}

      {loading ? (
        <p className="text-slate-400">Загрузка…</p>
      ) : services.length === 0 ? (
        <p className="text-slate-400">Услуг пока нет.</p>
      ) : (
        <div className="space-y-3">
          {services.map((s) => (
            <div key={s.id} className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-slate-800">{s.name}</div>
                  <div className="text-sm text-slate-500">
                    {PRICING_LABELS[s.pricingType] ?? s.pricingType}
                    {Number(s.designSurcharge) > 0 &&
                      ` · доплата за дизайн ${s.designSurcharge} c.`}
                    {s.leadTimeMin ? ` · ${s.leadTimeMin} мин` : ''}
                  </div>
                </div>
                {Number(s.basePrice) > 0 && (
                  <div className="text-right">
                    <div className="text-lg font-bold text-indigo-600">
                      {s.basePrice} c.
                    </div>
                    {Number(s.costPrice) > 0 && (
                      <div className="text-xs text-emerald-600">
                        прибыль {(Number(s.basePrice) - Number(s.costPrice)).toFixed(0)} c.
                        {Number(s.basePrice) > 0 &&
                          ` (${(
                            ((Number(s.basePrice) - Number(s.costPrice)) /
                              Number(s.basePrice)) *
                            100
                          ).toFixed(0)}%)`}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Себестоимость — инлайн-правка */}
              {can('services.manage') && (
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <span className="text-slate-500">Себестоимость:</span>
                  {editCostId === s.id ? (
                    <>
                      <input
                        value={editCostVal}
                        onChange={(e) => setEditCostVal(e.target.value)}
                        type="number"
                        autoFocus
                        className="w-24 rounded border border-slate-300 px-2 py-1"
                      />
                      <button
                        onClick={() => saveCost(s.id)}
                        className="rounded bg-emerald-600 px-2.5 py-1 text-xs text-white hover:bg-emerald-700"
                      >
                        Сохранить
                      </button>
                      <button
                        onClick={() => setEditCostId(null)}
                        className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                      >
                        Отмена
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        setEditCostId(s.id);
                        setEditCostVal(String(Number(s.costPrice) || ''));
                      }}
                      className="rounded bg-slate-100 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-200"
                    >
                      {Number(s.costPrice) > 0 ? `${s.costPrice} c.` : 'указать'} ✎
                    </button>
                  )}
                </div>
              )}

              {/* Материалы (спецификация для авто-списания) */}
              {can('services.manage') && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3">
                  <div className="mb-1.5 text-xs font-medium text-slate-500">
                    Материалы (расход на 1 ед. — спишутся при производстве)
                  </div>
                  {s.materials?.length > 0 ? (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {s.materials.map((m: any) => (
                        <span
                          key={m.id}
                          className="flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-sm text-slate-700 shadow-sm"
                        >
                          {m.product?.name} — {Number(m.qtyPerUnit)}{' '}
                          {m.product?.unit?.shortName ?? ''}
                          <button
                            onClick={() => removeMaterial(m.id)}
                            className="text-rose-400 hover:text-rose-600"
                            title="Убрать"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mb-2 text-xs text-slate-400">
                      Материалы не заданы — авто-списания не будет.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={matForm[s.id]?.productId ?? ''}
                      onChange={(e) =>
                        setMatForm((m) => ({
                          ...m,
                          [s.id]: {
                            productId: e.target.value,
                            qty: m[s.id]?.qty ?? '',
                          },
                        }))
                      }
                      className="rounded border border-slate-300 px-2 py-1 text-sm"
                    >
                      <option value="">— материал —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <input
                      value={matForm[s.id]?.qty ?? ''}
                      onChange={(e) =>
                        setMatForm((m) => ({
                          ...m,
                          [s.id]: {
                            productId: m[s.id]?.productId ?? '',
                            qty: e.target.value,
                          },
                        }))
                      }
                      type="number"
                      step="0.001"
                      placeholder="расход"
                      className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                    />
                    <button
                      onClick={() => addMaterial(s.id)}
                      className="rounded bg-slate-700 px-2.5 py-1 text-xs text-white hover:bg-slate-800"
                    >
                      + Добавить
                    </button>
                  </div>
                </div>
              )}

              {/* Цены по тиражу */}
              {s.priceTiers?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {s.priceTiers.map((t: any) => (
                    <span
                      key={t.id}
                      className="rounded-lg bg-slate-100 px-3 py-1 text-sm text-slate-600"
                    >
                      {t.minQty}
                      {t.maxQty ? `–${t.maxQty}` : '+'} шт = {t.price} c.
                    </span>
                  ))}
                </div>
              )}

              {/* Опции */}
              {s.options?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {s.options.map((o: any) => (
                    <span
                      key={o.id}
                      className="rounded-lg bg-emerald-50 px-3 py-1 text-sm text-emerald-700"
                    >
                      {o.name} +{o.priceModifier} c.
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
