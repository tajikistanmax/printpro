'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { DEFAULT_POS_LAYOUT } from '@/lib/pos-layouts';
import { SKINS, type CartItem, type PosCtx } from './_pos';
import { useFeatureFlags } from '@/lib/feature-flags';
import { sendDisplay, openCustomerDisplay } from '@/lib/customer-display';
import { readVfdConfig, vfdShow, DEFAULT_VFD, type VfdConfig } from '@/lib/vfd-display';
import QRCode from 'qrcode';

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(n) + ' c.';
}

// Способы оплаты на кассе. «Смешанная» — это оплата частями (наличные + перевод),
// «В долг» — заказ остаётся неоплаченным (показывается, только если включено в настройках).
const METHODS = [
  { k: 'CASH', l: 'Наличные' },
  { k: 'TRANSFER', l: 'Перевод' },
  { k: 'MIXED', l: 'Смешанная' },
  { k: 'DEBT', l: 'В долг' },
];
// Реальные «деньги» для смешанной оплаты (без MIXED/DEBT):
const SPLIT_METHODS = [
  { k: 'CASH', l: 'Наличные' },
  { k: 'TRANSFER', l: 'Перевод' },
];

export default function PosPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { isEnabled } = useFeatureFlags();
  const [shopName, setShopName] = useState('PrintPro');
  const [tab, setTab] = useState<'SERVICE' | 'PRODUCT'>('SERVICE');
  const [services, setServices] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [serviceCats, setServiceCats] = useState<any[]>([]);
  const [productCats, setProductCats] = useState<any[]>([]);
  const [catFilter, setCatFilter] = useState<string>('ALL');
  const [branchId, setBranchId] = useState('');
  const [search, setSearch] = useState('');
  const [layout, setLayout] = useState<string>(DEFAULT_POS_LAYOUT);
  const [vfdCfg, setVfdCfg] = useState<VfdConfig>(DEFAULT_VFD);
  const [scanMsg, setScanMsg] = useState('');
  const scanRef = useRef<(code: string) => void>(() => {});
  const [shopInfo, setShopInfo] = useState<{ address?: string; phone?: string; inn?: string }>({});
  const [transferPay, setTransferPay] = useState<{ qr?: string; requisite?: string }>({});
  const [qrUrl, setQrUrl] = useState('');

  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [promoMsg, setPromoMsg] = useState('');
  const [useBonus, setUseBonus] = useState('');
  const [phone, setPhone] = useState('');
  const [method, setMethod] = useState('CASH');
  const [split, setSplit] = useState(false);
  const [splitAmounts, setSplitAmounts] = useState<Record<string, string>>({});
  const [cashReceived, setCashReceived] = useState(''); // получено наличными (для сдачи)
  const [note, setNote] = useState(''); // примечание к заказу
  const [msg, setMsg] = useState('');
  const [receipt, setReceipt] = useState<any | null>(null);
  // Ключ идемпотентности: один на «корзину», новый — после успешной продажи.
  // Защищает от двойного списания при двойном клике / обрыве сети.
  const [saleKey, setSaleKey] = useState<string>(() =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `pos-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
  );
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [held, setHeld] = useState<any[]>([]);
  const [orderStats, setOrderStats] = useState({
    active: 0,
    inWork: 0,
    ready: 0,
    overdue: 0,
  });

  useEffect(() => {
    api.get(`/services?companyId=${cid}`).then(setServices).catch(() => {});
    api.get(`/products?companyId=${cid}`).then(setProducts).catch(() => {});
    api
      .get(`/service-categories?companyId=${cid}`)
      .then(setServiceCats)
      .catch(() => {});
    api
      .get(`/product-categories?companyId=${cid}`)
      .then(setProductCats)
      .catch(() => {});
    api
      .get(`/branches?companyId=${cid}`)
      .then((b) => b[0] && setBranchId(b[0].id))
      .catch(() => {});
    // Выбранное оформление кассы + название (публичные UI-настройки)
    api
      .get(`/settings/ui?companyId=${cid}`)
      .then((ui) => {
        if (ui?.posLayout) setLayout(ui.posLayout);
        if (ui?.companyName) setShopName(ui.companyName);
        if (ui) {
          setVfdCfg(readVfdConfig(ui));
          setShopInfo({
            address: ui.companyAddress,
            phone: ui.phone,
            inn: ui.companyInn,
          });
          setTransferPay({ qr: ui.payTransferQr, requisite: ui.payTransferRequisite });
        }
      })
      .catch(() => {});
    // Недавние заказы + статистика (для богатых оформлений). Требует orders.view —
    // если права нет, просто останутся пустыми.
    api
      .get(`/orders?companyId=${cid}&page=1&pageSize=50`)
      .then((res) => {
        const list: any[] = res?.items ?? [];
        setRecentOrders(list.slice(0, 4));
        const now = Date.now();
        const active = list.filter(
          (o) => o.status !== 'DELIVERED' && o.status !== 'CANCELLED',
        );
        const inWorkSet = [
          'IN_PROGRESS',
          'IN_DESIGN',
          'DESIGN_APPROVAL',
          'DESIGN_APPROVED',
          'AWAITING_DESIGN',
          'REWORK',
        ];
        setOrderStats({
          active: active.length,
          inWork: active.filter((o) => inWorkSet.includes(o.status)).length,
          ready: active.filter((o) => o.status === 'READY').length,
          overdue: active.filter(
            (o) => o.deadline && new Date(o.deadline).getTime() < now,
          ).length,
        });
      })
      .catch(() => {});
  }, [cid]);

  const catalog = tab === 'SERVICE' ? services : products;
  const cats = tab === 'SERVICE' ? serviceCats : productCats;
  const priceOf = (item: any, type: 'SERVICE' | 'PRODUCT') =>
    Number(type === 'SERVICE' ? item.basePrice : item.salePrice) || 0;

  const filtered = useMemo(
    () =>
      catalog.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) &&
          (catFilter === 'ALL' || c.categoryId === catFilter),
      ),
    [catalog, search, catFilter, tab],
  );

  function switchTab(t: 'SERVICE' | 'PRODUCT') {
    setTab(t);
    setCatFilter('ALL');
  }

  function addItem(item: any, type: 'SERVICE' | 'PRODUCT') {
    const itemType = type;
    const id = item.id;
    const unitPrice = priceOf(item, type);
    const key = `${itemType}:${id}`;
    setCart((prev) => {
      const ex = prev.find((p) => p.key === key);
      if (ex)
        return prev.map((p) =>
          p.key === key ? { ...p, quantity: p.quantity + 1 } : p,
        );
      return [
        ...prev,
        { key, itemType, id, name: item.name, unitPrice, quantity: 1 },
      ];
    });
  }

  function setQty(key: string, q: number) {
    setCart((prev) =>
      prev
        .map((p) => (p.key === key ? { ...p, quantity: Math.max(0, q) } : p))
        .filter((p) => p.quantity > 0),
    );
  }

  const subtotal = cart.reduce((s, c) => s + c.unitPrice * c.quantity, 0);
  const disc = Math.min(Number(discount) || 0, subtotal);
  const afterDisc = Math.max(0, subtotal - disc);
  const promo = Math.min(promoDiscount, afterDisc);
  const afterPromo = Math.max(0, afterDisc - promo);
  const bonusApplied = Math.min(
    Number(useBonus) || 0,
    Number((afterPromo * 0.3).toFixed(2)),
  );
  const total = Math.max(0, Number((afterPromo - bonusApplied).toFixed(2)));
  const cartCount = cart.reduce((s, c) => s + c.quantity, 0);
  const totalDiscount = Math.max(0, Number((subtotal - total).toFixed(2)));
  const displayOn = isEnabled('feature.customerDisplay');

  // Транслируем корзину на дисплей покупателя (второй экран)
  useEffect(() => {
    if (receipt) return; // во время показа чека дисплей держит экран оплаты
    // Текстовый VFD-дисплей (линейный) — независимо от графического
    if (vfdCfg.enabled) {
      if (cart.length === 0) {
        vfdShow(shopName.slice(0, vfdCfg.width), 'Добро пожаловать', vfdCfg);
      } else {
        vfdShow(`Позиций: ${cartCount}`, `Итого: ${money(total)}`, vfdCfg);
      }
    }
    if (!displayOn) return;
    if (cart.length === 0) {
      sendDisplay({ type: 'welcome', shopName });
    } else {
      sendDisplay({
        type: 'cart',
        shopName,
        lines: cart.map((c) => ({
          name: c.name,
          qty: c.quantity,
          price: c.unitPrice,
          total: Number((c.unitPrice * c.quantity).toFixed(2)),
        })),
        subtotal,
        discount: totalDiscount,
        total,
      });
    }
  }, [cart, subtotal, total, totalDiscount, shopName, receipt, displayOn, vfdCfg, cartCount]);

  // После оплаты показываем итог/«спасибо» на дисплее
  useEffect(() => {
    if (!receipt) return;
    if (vfdCfg.enabled) {
      vfdShow(`К оплате: ${money(Number(receipt.total))}`, 'Спасибо за покупку', vfdCfg);
    }
    if (!displayOn) return;
    sendDisplay({
      type: 'total',
      shopName,
      total: Number(receipt.total),
      method: receipt._method,
    });
  }, [receipt, shopName, displayOn, vfdCfg]);

  // Сканер штрихкодов: «невидимый» захват. Кассир сканирует где угодно на кассе —
  // товар сам падает в корзину. Поиск по штрихкоду или SKU среди загруженных товаров.
  scanRef.current = (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const p = products.find(
      (x) =>
        x.barcode === code ||
        x.sku === code ||
        (x.barcodeAliases ?? []).some((a: any) => a.barcode === code),
    );
    if (p) {
      addItem(p, 'PRODUCT');
      setScanMsg(`✓ ${p.name}`);
    } else {
      setScanMsg(`✗ Штрихкод ${code} не найден`);
    }
  };

  // QR-код чека: ссылка на онлайн-просмотр заказа (/r/:id)
  useEffect(() => {
    if (!receipt?.id || typeof window === 'undefined') {
      setQrUrl('');
      return;
    }
    const url = `${window.location.origin}/r/${receipt.id}`;
    QRCode.toDataURL(url, { margin: 1, width: 160 })
      .then(setQrUrl)
      .catch(() => setQrUrl(''));
  }, [receipt]);

  // Автоскрытие подсказки скана
  useEffect(() => {
    if (!scanMsg) return;
    const id = setTimeout(() => setScanMsg(''), 2500);
    return () => clearTimeout(id);
  }, [scanMsg]);

  // Глобальный перехват сканера (keyboard-wedge): быстрый ввод + Enter = штрихкод.
  // Во время ручного ввода в поля (INPUT/TEXTAREA) не вмешиваемся.
  useEffect(() => {
    let buf = '';
    let last = 0;
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      ) {
        return; // печатают вручную — не мешаем
      }
      const gap = e.timeStamp - last;
      last = e.timeStamp;
      if (gap > 80) buf = ''; // медленно = человек: сбрасываем
      if (e.key === 'Enter') {
        const code = buf;
        buf = '';
        if (code.length >= 4) scanRef.current(code);
        return;
      }
      if (e.key.length === 1) buf += e.key;
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function checkPromo() {
    setPromoMsg('');
    if (!promoCode.trim()) {
      setPromoDiscount(0);
      return;
    }
    try {
      const r = await api.post('/promocodes/validate', {
        companyId: cid,
        code: promoCode.trim(),
        subtotal: afterDisc,
      });
      if (r.valid) {
        setPromoDiscount(r.discount);
        setPromoMsg(`✓ скидка ${r.discount} c.`);
      } else {
        setPromoDiscount(0);
        setPromoMsg(r.message ?? 'неверный код');
      }
    } catch {
      setPromoDiscount(0);
      setPromoMsg('ошибка проверки');
    }
  }

  const splitSum = SPLIT_METHODS.reduce(
    (s, m) => s + (Number(splitAmounts[m.k]) || 0),
    0,
  );
  const splitLeft = Number((total - splitSum).toFixed(2));
  // Смешанная оплата = выбран способ MIXED. Сдача — только для наличных.
  const isMixed = method === 'MIXED';
  const change =
    method === 'CASH' && Number(cashReceived) > 0
      ? Number((Number(cashReceived) - total).toFixed(2))
      : 0;

  async function pay(overrideMethod?: string) {
    if (cart.length === 0) return;
    setMsg('');
    const useMethod = overrideMethod ?? method;

    const mixed = useMethod === 'MIXED';
    let payments: { method: string; amount: number }[] | undefined;
    if (mixed) {
      payments = SPLIT_METHODS.map((m) => ({
        method: m.k,
        amount: Number(splitAmounts[m.k]) || 0,
      })).filter((p) => p.amount > 0);
      const sum = Number(payments.reduce((s, p) => s + p.amount, 0).toFixed(2));
      if (sum !== total) {
        setMsg(`Сумма частей (${sum} c.) должна равняться итогу (${total} c.)`);
        return;
      }
    }

    try {
      const order = await api.post('/orders/quick-sale', {
        companyId: cid,
        branchId: branchId || undefined,
        clientPhone: phone || undefined,
        discount: disc || undefined,
        promoCode: promoCode.trim() || undefined,
        useBonus: Number(useBonus) > 0 ? Number(useBonus) : undefined,
        note: note.trim() || undefined,
        method: mixed ? undefined : useMethod,
        payments,
        idempotencyKey: saleKey,
        items: cart.map((c) => ({
          itemType: c.itemType,
          serviceId: c.itemType === 'SERVICE' ? c.id : undefined,
          productId: c.itemType === 'PRODUCT' ? c.id : undefined,
          description: c.name,
          quantity: c.quantity,
          unitPrice: c.unitPrice,
        })),
      });
      setReceipt({
        ...order,
        _method: mixed
          ? payments!
              .map((p) => `${SPLIT_METHODS.find((m) => m.k === p.method)?.l} ${p.amount}`)
              .join(', ')
          : METHODS.find((m) => m.k === useMethod)?.l,
        _change: useMethod === 'CASH' && Number(cashReceived) > 0 ? change : 0,
        _date: new Date().toLocaleString('ru-RU'),
      });
      setCart([]);
      setDiscount('');
      setPromoCode('');
      setPromoDiscount(0);
      setPromoMsg('');
      setUseBonus('');
      setPhone('');
      setSplit(false);
      setSplitAmounts({});
      setCashReceived('');
      setNote('');
      // Новый ключ — следующая продажа получит свой
      setSaleKey(
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `pos-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      );
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  const payWith = (m: string) => {
    void pay(m);
  };

  function clearCart() {
    setCart([]);
    setDiscount('');
    setPromoCode('');
    setPromoDiscount(0);
    setPromoMsg('');
    setUseBonus('');
    setPhone('');
    setSplit(false);
    setSplitAmounts({});
    setCashReceived('');
    setNote('');
  }

  // ---- Отложенные чеки ----
  function loadHeld() {
    api.get(`/orders/held?companyId=${cid}`).then(setHeld).catch(() => {});
  }
  useEffect(() => {
    loadHeld();
  }, [cid]);

  async function hold() {
    if (cart.length === 0) return;
    try {
      await api.post('/orders/held', {
        companyId: cid,
        branchId: branchId || undefined,
        label: phone || `${cartCount} поз.`,
        total,
        items: cart,
      });
      clearCart();
      loadHeld();
    } catch (e: any) {
      setMsg('Ошибка: ' + e.message);
    }
  }

  async function resumeHeld(h: any) {
    setCart(Array.isArray(h.items) ? h.items : []);
    try {
      await api.del(`/orders/held/${h.id}`);
    } catch {}
    loadHeld();
  }

  async function deleteHeld(id: string) {
    try {
      await api.del(`/orders/held/${id}`);
    } catch {}
    loadHeld();
  }

  // Собираем контекст для «скина»
  const ctx: PosCtx = {
    money,
    services,
    products,
    serviceCats,
    productCats,
    tab,
    switchTab,
    search,
    setSearch,
    cats,
    catFilter,
    setCatFilter,
    filtered,
    catalogAll: catalog,
    priceOf,
    addItem,
    cart,
    setQty,
    clearCart,
    cartCount,
    subtotal,
    discount,
    setDiscount,
    disc,
    promoCode,
    setPromoCode,
    promoDiscount,
    setPromoDiscount,
    promoMsg,
    setPromoMsg,
    checkPromo,
    useBonus,
    setUseBonus,
    total,
    phone,
    setPhone,
    method,
    setMethod,
    methods: METHODS,
    split,
    setSplit,
    splitAmounts,
    setSplitAmounts,
    splitSum,
    splitLeft,
    splitMethods: SPLIT_METHODS,
    isMixed,
    cashReceived,
    setCashReceived,
    change,
    note,
    setNote,
    debtEnabled: isEnabled('feature.posDebt'),
    promoEnabled: isEnabled('feature.promocodes'),
    scan: (code: string) => scanRef.current(code),
    scanMsg,
    transferQr: transferPay.qr ?? '',
    transferRequisite: transferPay.requisite ?? '',
    pay: () => {
      void pay();
    },
    payWith,
    msg,
    recentOrders,
    orderStats,
    hold: () => {
      void hold();
    },
  };

  const Skin = SKINS[layout] ?? SKINS[DEFAULT_POS_LAYOUT];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-[22px] w-[22px]">
              <rect x="2" y="4" width="20" height="14" rx="2" />
              <path d="M2 8h20M7 18v3M17 18v3M6 21h12" />
            </svg>
          </span>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Касса — продажа</h1>
          <span
            className="hidden items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 sm:flex dark:bg-slate-800 dark:text-slate-400"
            title="Сканируйте штрихкод где угодно на кассе — товар сам добавится в корзину"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" className="h-4 w-4">
              <path d="M3 5v14M7 5v14M11 5v14M14 5v14M18 5v14M21 5v14" />
            </svg>
            Сканер ШК
          </span>
        </div>
        {displayOn && (
          <button
            onClick={openCustomerDisplay}
            title="Открыть второй экран для покупателя"
            className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <rect x="3" y="4" width="18" height="12" rx="2" />
              <path d="M8 20h8M12 16v4" />
            </svg>
            Второй экран
          </button>
        )}
      </div>

      {/* Отложенные чеки — нажми, чтобы вернуть корзину */}
      {held.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-500/30 dark:bg-amber-500/10">
          <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
            Отложенные чеки:
          </span>
          {held.map((h) => (
            <span
              key={h.id}
              className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs shadow-sm dark:border-amber-500/30 dark:bg-slate-800"
            >
              <button
                onClick={() => resumeHeld(h)}
                className="font-medium text-slate-700 transition hover:text-indigo-600 dark:text-slate-200"
                title="Вернуть в корзину"
              >
                {h.label || 'Чек'} · {money(Number(h.total))}
              </button>
              <button
                onClick={() => deleteHeld(h.id)}
                className="text-rose-400 transition hover:text-rose-600"
                title="Удалить"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <Skin ctx={ctx} />

      {/* Тост результата сканирования штрихкода */}
      {scanMsg && (
        <div
          className={`fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-2xl ${
            scanMsg.startsWith('✓') ? 'bg-emerald-600' : 'bg-rose-600'
          }`}
        >
          {scanMsg}
        </div>
      )}

      {/* Чек после продажи */}
      {receipt && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-80 rounded-2xl bg-white p-6 shadow-2xl">
            <div className="receipt-print">
              <div className="text-center">
                <div className="text-lg font-bold">{shopName}</div>
                {shopInfo.address && (
                  <div className="text-[11px] text-slate-500">{shopInfo.address}</div>
                )}
                {shopInfo.phone && (
                  <div className="text-[11px] text-slate-500">тел. {shopInfo.phone}</div>
                )}
                {shopInfo.inn && (
                  <div className="text-[11px] text-slate-500">ИНН {shopInfo.inn}</div>
                )}
                <div className="mt-1 text-xs font-medium text-slate-500">Чек продажи</div>
              </div>
              <div className="my-3 border-y border-dashed border-slate-300 py-2 text-xs">
                {receipt.receiptNumber && (
                  <div className="flex justify-between">
                    <span>Чек</span>
                    <span>{receipt.receiptNumber}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Заказ</span>
                  <span>№{receipt.orderNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span>Дата</span>
                  <span>{receipt._date}</span>
                </div>
              </div>
              <div className="space-y-1 text-sm">
                {receipt.items?.map((it: any) => (
                  <div key={it.id} className="flex justify-between">
                    <span>
                      {it.description ||
                        it.service?.name ||
                        it.product?.name}{' '}
                      ×{Number(it.quantity)}
                    </span>
                    <span>{money(Number(it.lineTotal))}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 border-t border-dashed border-slate-300 pt-2">
                <div className="flex justify-between font-bold">
                  <span>Итого</span>
                  <span>{money(Number(receipt.total))}</span>
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Оплата</span>
                  <span>{receipt._method}</span>
                </div>
              </div>
              {qrUrl && (
                <div className="mt-3 flex flex-col items-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrUrl} alt="QR чека" className="h-24 w-24" />
                  <div className="text-[10px] text-slate-400">Чек онлайн — наведите камеру</div>
                </div>
              )}
              <div className="mt-3 text-center text-xs text-slate-400">
                Спасибо за покупку!
                {shopInfo.phone && (
                  <div className="mt-0.5">По вопросам заказа: {shopInfo.phone}</div>
                )}
              </div>
            </div>

            <div className="no-print mt-5 flex gap-2">
              <button
                onClick={() => window.print()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
                  <rect x="7" y="14" width="10" height="7" rx="1" />
                </svg>
                Печать
              </button>
              <button
                onClick={() => setReceipt(null)}
                className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Новая продажа
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
