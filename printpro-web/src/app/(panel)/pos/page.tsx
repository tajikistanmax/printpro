'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { DEFAULT_POS_LAYOUT } from '@/lib/pos-layouts';
import { DEFAULT_DISPLAY_LAYOUT } from '@/lib/display-layouts';
import { SKINS, type CartItem, type PosCtx } from './_pos';
import { useFeatureFlags } from '@/lib/feature-flags';
import { sendDisplay, openCustomerDisplay, resetDisplay } from '@/lib/customer-display';
import { readVfdConfig, vfdShow, DEFAULT_VFD, type VfdConfig } from '@/lib/vfd-display';
import {
  readEscposConfig,
  escposPrint,
  escposSupported,
  DEFAULT_ESCPOS,
  type EscposConfig,
  type ReceiptData,
} from '@/lib/escpos-printer';
import QRCode from 'qrcode';

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(n) + ' c.';
}

// Способы оплаты на кассе. «Смешанная» — это оплата частями (наличные + перевод),
// «В долг» — заказ остаётся неоплаченным (показывается, только если включено в настройках).
const METHODS = [
  { k: 'CASH', l: 'Наличные' },
  { k: 'CARD', l: 'Карта' },
  { k: 'QR', l: 'QR' },
  { k: 'TRANSFER', l: 'Перевод' },
  { k: 'MIXED', l: 'Смешанная' },
  { k: 'DEBT', l: 'В долг' },
];
// Реальные «деньги» для смешанной оплаты (без MIXED/DEBT):
const SPLIT_METHODS = [
  { k: 'CASH', l: 'Наличные' },
  { k: 'CARD', l: 'Карта' },
  { k: 'QR', l: 'QR' },
  { k: 'TRANSFER', l: 'Перевод' },
];
// Подписи всех способов оплаты (для чека) — включая карту/QR, которых нет в METHODS.
const METHOD_LABEL: Record<string, string> = {
  CASH: 'Наличные',
  CARD: 'Карта',
  QR: 'QR',
  TRANSFER: 'Перевод',
  MIXED: 'Смешанная',
  DEBT: 'В долг',
};

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
  const [displayLayout, setDisplayLayout] = useState<string>(DEFAULT_DISPLAY_LAYOUT);
  const [displayQr, setDisplayQr] = useState('');
  const [vfdCfg, setVfdCfg] = useState<VfdConfig>(DEFAULT_VFD);
  const [scanMsg, setScanMsg] = useState('');
  const scanRef = useRef<(code: string) => void>(() => {});
  const lastScanRef = useRef<{ code: string; t: number }>({ code: '', t: 0 });
  const [shopInfo, setShopInfo] = useState<{ address?: string; phone?: string; inn?: string }>({});
  const [transferPay, setTransferPay] = useState<{ qr?: string; requisite?: string }>({});
  const [qrUrl, setQrUrl] = useState('');
  const [escposCfg, setEscposCfg] = useState<EscposConfig>(DEFAULT_ESCPOS);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [promoMsg, setPromoMsg] = useState('');
  const [useBonus, setUseBonus] = useState('');
  const [phone, setPhone] = useState('');
  const [clientName, setClientName] = useState('');
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
        if (ui?.customerDisplayLayout) setDisplayLayout(ui.customerDisplayLayout);
        if (ui?.displayQr) setDisplayQr(ui.displayQr);
        if (ui?.companyName) setShopName(ui.companyName);
        if (ui) {
          setVfdCfg(readVfdConfig(ui));
          setEscposCfg(readEscposConfig(ui));
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

  // Множество id категории + всех её подкатегорий — чтобы фильтр по родительской
  // категории показывал и товары из подкатегорий (двухуровневые категории).
  const catSet = useMemo(() => {
    if (catFilter === 'ALL') return null;
    const set = new Set<string>([catFilter]);
    let added = true;
    while (added) {
      added = false;
      for (const c of cats) {
        if (c.parentId && set.has(c.parentId) && !set.has(c.id)) {
          set.add(c.id);
          added = true;
        }
      }
    }
    return set;
  }, [catFilter, cats]);

  const filtered = useMemo(
    () =>
      catalog.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) &&
          (!catSet || catSet.has(c.categoryId)),
      ),
    [catalog, search, catSet],
  );

  function switchTab(t: 'SERVICE' | 'PRODUCT') {
    setTab(t);
    setCatFilter('ALL');
  }

  const addItem = useCallback((item: any, type: 'SERVICE' | 'PRODUCT') => {
    const itemType = type;
    const id = item.id;
    const unitPrice = Number(type === 'SERVICE' ? item.basePrice : item.salePrice) || 0;
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
  }, []);

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
  // Бонусы списываются только у клиента (бэкенд применяет их лишь при clientId).
  // Без выбранного клиента бонус не уменьшает итог — иначе экран покажет заниженную
  // сумму и неправильную сдачу.
  const bonusApplied = phone.trim()
    ? Math.min(Number(useBonus) || 0, Number((afterPromo * 0.3).toFixed(2)))
    : 0;
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
      sendDisplay({ type: 'welcome', shopName, layout: displayLayout, displayQr: displayQr || undefined });
    } else if (method === 'TRANSFER') {
      // Оплата переводом — показываем клиенту QR для сканирования
      sendDisplay({
        type: 'pay-qr',
        shopName,
        layout: displayLayout,
        total,
        qr: transferPay.qr,
        requisite: transferPay.requisite,
      });
    } else {
      sendDisplay({
        type: 'cart',
        shopName,
        layout: displayLayout,
        displayQr: displayQr || undefined,
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
  }, [cart, subtotal, total, totalDiscount, shopName, receipt, displayOn, vfdCfg, cartCount, method, transferPay, displayLayout, displayQr]);

  // При закрытии вкладки/уходе с кассы очищаем второй экран (иначе покупатель
  // видит «зависшую» старую корзину до следующего действия кассира).
  useEffect(() => {
    if (!displayOn) return;
    const clear = () => resetDisplay();
    window.addEventListener('pagehide', clear);
    return () => {
      window.removeEventListener('pagehide', clear);
      clear();
    };
  }, [displayOn]);

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
      layout: displayLayout,
      total: Number(receipt.total),
      method: receipt._method,
    });
  }, [receipt, shopName, displayOn, vfdCfg, displayLayout]);

  // Сканер штрихкодов: «невидимый» захват. Кассир сканирует где угодно на кассе —
  // товар сам падает в корзину. Поиск по штрихкоду или SKU среди загруженных товаров.
  useEffect(() => {
  scanRef.current = (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    // Анти-дребезг: сканеры в режиме «поток» шлют один и тот же код много раз,
    // пока луч наведён. Тот же код в пределах 800мс — игнорируем, чтобы количество
    // не умножалось само. Для добавления второй штуки — сканируйте повторно позже
    // или жмите «+» в корзине.
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (code === lastScanRef.current.code && now - lastScanRef.current.t < 800) return;
    lastScanRef.current = { code, t: now };
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
  }, [addItem, products]);

  // QR-код чека: ссылка на онлайн-просмотр заказа (/r/:id)
  useEffect(() => {
    if (!receipt?.id || typeof window === 'undefined') {
      return;
    }
    const url = `${window.location.origin}/r/${receipt.id}`;
    QRCode.toDataURL(url, { margin: 1, width: 160 })
      .then(setQrUrl)
      .catch(() => setQrUrl(''));
  }, [receipt]);
  const visibleQrUrl = receipt?.id ? qrUrl : '';

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
        if (code.length >= 4) {
          // Не даём Enter от сканера «нажать» кнопку в фокусе (напр. «+» последней
          // позиции в корзине) — иначе увеличится и та позиция, и отсканированная.
          e.preventDefault();
          scanRef.current(code);
        }
        return;
      }
      if (e.key.length === 1) buf += e.key;
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Печать чека на термопринтер (ESC/POS)
  async function printThermal() {
    if (!receipt) return;
    const data: ReceiptData = {
      shopName,
      address: shopInfo.address,
      phone: shopInfo.phone,
      inn: shopInfo.inn,
      orderNumber: receipt.orderNumber,
      receiptNumber: receipt.receiptNumber,
      hasService: receipt._hasService,
      date: receipt._date,
      items: (receipt.items ?? []).map((it: any) => ({
        name: it.description || it.service?.name || it.product?.name || 'Позиция',
        qty: Number(it.quantity),
        total: Number(it.lineTotal),
      })),
      total: Number(receipt.total),
      method: receipt._method,
      onlineUrl:
        typeof window !== 'undefined' && receipt.id
          ? `${window.location.origin}/r/${receipt.id}`
          : undefined,
    };
    const ok = await escposPrint(data, escposCfg);
    if (!ok) setMsg('Не удалось напечатать на термопринтере — проверьте порт/настройки.');
  }

  // Авто-печать чека после продажи (если включено в настройках)
  useEffect(() => {
    if (!receipt || !escposCfg.enabled || !escposCfg.autoPrint || !escposSupported()) return;
    const id = window.setTimeout(() => {
      void printThermal();
    }, 0);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt]);

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
        clientName: clientName || undefined,
        discount: disc || undefined,
        promoCode: promoCode.trim() || undefined,
        // Отправляем УЖЕ обрезанный бонус (как показан на экране и учтён в итоге),
        // а не сырой ввод — иначе чек и второй экран разойдутся по сумме.
        useBonus: bonusApplied > 0 ? bonusApplied : undefined,
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
          : METHOD_LABEL[useMethod] ?? useMethod,
        _change: useMethod === 'CASH' && Number(cashReceived) > 0 ? change : 0,
        _date: new Date().toLocaleString('ru-RU'),
        // Номер заказа показываем на чеке только если есть услуга (изготовление):
        // по нему клиент заберёт готовое. Для чистой продажи товара — только № чека.
        _hasService: cart.some((c) => c.itemType === 'SERVICE'),
      });
      setCart([]);
      setDiscount('');
      setPromoCode('');
      setPromoDiscount(0);
      setPromoMsg('');
      setUseBonus('');
      setPhone('');
    setClientName('');
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
    setClientName('');
    setSplit(false);
    setSplitAmounts({});
    setCashReceived('');
    setNote('');
  }

  // ---- Отложенные чеки ----
  const loadHeld = useCallback(() => {
    api.get(`/orders/held?companyId=${cid}`).then(setHeld).catch(() => {});
  }, [cid]);

  useEffect(() => {
    loadHeld();
  }, [loadHeld]);

  async function hold() {
    if (cart.length === 0) return;
    try {
      await api.post('/orders/held', {
        companyId: cid,
        branchId: branchId || undefined,
        label: clientName || phone || `${cartCount} поз.`,
        note: note || undefined,
        total,
        // Снимок всего чека, а не только корзины: при возобновлении вернём
        // скидку, промокод, бонусы, клиента и примечание (v:2). Старые чеки
        // (плоский массив) по-прежнему открываются — см. resumeHeld.
        items: {
          v: 2,
          cart,
          discount: discount || undefined,
          promoCode: promoCode || undefined,
          promoDiscount: promoDiscount || undefined,
          useBonus: useBonus || undefined,
          phone: phone || undefined,
          clientName: clientName || undefined,
          note: note || undefined,
        },
      });
      clearCart();
      loadHeld();
    } catch (e: any) {
      setMsg('Ошибка: ' + e.message);
    }
  }

  async function resumeHeld(h: any) {
    const data = h.items;
    if (Array.isArray(data)) {
      // Старый формат: только корзина.
      setCart(data);
    } else if (data && Array.isArray(data.cart)) {
      // Новый формат (v:2): восстанавливаем весь контекст чека.
      setCart(data.cart);
      setDiscount(data.discount != null ? String(data.discount) : '');
      setPromoCode(data.promoCode ?? '');
      setPromoDiscount(Number(data.promoDiscount) || 0);
      setPromoMsg(data.promoCode ? 'Промокод восстановлен из отложенного чека' : '');
      setUseBonus(data.useBonus != null ? String(data.useBonus) : '');
      setPhone(data.phone ?? '');
      setClientName(data.clientName ?? '');
      setNote(data.note ?? '');
    } else {
      setCart([]);
    }
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
    clientName,
    setClientName,
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
                aria-label="Удалить"
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
                {(receipt._hasService || !receipt.receiptNumber) && (
                  <div className="flex justify-between">
                    <span>Заказ</span>
                    <span>№{receipt.orderNumber}</span>
                  </div>
                )}
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
              {visibleQrUrl && (
                <div className="mt-3 flex flex-col items-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={visibleQrUrl} alt="QR чека" className="h-24 w-24" />
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
              {escposCfg.enabled && (
                <button
                  onClick={() => void printThermal()}
                  title="Печать на чековый термопринтер"
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
                    <rect x="7" y="14" width="10" height="7" rx="1" />
                  </svg>
                  Термочек
                </button>
              )}
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
