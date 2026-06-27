'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

const URGENCY: Record<string, string> = {
  NORMAL: 'Обычная',
  URGENT: 'Срочно',
  EXPRESS: 'ЭКСПРЕСС',
};
const TYPE: Record<string, string> = {
  SALE: 'Продажа',
  PRINT: 'Печать / дизайн',
  REPAIR: 'Ремонт',
  RECOVERY: 'Восстановление данных',
};

function TechCard() {
  const params = useSearchParams();
  const id = params.get('id');
  const [o, setO] = useState<any>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!id) return;
    api
      .get(`/orders/${id}`)
      .then(setO)
      .catch((e) => setErr(e.message));
  }, [id]);

  if (err) return <p className="text-rose-600">Ошибка: {err}</p>;
  if (!o) return <p className="text-slate-400">Загрузка…</p>;

  // Сводный расход материалов: Σ (норма × кол-во услуги)
  const mats = new Map<string, { name: string; unit: string; qty: number }>();
  for (const it of o.items ?? []) {
    for (const m of it.service?.materials ?? []) {
      const key = m.productId;
      const cur = mats.get(key) ?? {
        name: m.product?.name ?? '—',
        unit: m.product?.unit?.shortName ?? '',
        qty: 0,
      };
      cur.qty += Number(m.qtyPerUnit) * Number(it.quantity);
      mats.set(key, cur);
    }
  }
  const materials = Array.from(mats.values());

  const dt = (d?: string) =>
    d
      ? new Date(d).toLocaleString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—';

  return (
    <div>
      {/* Панель действий — не печатается */}
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href="/orders" className="text-sm text-slate-500 hover:text-slate-700">
          ← к заказам
        </Link>
        <button
          onClick={() => window.print()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          🖨 Печать тех-карты
        </button>
      </div>

      {/* Сама карта */}
      <div className="print-area mx-auto max-w-3xl rounded-2xl border border-slate-300 bg-white p-8">
        <div className="mb-4 flex items-start justify-between border-b border-slate-300 pb-4">
          <div>
            <div className="text-xl font-bold text-slate-900">
              Технологическая карта
            </div>
            <div className="text-sm text-slate-500">Заказ №{o.orderNumber}</div>
          </div>
          {o.urgency && o.urgency !== 'NORMAL' && (
            <div className="rounded-lg border-2 border-rose-500 px-3 py-1 text-sm font-bold text-rose-600">
              {URGENCY[o.urgency]}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <Row label="Тип" value={TYPE[o.orderType] ?? o.orderType} />
          <Row label="Срок готовности" value={dt(o.deadline)} />
          <Row
            label="Клиент"
            value={o.client?.fullName ?? o.client?.phone ?? '—'}
          />
          <Row label="Телефон" value={o.client?.phone ?? '—'} />
          {o.format && <Row label="Формат" value={o.format} />}
          {o.colorMode && <Row label="Цветность" value={o.colorMode} />}
          {o.designer && <Row label="Дизайнер" value={o.designer.fullName} />}
          {o.operator && <Row label="Оператор" value={o.operator.fullName} />}
        </div>

        {/* Позиции */}
        <div className="mt-5">
          <div className="mb-1 text-sm font-semibold text-slate-700">Позиции</div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left text-slate-500">
                <th className="py-1.5">Наименование</th>
                <th className="py-1.5 text-right">Кол-во</th>
              </tr>
            </thead>
            <tbody>
              {o.items?.map((it: any) => (
                <tr key={it.id} className="border-b border-slate-100">
                  <td className="py-1.5">
                    {it.description ||
                      it.service?.name ||
                      it.product?.name ||
                      'Позиция'}
                  </td>
                  <td className="py-1.5 text-right">{Number(it.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Расход материалов */}
        {materials.length > 0 && (
          <div className="mt-5">
            <div className="mb-1 text-sm font-semibold text-slate-700">
              Расход материалов (расчётный)
            </div>
            <table className="w-full border-collapse text-sm">
              <tbody>
                {materials.map((m, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1.5">{m.name}</td>
                    <td className="py-1.5 text-right">
                      {m.qty.toFixed(3).replace(/\.?0+$/, '')} {m.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {o.note && (
          <div className="mt-5 text-sm">
            <span className="font-semibold text-slate-700">Примечание: </span>
            {o.note}
          </div>
        )}

        {/* Поля для цеха */}
        <div className="mt-8 grid grid-cols-3 gap-6 border-t border-slate-300 pt-6 text-sm text-slate-500">
          <Sign label="Принял" />
          <Sign label="Изготовил" />
          <Sign label="Проверил (ОТК)" />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-slate-500">{label}:</span>
      <span className="font-medium text-slate-800">{value}</span>
    </div>
  );
}

function Sign({ label }: { label: string }) {
  return (
    <div>
      <div className="mb-6">{label}</div>
      <div className="border-t border-slate-400 pt-1 text-xs">подпись / дата</div>
    </div>
  );
}

export default function OrderCardPage() {
  return (
    <Suspense fallback={<p className="text-slate-400">Загрузка…</p>}>
      <TechCard />
    </Suspense>
  );
}
