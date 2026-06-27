'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';

export default function PromocodesPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const manage = can('orders.manage');

  const [list, setList] = useState<any[]>([]);
  const [code, setCode] = useState('');
  const [type, setType] = useState('PERCENT');
  const [value, setValue] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [msg, setMsg] = useState('');

  function load() {
    api.get(`/promocodes?companyId=${cid}`).then(setList).catch(() => {});
  }
  useEffect(load, [cid]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await api.post('/promocodes', {
        companyId: cid,
        code,
        discountType: type,
        value: Number(value),
        maxUses: maxUses ? Number(maxUses) : null,
        validUntil: validUntil || undefined,
      });
      setCode('');
      setValue('');
      setMaxUses('');
      setValidUntil('');
      setMsg('✓ Промокод создан');
      load();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function remove(id: string) {
    if (!confirm('Удалить промокод?')) return;
    await api.del(`/promocodes/${id}`);
    load();
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-2 text-2xl font-bold text-slate-800">Промокоды</h1>
      <p className="mb-6 text-sm text-slate-500">
        Скидочные коды для кассы: процент или фиксированная сумма, с лимитом
        использований и сроком.
      </p>

      {manage && (
        <div className="mb-6 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-slate-700">Новый промокод</h2>
          <form onSubmit={create} className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-sm text-slate-500">Код</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                placeholder="SALE10"
                className="w-32 rounded-lg border border-slate-300 px-3 py-2 uppercase"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-500">Тип</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="PERCENT">Процент %</option>
                <option value="FIXED">Сумма c.</option>
              </select>
            </div>
            <div className="w-24">
              <label className="mb-1 block text-sm text-slate-500">Значение</label>
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                type="number"
                min="0"
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div className="w-28">
              <label className="mb-1 block text-sm text-slate-500">Лимит</label>
              <input
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                type="number"
                min="1"
                placeholder="∞"
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-500">До</label>
              <input
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                type="date"
                className="rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <button className="rounded-lg bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-700">
              Создать
            </button>
            {msg && <span className="text-sm text-slate-600">{msg}</span>}
          </form>
        </div>
      )}

      {list.length === 0 ? (
        <p className="text-slate-400">Промокодов пока нет.</p>
      ) : (
        <div className="space-y-2">
          {list.map((p) => {
            const expired = p.validUntil && new Date(p.validUntil) < new Date();
            const used = p.maxUses != null && p.usedCount >= p.maxUses;
            return (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-4 shadow-sm"
              >
                <div>
                  <span className="font-mono text-lg font-bold text-slate-800">
                    {p.code}
                  </span>
                  <span className="ml-3 text-sm text-slate-500">
                    {p.discountType === 'PERCENT'
                      ? `−${Number(p.value)}%`
                      : `−${Number(p.value)} c.`}
                    {' · использован '}
                    {p.usedCount}
                    {p.maxUses != null ? ` из ${p.maxUses}` : ''}
                    {p.validUntil
                      ? ` · до ${new Date(p.validUntil).toLocaleDateString('ru-RU')}`
                      : ''}
                  </span>
                  {(expired || used || !p.isActive) && (
                    <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
                      {expired ? 'истёк' : used ? 'исчерпан' : 'выключен'}
                    </span>
                  )}
                </div>
                {manage && (
                  <button
                    onClick={() => remove(p.id)}
                    className="rounded-lg px-2 py-1 text-rose-500 hover:bg-rose-50"
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
