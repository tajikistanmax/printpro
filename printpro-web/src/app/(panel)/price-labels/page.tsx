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

// --- Форматы простых ярлыков (мм) ---
type SizeKey = '30x20' | '40x30' | '50x25' | '58x40';
const SIZES: Record<SizeKey, { w: number; h: number; bar: number; price: number; name: number; label: string }> = {
  '30x20': { w: 30, h: 20, bar: 22, price: 13, name: 8, label: '30×20 мм — мелкий' },
  '40x30': { w: 40, h: 30, bar: 30, price: 17, name: 9, label: '40×30 мм — стандарт' },
  '50x25': { w: 50, h: 25, bar: 34, price: 15, name: 8, label: '50×25 мм — узкий' },
  '58x40': { w: 58, h: 40, bar: 40, price: 22, name: 11, label: '58×40 мм — крупный' },
};

// --- Дизайны ценника-карточки (варианты 1/3/4 с макета) ---
type Design = 'simple' | 'v1' | 'v3' | 'v4';
const DESIGNS: { key: Design; label: string; hint: string }[] = [
  { key: 'simple', label: 'Простой ярлык', hint: 'Мелкий ценник со штрихкодом (30–58 мм)' },
  { key: 'v1', label: 'Дизайн 1 — Классический', hint: 'Логотип, характеристики, цена в блоке' },
  { key: 'v3', label: 'Дизайн 3 — Акцент', hint: 'Цена в фигуре + нижняя полоса' },
  { key: 'v4', label: 'Дизайн 4 — Тёмная шапка', hint: 'Тёмная шапка с диагональю' },
];
const RICH_W = 90; // мм — размер карточек дизайнов 1/3/4
const RICH_H = 60;

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
// Единица измерения товара (для строки «за 1 …»)
function unitOf(p: any): string {
  return (p.unit?.name || 'шт').toString();
}
// Характеристики из реальных полей товара (до 4 строк)
function specRows(p: any): [string, string][] {
  const rows: [string, string][] = [];
  if (p.size) rows.push(['Размер', String(p.size)]);
  if (p.category?.name) rows.push(['Категория', String(p.category.name)]);
  if (p.weight) rows.push(['Вес', String(p.weight)]);
  if (p.unit?.name) rows.push(['Ед. изм.', String(p.unit.name)]);
  return rows.slice(0, 4);
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

// --- Логотип-марка (градиентная «P» как на макете) ---
function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <div
      style={{ width: size, height: size, background: 'linear-gradient(135deg,#6366f1,#a855f7)' }}
      className="grid shrink-0 place-items-center rounded-lg"
    >
      <span style={{ fontSize: size * 0.58 }} className="font-black leading-none text-white">P</span>
    </div>
  );
}

function Brand({ name, tagline, dark }: { name: string; tagline?: string; dark?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <LogoMark size={24} />
      <div className="min-w-0 leading-tight">
        <div className={`truncate text-[12pt] font-extrabold ${dark ? 'text-white' : 'text-slate-900'}`}>{name || 'PrintPro'}</div>
        {tagline && (
          <div className={`truncate text-[6pt] ${dark ? 'text-slate-300' : 'text-slate-400'}`}>{tagline}</div>
        )}
      </div>
    </div>
  );
}

function SpecList({ rows, dark }: { rows: [string, string][]; dark?: boolean }) {
  return (
    <div className="space-y-[1mm]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-1 text-[7.5pt] leading-tight">
          <span className={`font-semibold ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{k}:</span>
          <span className={dark ? 'text-slate-200' : 'text-slate-700'}>{v}</span>
        </div>
      ))}
    </div>
  );
}

const cardBox = 'relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-black';

// Дизайн 1 — Классический
function CardV1({ p, brand, tagline, showBarcode }: any) {
  const code = codeFor(p);
  return (
    <div style={{ width: `${RICH_W}mm`, height: `${RICH_H}mm` }} className={`${cardBox} p-[4mm]`}>
      <div className="flex items-start justify-between gap-2">
        <Brand name={brand} tagline={tagline} />
        {p.sku && (
          <span className="shrink-0 rounded-full bg-indigo-600 px-2 py-0.5 text-[7pt] font-bold text-white">АРТ: {p.sku}</span>
        )}
      </div>
      <div className="mt-[2mm] line-clamp-1 text-[15pt] font-extrabold leading-tight text-slate-900">{p.name}</div>
      <div className="mt-[1mm] flex flex-1 items-start justify-between gap-2">
        <SpecList rows={specRows(p)} />
        <div
          className="grid shrink-0 place-items-center rounded-xl px-3 py-2 text-center text-white"
          style={{ background: 'linear-gradient(135deg,#6366f1,#7c3aed)' }}
        >
          <div className="text-[19pt] font-black leading-none">
            {money(Number(p.salePrice))}
            <span className="text-[8pt] font-bold"> сом</span>
          </div>
          <div className="mt-0.5 text-[6.5pt] opacity-90">за 1 {unitOf(p)}</div>
        </div>
      </div>
      {showBarcode && code && (
        <div className="mt-auto flex justify-end pt-[1mm]">
          <Barcode value={code} heightPx={28} />
        </div>
      )}
    </div>
  );
}

// Дизайн 3 — Акцент (фигура цены + нижняя полоса)
function CardV3({ p, brand, tagline, showBarcode }: any) {
  const code = codeFor(p);
  return (
    <div style={{ width: `${RICH_W}mm`, height: `${RICH_H}mm` }} className={`${cardBox} p-[4mm] pb-[6mm]`}>
      <div className="flex items-start justify-between gap-2">
        <Brand name={brand} tagline={tagline} />
        {p.sku && (
          <span className="shrink-0 rounded-full bg-violet-600 px-2 py-0.5 text-[7pt] font-bold text-white">АРТ: {p.sku}</span>
        )}
      </div>
      <div className="mt-[2mm] line-clamp-1 text-[15pt] font-extrabold leading-tight text-slate-900">{p.name}</div>
      <div className="mt-[1mm] flex flex-1 items-start justify-between gap-2">
        <SpecList rows={specRows(p)} />
        <div
          className="shrink-0 px-4 py-2 text-center text-white"
          style={{ background: 'linear-gradient(135deg,#7c3aed,#a855f7)', transform: 'skewX(-8deg)' }}
        >
          <div style={{ transform: 'skewX(8deg)' }}>
            <div className="text-[19pt] font-black leading-none">
              {money(Number(p.salePrice))}
              <span className="text-[8pt] font-bold"> сом</span>
            </div>
            <div className="mt-0.5 text-[6.5pt] opacity-90">за 1 {unitOf(p)}</div>
          </div>
        </div>
      </div>
      {showBarcode && code && (
        <div className="mt-auto flex justify-end pt-[1mm]">
          <Barcode value={code} heightPx={26} />
        </div>
      )}
      {/* нижняя акцентная полоса */}
      <div className="absolute inset-x-0 bottom-0 h-[3mm]" style={{ background: 'linear-gradient(90deg,#7c3aed,#a855f7)' }} />
    </div>
  );
}

// Дизайн 4 — Тёмная шапка с диагональю
function CardV4({ p, brand, tagline, showBarcode }: any) {
  const code = codeFor(p);
  return (
    <div style={{ width: `${RICH_W}mm`, height: `${RICH_H}mm` }} className={cardBox}>
      <div
        className="px-[4mm] pt-[3mm] pb-[7mm]"
        style={{ background: '#0f172a', clipPath: 'polygon(0 0, 100% 0, 100% 68%, 0 100%)' }}
      >
        <div className="flex items-start justify-between gap-2">
          <Brand name={brand} tagline={tagline} dark />
          {p.sku && <span className="shrink-0 text-[7pt] text-slate-300">АРТ: {p.sku}</span>}
        </div>
      </div>
      <div className="flex flex-1 flex-col px-[4mm] pb-[3mm]">
        <div className="-mt-[3mm] line-clamp-1 text-[15pt] font-extrabold leading-tight text-slate-900">{p.name}</div>
        <div className="mt-[1mm] flex flex-1 items-start justify-between gap-2">
          <SpecList rows={specRows(p)} />
          <div className="shrink-0 text-right">
            <div className="text-[21pt] font-black leading-none text-indigo-600">
              {money(Number(p.salePrice))}
              <span className="text-[8pt] font-bold text-indigo-500"> сом</span>
            </div>
            <div className="mt-0.5 text-[6.5pt] text-slate-400">за 1 {unitOf(p)}</div>
          </div>
        </div>
        {showBarcode && code && (
          <div className="mt-auto flex justify-end pt-[1mm]">
            <Barcode value={code} heightPx={26} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function PriceLabelsPage() {
  const cid = DEFAULT_COMPANY_ID;
  const [products, setProducts] = useState<any[]>([]);
  const [shopName, setShopName] = useState('');
  const [tagline, setTagline] = useState('Печатаем идеи в реальность');
  const [q, setQ] = useState('');

  // выбранные товары: id -> количество ценников
  const [picked, setPicked] = useState<Record<string, number>>({});

  // дизайн + шаблон (по умолчанию — стандартный простой ярлык)
  const [design, setDesign] = useState<Design>('simple');
  const [size, setSize] = useState<SizeKey>('40x30');
  const [showName, setShowName] = useState(true);
  const [showBarcode, setShowBarcode] = useState(true);
  const [showShop, setShowShop] = useState(true);
  const [showSku, setShowSku] = useState(false);

  const rich = design !== 'simple';

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

  const brand = shopName || 'PrintPro';

  function renderLabel(p: any, i: number) {
    if (design === 'v1') return <CardV1 key={i} p={p} brand={brand} tagline={showShop ? tagline : ''} showBarcode={showBarcode} />;
    if (design === 'v3') return <CardV3 key={i} p={p} brand={brand} tagline={showShop ? tagline : ''} showBarcode={showBarcode} />;
    if (design === 'v4') return <CardV4 key={i} p={p} brand={brand} tagline={showShop ? tagline : ''} showBarcode={showBarcode} />;
    // simple
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
  }

  return (
    <div>
      {/* Правила печати: на печать выводим только сетку ценников (с сохранением цвета фонов) */}
      <style>{`
        @media print {
          @page { margin: 6mm; }
          body * { visibility: hidden !important; }
          #label-print, #label-print * { visibility: visible !important; }
          #label-print { position: absolute; left: 0; top: 0; width: 100%; }
          #label-print, #label-print * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          #label-print > * { break-inside: avoid; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print">
        <PageHeader
          title="Ценники"
          subtitle="Выберите дизайн, товары и распечатайте ценники со штрихкодом"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        {/* ---- Левая колонка: дизайн + товары ---- */}
        <div className="no-print space-y-4">
          <Card>
            <SectionTitle>Дизайн ценника</SectionTitle>
            <div className="grid grid-cols-1 gap-2">
              {DESIGNS.map((d) => (
                <button
                  key={d.key}
                  onClick={() => setDesign(d.key)}
                  className={`rounded-lg border p-2.5 text-left transition ${
                    design === d.key
                      ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500 dark:bg-indigo-500/10'
                      : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
                  }`}
                >
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{d.label}</div>
                  <div className="text-xs text-slate-400">{d.hint}</div>
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <SectionTitle>Настройки</SectionTitle>
            <div className="space-y-3">
              {!rich && (
                <Field label="Размер ярлыка">
                  <Select value={size} onChange={(e) => setSize(e.target.value as SizeKey)}>
                    {Object.entries(SIZES).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </Select>
                </Field>
              )}
              {rich && (
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/40">
                  Размер карточки: {RICH_W}×{RICH_H} мм · 2 в ряд на листе A4
                </div>
              )}

              {!rich && (
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} className="h-4 w-4" /> Название</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={showBarcode} onChange={(e) => setShowBarcode(e.target.checked)} className="h-4 w-4" /> Штрихкод</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={showShop} onChange={(e) => setShowShop(e.target.checked)} className="h-4 w-4" /> Магазин</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={showSku} onChange={(e) => setShowSku(e.target.checked)} className="h-4 w-4" /> Артикул</label>
                </div>
              )}

              {rich && (
                <div className="grid grid-cols-1 gap-2 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={showBarcode} onChange={(e) => setShowBarcode(e.target.checked)} className="h-4 w-4" /> Показывать штрихкод</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={showShop} onChange={(e) => setShowShop(e.target.checked)} className="h-4 w-4" /> Показывать слоган</label>
                </div>
              )}

              {(showShop || rich) && (
                <Field label={rich ? 'Название бренда' : 'Название магазина'}>
                  <Input value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder="PrintPro" />
                </Field>
              )}
              {rich && showShop && (
                <Field label="Слоган">
                  <Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Печатаем идеи в реальность" />
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
                        <button aria-label="Убрать" onClick={() => setCount(p.id, n - 1)} className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700">−</button>
                        <input
                          value={n}
                          onChange={(e) => setCount(p.id, parseInt(e.target.value.replace(/\D/g, '') || '0', 10))}
                          className="h-7 w-10 rounded-md border border-slate-200 text-center text-sm dark:border-slate-700 dark:bg-transparent"
                        />
                        <button aria-label="Добавить" onClick={() => setCount(p.id, n + 1)} className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700">+</button>
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
            <div
              id="label-print"
              className={`flex flex-wrap rounded-xl bg-slate-100 p-[3mm] dark:bg-slate-800/40 print:bg-white print:p-0 ${rich ? 'gap-[3mm]' : 'gap-[2mm]'}`}
            >
              {labels.map((p, i) => renderLabel(p, i))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
