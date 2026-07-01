'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import {
  PageHeader,
  Card,
  SectionTitle,
  Field,
  Input,
  Select,
  Button,
  SearchInput,
  EmptyState,
} from '@/components/ui';
import NavIcon from '@/lib/NavIcons';

// --- Форматы ценников (мм) ---
type SizeKey = '30x20' | '40x30' | '50x25' | '58x40';
const SIZES: Record<SizeKey, { w: number; h: number; bar: number; price: number; name: number; label: string }> = {
  '30x20': { w: 30, h: 20, bar: 22, price: 13, name: 8, label: '30×20 мм — мелкий' },
  '40x30': { w: 40, h: 30, bar: 30, price: 17, name: 9, label: '40×30 мм — стандарт' },
  '50x25': { w: 50, h: 25, bar: 34, price: 15, name: 8, label: '50×25 мм — узкий' },
  '58x40': { w: 58, h: 40, bar: 40, price: 22, name: 11, label: '58×40 мм — крупный' },
};

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n || 0));
}
// EAN-13 — только 13 цифр, иначе универсальный CODE128
function barcodeFormat(code: string): 'EAN13' | 'CODE128' {
  return /^\d{13}$/.test(code) ? 'EAN13' : 'CODE128';
}
// Значение штрихкода: свой ШК → артикул → id
function codeFor(p: any): string {
  return (p.barcode || p.sku || p.id || '').toString();
}

// Рендер штрихкода в SVG через jsbarcode (динамический импорт — только в браузере)
function Barcode({ value, heightPx }: { value: string; heightPx: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    let cancelled = false;
    if (!ref.current || !value) return;
    import('jsbarcode')
      .then(({ default: JsBarcode }) => {
        if (cancelled || !ref.current) return;
        try {
          JsBarcode(ref.current, value, {
            format: barcodeFormat(value),
            height: heightPx,
            width: 1.5,
            fontSize: 11,
            margin: 0,
            displayValue: true,
          });
        } catch {
          // некорректный код — покажем как текст
          if (ref.current) ref.current.innerHTML = '';
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [value, heightPx]);
  return <svg ref={ref} className="max-w-full" />;
}

export default function PriceLabelsPage() {
  const cid = DEFAULT_COMPANY_ID;
  const [products, setProducts] = useState<any[]>([]);
  const [shopName, setShopName] = useState('');
  const [q, setQ] = useState('');

  // выбранные товары: id -> количество ценников
  const [picked, setPicked] = useState<Record<string, number>>({});

  // шаблон
  const [size, setSize] = useState<SizeKey>('40x30');
  const [showName, setShowName] = useState(true);
  const [showBarcode, setShowBarcode] = useState(true);
  const [showShop, setShowShop] = useState(true);
  const [showSku, setShowSku] = useState(false);

  useEffect(() => {
    api.get(`/products?companyId=${cid}`).then(setProducts).catch(() => {});
    api
      .get(`/settings/ui?companyId=${cid}`)
      .then((ui: any) => { if (ui?.companyName) setShopName(ui.companyName); })
      .catch(() => {});
  }, [cid]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return products;
    return products.filter(
      (p) =>
        p.name?.toLowerCase().includes(ql) ||
        (p.sku ?? '').toLowerCase().includes(ql) ||
        (p.barcode ?? '').includes(ql),
    );
  }, [products, q]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  function setCount(id: string, n: number) {
    setPicked((prev) => {
      const next = { ...prev };
      if (n <= 0) delete next[id];
      else next[id] = Math.min(999, n);
      return next;
    });
  }
  function add(id: string) { setCount(id, (picked[id] ?? 0) + 1); }

  // Разворачиваем выбор в плоский список ценников (по количеству копий)
  const labels = useMemo(() => {
    const out: any[] = [];
    for (const [id, n] of Object.entries(picked)) {
      const p = byId.get(id);
      if (!p) continue;
      for (let i = 0; i < n; i++) out.push(p);
    }
    return out;
  }, [picked, byId]);

  const totalLabels = labels.length;
  const s = SIZES[size];

  function selectAllFiltered() {
    setPicked((prev) => {
      const next = { ...prev };
      for (const p of filtered) if (!next[p.id]) next[p.id] = 1;
      return next;
    });
  }
  function clearAll() { setPicked({}); }

  return (
    <div>
      {/* Правила печати: на печать выводим только сетку ценников */}
      <style>{`
        @media print {
          @page { margin: 6mm; }
          body * { visibility: hidden !important; }
          #label-print, #label-print * { visibility: visible !important; }
          #label-print { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print">
        <PageHeader
          title="Ценники"
          subtitle="Печать ценников со штрихкодом — выберите товары, шаблон и распечатайте"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        {/* ---- Левая колонка: выбор товаров + шаблон ---- */}
        <div className="no-print space-y-4">
          <Card>
            <SectionTitle>Шаблон</SectionTitle>
            <div className="space-y-3">
              <Field label="Размер ценника">
                <Select value={size} onChange={(e) => setSize(e.target.value as SizeKey)}>
                  {Object.entries(SIZES).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} className="h-4 w-4" /> Название</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={showBarcode} onChange={(e) => setShowBarcode(e.target.checked)} className="h-4 w-4" /> Штрихкод</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={showShop} onChange={(e) => setShowShop(e.target.checked)} className="h-4 w-4" /> Магазин</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={showSku} onChange={(e) => setShowSku(e.target.checked)} className="h-4 w-4" /> Артикул</label>
              </div>
              {showShop && (
                <Field label="Название магазина">
                  <Input value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder="Мой магазин" />
                </Field>
              )}
            </div>
          </Card>

          <Card>
            <div className="mb-2 flex items-center justify-between">
              <SectionTitle>Товары</SectionTitle>
              <div className="flex gap-2">
                <button onClick={selectAllFiltered} className="text-xs font-medium text-indigo-600 hover:underline">Выбрать все</button>
                {totalLabels > 0 && <button onClick={clearAll} className="text-xs font-medium text-rose-600 hover:underline">Очистить</button>}
              </div>
            </div>
            <SearchInput value={q} onChange={setQ} placeholder="Поиск по названию / ШК / артикулу" />
            <div className="mt-2 max-h-[420px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.length === 0 && <EmptyState title="Товары не найдены" />}
              {filtered.map((p) => {
                const n = picked[p.id] ?? 0;
                return (
                  <div key={p.id} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{p.name}</div>
                      <div className="truncate text-xs text-slate-400">{money(Number(p.salePrice))} c. · {codeFor(p) || '— нет кода —'}</div>
                    </div>
                    {n > 0 ? (
                      <div className="flex items-center gap-1">
                        <button onClick={() => setCount(p.id, n - 1)} className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700">−</button>
                        <input
                          value={n}
                          onChange={(e) => setCount(p.id, parseInt(e.target.value.replace(/\D/g, '') || '0', 10))}
                          className="h-7 w-10 rounded-md border border-slate-200 text-center text-sm dark:border-slate-700 dark:bg-transparent"
                        />
                        <button onClick={() => setCount(p.id, n + 1)} className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700">+</button>
                      </div>
                    ) : (
                      <Button variant="ghost" onClick={() => add(p.id)} className="!px-3 !py-1 text-xs">+ Ценник</Button>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* ---- Правая колонка: предпросмотр + печать ---- */}
        <div>
          <div className="no-print mb-3 flex items-center justify-between">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              К печати: <b className="text-slate-800 dark:text-slate-100">{totalLabels}</b> ценник(ов)
            </div>
            <Button variant="primary" onClick={() => window.print()} disabled={totalLabels === 0}>
              <NavIcon name="print" className="mr-1.5 inline h-4 w-4" /> Печать
            </Button>
          </div>

          {totalLabels === 0 ? (
            <div className="no-print">
              <EmptyState icon="print" title="Ценники не выбраны" hint="Добавьте товары слева — здесь появится предпросмотр" />
            </div>
          ) : (
            <div id="label-print" className="flex flex-wrap gap-[2mm] rounded-xl bg-slate-100 p-[3mm] dark:bg-slate-800/40 print:bg-white print:p-0">
              {labels.map((p, i) => {
                const code = codeFor(p);
                return (
                  <div
                    key={i}
                    style={{ width: `${s.w}mm`, height: `${s.h}mm` }}
                    className="flex flex-col items-center justify-between overflow-hidden border border-slate-300 bg-white px-[1.5mm] py-[1mm] text-center text-black"
                  >
                    {showShop && shopName && (
                      <div className="w-full truncate text-[7pt] font-semibold uppercase leading-none text-slate-500">{shopName}</div>
                    )}
                    {showName && (
                      <div style={{ fontSize: `${s.name}pt` }} className="line-clamp-2 w-full font-semibold leading-tight">{p.name}</div>
                    )}
                    <div style={{ fontSize: `${s.price}pt` }} className="font-extrabold leading-none">
                      {money(Number(p.salePrice))} <span className="text-[9pt] font-bold">c.</span>
                    </div>
                    {showBarcode && code && <Barcode value={code} heightPx={s.bar} />}
                    {showSku && p.sku && <div className="text-[7pt] text-slate-500">арт. {p.sku}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
