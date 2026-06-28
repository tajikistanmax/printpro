'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { DEFAULT_POS_LAYOUT } from '@/lib/pos-layouts';
import { SKINS, type CartItem, type PosCtx } from './_pos';
import { useFeatureFlags } from '@/lib/feature-flags';
import { sendDisplay, openCustomerDisplay } from '@/lib/customer-display';

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(n) + ' c.';
}

const METHODS = [
  { k: 'CASH', l: 'Наличные' },
  { k: 'CARD', l: 'Карта' },
  { k: 'QR', l: 'QR' },
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
  const [msg, setMsg] = useState('');
  const [receipt, setReceipt] = useState<any | null>(null);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
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
    if (!displayOn) return;
    if (receipt) return; // во время показа чека дисплей держит экран оплаты
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
  }, [cart, subtotal, total, totalDiscount, shopName, receipt, displayOn]);

  // После оплаты показываем итог/«спасибо» на дисплее
  useEffect(() => {
    if (!displayOn || !receipt) return;
    sendDisplay({
      type: 'total',
      shopName,
      total: Number(receipt.total),
      method: receipt._method,
    });
  }, [receipt, shopName, displayOn]);

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

  const splitSum = METHODS.reduce(
    (s, m) => s + (Number(splitAmounts[m.k]) || 0),
    0,
  );
  const splitLeft = Number((total - splitSum).toFixed(2));

  async function pay(overrideMethod?: string) {
    if (cart.length === 0) return;
    setMsg('');
    const useMethod = overrideMethod ?? method;

    let payments: { method: string; amount: number }[] | undefined;
    if (split) {
      payments = METHODS.map((m) => ({
        method: m.k,
        amount: Number(splitAmounts[m.k]) || 0,
      })).filter((p) => p.amount > 0);
      const sum = Number(payments.reduce((s, p) => s + p.amount, 0).toFixed(2));
      if (sum !== total) {
        setMsg(`Сумма частей (${sum}) должна равняться итогу (${total})`);
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
        method: split ? undefined : useMethod,
        payments,
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
        _method: split
          ? payments!
              .map((p) => `${METHODS.find((m) => m.k === p.method)?.l} ${p.amount}`)
              .join(', ')
          : METHODS.find((m) => m.k === useMethod)?.l,
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
    pay: () => {
      void pay();
    },
    payWith,
    msg,
    recentOrders,
    orderStats,
  };

  const Skin = SKINS[layout] ?? SKINS[DEFAULT_POS_LAYOUT];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-800">Касса — продажа</h1>
        {displayOn && (
          <button
            onClick={openCustomerDisplay}
            title="Открыть второй экран для покупателя"
            className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            🖥 Второй экран
          </button>
        )}
      </div>

      <Skin ctx={ctx} />

      {/* Чек после продажи */}
      {receipt && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-80 rounded-2xl bg-white p-6 shadow-2xl">
            <div className="receipt-print">
              <div className="text-center">
                <div className="text-lg font-bold">PrintPro</div>
                <div className="text-xs text-slate-500">Чек продажи</div>
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
              <div className="mt-3 text-center text-xs text-slate-400">
                Спасибо за заказ!
              </div>
            </div>

            <div className="no-print mt-5 flex gap-2">
              <button
                onClick={() => window.print()}
                className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                🖨 Печать
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
