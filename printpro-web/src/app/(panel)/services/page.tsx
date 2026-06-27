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
  const [loading, setLoading] = useState(true);

  // Форма новой услуги
  const [name, setName] = useState('');
  const [pricingType, setPricingType] = useState('FIXED');
  const [basePrice, setBasePrice] = useState('');
  const [designSurcharge, setDesignSurcharge] = useState('');
  const [msg, setMsg] = useState('');

  function load() {
    setLoading(true);
    api
      .get(`/services?companyId=${cid}`)
      .then(setServices)
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(load, [cid]);

  async function createService(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await api.post('/services', {
        companyId: cid,
        name,
        pricingType,
        basePrice: basePrice ? Number(basePrice) : 0,
        designSurcharge: designSurcharge ? Number(designSurcharge) : 0,
      });
      setName('');
      setBasePrice('');
      setDesignSurcharge('');
      setMsg('✓ Услуга добавлена');
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
                  </div>
                </div>
                {Number(s.basePrice) > 0 && (
                  <div className="text-lg font-bold text-indigo-600">
                    {s.basePrice} c.
                  </div>
                )}
              </div>

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
