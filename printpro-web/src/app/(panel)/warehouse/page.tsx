'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';

const inp =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

const MOV_LABEL: Record<string, string> = {
  IN: 'Приход', OUT: 'Расход', WRITE_OFF: 'Списание', ADJUST: 'Корректировка',
};
const MOV_COLOR: Record<string, string> = {
  IN: 'text-emerald-600', OUT: 'text-rose-600', WRITE_OFF: 'text-amber-600', ADJUST: 'text-sky-600',
};

export default function WarehousePage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const canManage = can('stock.manage');
  const canProducts = can('products.manage');

  const [stock, setStock] = useState<any[]>([]);
  const [low, setLow] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Единицы измерения
  const [uName, setUName] = useState('');
  const [uShort, setUShort] = useState('');
  const [uMsg, setUMsg] = useState('');

  // Категории товаров
  const [catName, setCatName] = useState('');

  // Форма нового товара
  const [pName, setPName] = useState('');
  const [pUnit, setPUnit] = useState('');
  const [pCat, setPCat] = useState('');
  const [pPrice, setPPrice] = useState('');
  const [pMin, setPMin] = useState('');
  const [pMsg, setPMsg] = useState('');

  // Редактирование товара
  const [editPId, setEditPId] = useState<string | null>(null);
  const [editP, setEditP] = useState<any>({});
  const [editPMsg, setEditPMsg] = useState('');

  // Приём товара
  const [productId, setProductId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [qty, setQty] = useState('');
  const [receiveMsg, setReceiveMsg] = useState('');

  // Перемещение
  const [tProduct, setTProduct] = useState('');
  const [tFrom, setTFrom] = useState('');
  const [tTo, setTTo] = useState('');
  const [tQty, setTQty] = useState('');
  const [tMsg, setTMsg] = useState('');

  // Инвентаризация
  const [rProduct, setRProduct] = useState('');
  const [rBranch, setRBranch] = useState('');
  const [rQty, setRQty] = useState('');
  const [rMsg, setRMsg] = useState('');

  // История движений
  const [showMovements, setShowMovements] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([
      api.get(`/stock?companyId=${cid}`),
      api.get(`/stock/low?companyId=${cid}`),
      api.get(`/products?companyId=${cid}`),
      api.get(`/units?companyId=${cid}`),
      api.get(`/branches?companyId=${cid}`),
      api.get(`/product-categories?companyId=${cid}`),
    ])
      .then(([s, l, p, u, b, c]) => {
        setStock(s); setLow(l); setProducts(p); setUnits(u); setBranches(b); setCategories(c);
        if (p[0]) setProductId(p[0].id);
        if (b[0]) { setBranchId(b[0].id); setTFrom(b[0].id); }
        if (u[0]) setPUnit(u[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  function loadMovements() {
    api.get(`/stock/movements?companyId=${cid}`).then(setMovements).catch(() => {});
  }

  useEffect(() => { load(); }, [cid]);
  useEffect(() => { if (showMovements) loadMovements(); }, [showMovements, cid]);

  // ---- единицы измерения ----
  async function addUnit(e: React.FormEvent) {
    e.preventDefault(); setUMsg('');
    if (!uName.trim() || !uShort.trim()) { setUMsg('Заполните оба поля'); return; }
    try {
      await api.post('/units', { companyId: cid, name: uName.trim(), shortName: uShort.trim() });
      setUName(''); setUShort('');
      setUMsg('✓ Добавлено');
      load();
    } catch (err: any) { setUMsg('Ошибка: ' + err.message); }
  }
  async function removeUnit(id: string) {
    if (!confirm('Удалить единицу измерения?')) return;
    try { await api.del(`/units/${id}`); load(); } catch (err: any) { setUMsg('Ошибка: ' + err.message); }
  }

  // ---- категории ----
  async function addCategory() {
    if (!catName.trim()) return;
    await api.post('/product-categories', { companyId: cid, name: catName.trim() });
    setCatName(''); load();
  }
  async function removeCategory(id: string) {
    if (!confirm('Удалить категорию?')) return;
    if (pCat === id) setPCat('');
    await api.del(`/product-categories/${id}`);
    load();
  }

  // ---- новый товар ----
  async function createProduct(e: React.FormEvent) {
    e.preventDefault(); setPMsg('');
    try {
      await api.post('/products', {
        companyId: cid, name: pName,
        categoryId: pCat || undefined,
        unitId: pUnit || undefined,
        salePrice: pPrice ? Number(pPrice) : 0,
        minStock: pMin ? Number(pMin) : 0,
      });
      setPName(''); setPPrice(''); setPMin('');
      setPMsg('✓ Товар добавлен'); load();
    } catch (err: any) { setPMsg('Ошибка: ' + err.message); }
  }

  // ---- редактирование товара ----
  function openEditP(p: any) {
    setEditPId(p.id);
    setEditPMsg('');
    setEditP({ name: p.name, categoryId: p.categoryId ?? '', unitId: p.unitId ?? '', salePrice: String(Number(p.salePrice) || ''), minStock: String(Number(p.minStock) || ''), isActive: p.isActive ?? true });
  }
  async function saveEditP() {
    if (!editPId) return; setEditPMsg('');
    try {
      await api.patch(`/products/${editPId}`, {
        name: editP.name,
        categoryId: editP.categoryId || undefined,
        unitId: editP.unitId || undefined,
        salePrice: editP.salePrice ? Number(editP.salePrice) : 0,
        minStock: editP.minStock ? Number(editP.minStock) : 0,
        isActive: editP.isActive,
      });
      setEditPId(null); load();
    } catch (err: any) { setEditPMsg('Ошибка: ' + err.message); }
  }
  async function deleteProduct(id: string) {
    if (!confirm('Удалить товар? Он должен быть без остатков и без движений.')) return;
    try { await api.del(`/products/${id}`); if (editPId === id) setEditPId(null); load(); }
    catch (err: any) { setPMsg('Ошибка: ' + err.message); }
  }

  // ---- приём ----
  async function receive(e: React.FormEvent) {
    e.preventDefault(); setReceiveMsg('');
    try {
      await api.post('/stock/receive', { companyId: cid, branchId, productId, quantity: Number(qty), reason: 'Приход через панель' });
      setQty('');
      setReceiveMsg('✓ Товар принят на склад');
      load();
      if (showMovements) loadMovements();
    } catch (err: any) { setReceiveMsg('Ошибка: ' + err.message); }
  }

  // ---- перемещение ----
  async function transfer(e: React.FormEvent) {
    e.preventDefault(); setTMsg('');
    try {
      await api.post('/stock/transfer', { companyId: cid, productId: tProduct || products[0]?.id, fromBranchId: tFrom, toBranchId: tTo, quantity: Number(tQty) });
      setTQty(''); setTMsg('✓ Перемещено');
      load();
    } catch (err: any) { setTMsg('Ошибка: ' + err.message); }
  }

  // ---- инвентаризация ----
  async function recount(e: React.FormEvent) {
    e.preventDefault(); setRMsg('');
    try {
      const res = await api.post('/stock/recount', {
        companyId: cid,
        productId: rProduct || products[0]?.id,
        branchId: rBranch || branches[0]?.id,
        countedQuantity: Number(rQty),
      });
      setRQty('');
      setRMsg(`✓ Учтено (расхождение: ${res.diff})`);
      load();
    } catch (err: any) { setRMsg('Ошибка: ' + err.message); }
  }

  const lowIds = new Set(low.map((l) => l.productId));

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-800 dark:text-slate-100">Склад</h1>

      {/* ---- Единицы измерения ---- */}
      {canProducts && (
        <div className="mb-6 rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-900">
          <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">Единицы измерения</h2>
          <div className="mb-3 flex flex-wrap gap-2">
            {units.map((u) => (
              <span key={u.id} className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-sm dark:bg-slate-800">
                <span className="font-medium text-slate-700 dark:text-slate-200">{u.shortName}</span>
                <span className="text-slate-400">({u.name})</span>
                <button onClick={() => removeUnit(u.id)} className="text-rose-400 hover:text-rose-600">✕</button>
              </span>
            ))}
            {units.length === 0 && <span className="text-sm text-slate-400">Нет единиц. Добавьте: шт, м², рул и т.д.</span>}
          </div>
          <form onSubmit={addUnit} className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Полное название</label>
              <input value={uName} onChange={(e) => setUName(e.target.value)} placeholder="Штука"
                className="w-36 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none dark:border-slate-600 dark:bg-slate-800" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Сокращение</label>
              <input value={uShort} onChange={(e) => setUShort(e.target.value)} placeholder="шт"
                className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none dark:border-slate-600 dark:bg-slate-800" />
            </div>
            <button className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
              + Единица
            </button>
            {uMsg && <span className="text-sm text-slate-500">{uMsg}</span>}
          </form>
        </div>
      )}

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        {/* ---- Новый товар ---- */}
        {canProducts && (
          <div className="rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-900">
            <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">Новый товар</h2>
            <form onSubmit={createProduct} className="space-y-3">
              <input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Название товара *"
                required className={inp} />
              <select value={pCat} onChange={(e) => setPCat(e.target.value)} className={inp}>
                <option value="">— без категории —</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div className="grid grid-cols-3 gap-2">
                <select value={pUnit} onChange={(e) => setPUnit(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                  <option value="">ед. изм.</option>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.shortName}</option>)}
                </select>
                <input value={pPrice} onChange={(e) => setPPrice(e.target.value)} type="number" placeholder="Цена"
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                <input value={pMin} onChange={(e) => setPMin(e.target.value)} type="number" placeholder="Порог"
                  title="Оповещение когда меньше порога"
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              </div>
              <button className="w-full rounded-lg bg-emerald-600 py-2 font-medium text-white hover:bg-emerald-700">
                Добавить товар
              </button>
              {pMsg && <p className="text-sm text-slate-600">{pMsg}</p>}
            </form>

            {/* Категории товаров */}
            <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-700">
              <div className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Категории товаров</div>
              <div className="flex flex-wrap items-center gap-2">
                {categories.map((c) => (
                  <span key={c.id} className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {c.name}
                    <button type="button" onClick={() => removeCategory(c.id)} className="text-rose-400 hover:text-rose-600">✕</button>
                  </span>
                ))}
                {categories.length === 0 && <span className="text-xs text-slate-400">Нет категорий.</span>}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input value={catName} onChange={(e) => setCatName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addCategory()}
                  placeholder="Новая категория (напр. Бумага)"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800" />
                <button type="button" onClick={addCategory}
                  className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
                  + Категория
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ---- Приём товара ---- */}
        {canManage && (
          <div className="rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-900">
            <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">Приём товара (приход)</h2>
            <form onSubmit={receive} className="space-y-3">
              <select value={productId} onChange={(e) => setProductId(e.target.value)} className={inp}>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <select value={branchId} onChange={(e) => setBranchId(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <input value={qty} onChange={(e) => setQty(e.target.value)} type="number" step="0.001"
                  placeholder="Количество" required
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              </div>
              <button className="w-full rounded-lg bg-indigo-600 py-2 font-medium text-white hover:bg-indigo-700">
                Принять на склад
              </button>
              {receiveMsg && <p className="text-sm text-slate-600">{receiveMsg}</p>}
            </form>
            <p className="mt-2 text-xs text-slate-400">
              Для приёмки с поставщиком и себестоимостью — используйте раздел «Закупки».
            </p>
          </div>
        )}
      </div>

      {/* ---- Перемещение и инвентаризация ---- */}
      {canManage && (
        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-900">
            <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">Перемещение между филиалами</h2>
            <form onSubmit={transfer} className="space-y-3">
              <select value={tProduct} onChange={(e) => setTProduct(e.target.value)} className={inp}>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div className="grid grid-cols-3 gap-2">
                <select value={tFrom} onChange={(e) => setTFrom(e.target.value)} required
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                  <option value="">Откуда</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <select value={tTo} onChange={(e) => setTTo(e.target.value)} required
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                  <option value="">Куда</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <input value={tQty} onChange={(e) => setTQty(e.target.value)} type="number" step="0.001"
                  placeholder="Кол-во" required
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              </div>
              <button className="w-full rounded-lg bg-sky-600 py-2 font-medium text-white hover:bg-sky-700">
                Переместить
              </button>
              {tMsg && <p className="text-sm text-slate-600">{tMsg}</p>}
            </form>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-900">
            <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">Инвентаризация</h2>
            <form onSubmit={recount} className="space-y-3">
              <select value={rProduct} onChange={(e) => setRProduct(e.target.value)} className={inp}>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <select value={rBranch} onChange={(e) => setRBranch(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <input value={rQty} onChange={(e) => setRQty(e.target.value)} type="number" step="0.001"
                  placeholder="Факт. остаток" required
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              </div>
              <button className="w-full rounded-lg bg-amber-600 py-2 font-medium text-white hover:bg-amber-700">
                Учесть остаток
              </button>
              {rMsg && <p className="text-sm text-slate-600">{rMsg}</p>}
            </form>
          </div>
        </div>
      )}

      {/* ---- Остатки + редактирование товаров ---- */}
      <div className="mb-6 rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-900">
        <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">Товары и остатки</h2>
        {loading ? (
          <p className="text-slate-400">Загрузка…</p>
        ) : products.length === 0 ? (
          <p className="text-slate-400">Товаров нет.</p>
        ) : (
          <div className="space-y-1">
            {products.map((p) => {
              const stockRow = stock.find((s) => s.productId === p.id);
              const qty = stockRow ? Number(stockRow.quantity) : 0;
              const isLow = lowIds.has(p.id);

              return (
                <div key={p.id}>
                  <div className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800">
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-slate-700 dark:text-slate-200">{p.name}</span>
                      {p.category?.name && (
                        <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                          {p.category.name}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                        {qty} {p.unit?.shortName ?? ''}
                      </span>
                      {isLow ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">мало</span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">ок</span>
                      )}
                      {canProducts && editPId !== p.id && (
                        <div className="flex gap-1">
                          <button onClick={() => openEditP(p)}
                            className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700">
                            ✎
                          </button>
                          <button onClick={() => deleteProduct(p.id)}
                            className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-500 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-900/20">
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Инлайн редактирование */}
                  {editPId === p.id && (
                    <div className="mx-2 mb-2 rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-700 dark:bg-indigo-900/20">
                      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        <div>
                          <label className="mb-1 block text-xs text-slate-500">Название</label>
                          <input value={editP.name} onChange={(e) => setEditP((f: any) => ({ ...f, name: e.target.value }))}
                            className={inp} />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-500">Категория</label>
                          <select value={editP.categoryId} onChange={(e) => setEditP((f: any) => ({ ...f, categoryId: e.target.value }))}
                            className={inp}>
                            <option value="">— без категории —</option>
                            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-500">Ед. измерения</label>
                          <select value={editP.unitId} onChange={(e) => setEditP((f: any) => ({ ...f, unitId: e.target.value }))}
                            className={inp}>
                            <option value="">— не задано —</option>
                            {units.map((u) => <option key={u.id} value={u.id}>{u.shortName} ({u.name})</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-500">Цена продажи, c.</label>
                          <input type="number" value={editP.salePrice} onChange={(e) => setEditP((f: any) => ({ ...f, salePrice: e.target.value }))}
                            className={inp} placeholder="0" />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-500">Порог оповещения</label>
                          <input type="number" value={editP.minStock} onChange={(e) => setEditP((f: any) => ({ ...f, minStock: e.target.value }))}
                            className={inp} placeholder="0" />
                        </div>
                        <div className="flex items-end">
                          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                            <input type="checkbox" checked={editP.isActive} onChange={(e) => setEditP((f: any) => ({ ...f, isActive: e.target.checked }))}
                              className="h-4 w-4 rounded" />
                            Активен
                          </label>
                        </div>
                      </div>
                      {editPMsg && <p className="mb-2 text-sm text-rose-600">{editPMsg}</p>}
                      <div className="flex gap-2">
                        <button onClick={saveEditP}
                          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
                          Сохранить
                        </button>
                        <button onClick={() => setEditPId(null)}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">
                          Отмена
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ---- История движений ---- */}
      <div className="rounded-2xl bg-white shadow-sm dark:bg-slate-900">
        <button
          onClick={() => setShowMovements((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-4 text-left"
        >
          <h2 className="font-semibold text-slate-700 dark:text-slate-200">История движений склада</h2>
          <span className="text-sm text-slate-400">{showMovements ? '▲ Свернуть' : '▼ Показать'}</span>
        </button>

        {showMovements && (
          <div className="border-t border-slate-100 px-5 pb-5 dark:border-slate-700">
            {movements.length === 0 ? (
              <p className="py-4 text-sm text-slate-400">Движений нет.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-400 dark:border-slate-700">
                    <th className="py-2 font-medium">Дата</th>
                    <th className="py-2 font-medium">Товар</th>
                    <th className="py-2 font-medium">Тип</th>
                    <th className="py-2 text-right font-medium">Кол-во</th>
                    <th className="py-2 font-medium">Причина</th>
                    <th className="py-2 font-medium">Сотрудник</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id} className="border-b border-slate-50 last:border-0 dark:border-slate-800">
                      <td className="py-2 text-slate-400">
                        {new Date(m.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-2 font-medium text-slate-700 dark:text-slate-200">{m.product?.name}</td>
                      <td className={`py-2 font-medium ${MOV_COLOR[m.type] ?? 'text-slate-600'}`}>
                        {MOV_LABEL[m.type] ?? m.type}
                      </td>
                      <td className="py-2 text-right font-semibold text-slate-700 dark:text-slate-200">
                        {Number(m.quantity)} {m.product?.unit?.shortName ?? ''}
                      </td>
                      <td className="py-2 text-slate-500 dark:text-slate-400">{m.reason ?? '—'}</td>
                      <td className="py-2 text-slate-500 dark:text-slate-400">{m.user?.fullName ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
