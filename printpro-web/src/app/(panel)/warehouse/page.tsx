'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';

export default function WarehousePage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();

  const [stock, setStock] = useState<any[]>([]);
  const [low, setLow] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Категории товаров
  const [catName, setCatName] = useState('');

  // Форма прихода
  const [productId, setProductId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [qty, setQty] = useState('');
  const [msg, setMsg] = useState('');

  // Форма нового товара
  const [pName, setPName] = useState('');
  const [pUnit, setPUnit] = useState('');
  const [pCat, setPCat] = useState('');
  const [pPrice, setPPrice] = useState('');
  const [pMin, setPMin] = useState('');
  const [pMsg, setPMsg] = useState('');

  // Перемещение между филиалами
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
        setStock(s);
        setLow(l);
        setProducts(p);
        setUnits(u);
        setBranches(b);
        setCategories(c);
        if (p[0]) setProductId(p[0].id);
        if (b[0]) setBranchId(b[0].id);
        if (u[0]) setPUnit(u[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(load, [cid]);

  async function addCategory() {
    if (!catName.trim()) return;
    try {
      await api.post('/product-categories', {
        companyId: cid,
        name: catName.trim(),
      });
      setCatName('');
      load();
    } catch (err: any) {
      setPMsg('Ошибка: ' + err.message);
    }
  }

  async function removeCategory(id: string) {
    if (!confirm('Удалить категорию? Товары останутся без категории.')) return;
    try {
      await api.del(`/product-categories/${id}`);
      if (pCat === id) setPCat('');
      load();
    } catch (err: any) {
      setPMsg('Ошибка: ' + err.message);
    }
  }

  const lowIds = new Set(low.map((l) => l.productId));
  const catNameOf = (productId: string) =>
    products.find((p) => p.id === productId)?.category?.name as string | undefined;

  async function receive(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await api.post('/stock/receive', {
        companyId: cid,
        branchId,
        productId,
        quantity: Number(qty),
        reason: 'Приход через панель',
      });
      setQty('');
      setMsg('✓ Товар принят на склад');
      load();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function transfer(e: React.FormEvent) {
    e.preventDefault();
    setTMsg('');
    try {
      await api.post('/stock/transfer', {
        companyId: cid,
        productId: tProduct || products[0]?.id,
        fromBranchId: tFrom,
        toBranchId: tTo,
        quantity: Number(tQty),
      });
      setTQty('');
      setTMsg('✓ Перемещено');
      load();
    } catch (err: any) {
      setTMsg('Ошибка: ' + err.message);
    }
  }

  async function recount(e: React.FormEvent) {
    e.preventDefault();
    setRMsg('');
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
    } catch (err: any) {
      setRMsg('Ошибка: ' + err.message);
    }
  }

  async function createProduct(e: React.FormEvent) {
    e.preventDefault();
    setPMsg('');
    try {
      await api.post('/products', {
        companyId: cid,
        name: pName,
        categoryId: pCat || undefined,
        unitId: pUnit || undefined,
        salePrice: pPrice ? Number(pPrice) : 0,
        minStock: pMin ? Number(pMin) : 0,
      });
      setPName('');
      setPPrice('');
      setPMin('');
      setPMsg('✓ Товар добавлен');
      load();
    } catch (err: any) {
      setPMsg('Ошибка: ' + err.message);
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-800">Склад</h1>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        {/* Новый товар */}
        {can('products.manage') && (
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-slate-700">Новый товар</h2>
            <form onSubmit={createProduct} className="space-y-3">
              <input
                value={pName}
                onChange={(e) => setPName(e.target.value)}
                placeholder="Название товара"
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
              <select
                value={pCat}
                onChange={(e) => setPCat(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">— без категории —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={pUnit}
                  onChange={(e) => setPUnit(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                >
                  <option value="">ед. изм.</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.shortName}
                    </option>
                  ))}
                </select>
                <input
                  value={pPrice}
                  onChange={(e) => setPPrice(e.target.value)}
                  type="number"
                  placeholder="Цена"
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                />
                <input
                  value={pMin}
                  onChange={(e) => setPMin(e.target.value)}
                  type="number"
                  placeholder="Порог"
                  title="Оповестить когда меньше"
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                />
              </div>
              <button className="w-full rounded-lg bg-emerald-600 py-2 font-medium text-white hover:bg-emerald-700">
                Добавить товар
              </button>
              {pMsg && <p className="text-sm text-slate-600">{pMsg}</p>}
            </form>

            {/* Категории товаров */}
            <div className="mt-4 border-t border-slate-100 pt-3">
              <div className="mb-2 text-xs font-medium text-slate-500">
                Категории товаров
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {categories.map((c) => (
                  <span
                    key={c.id}
                    className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-sm text-slate-700"
                  >
                    {c.name}
                    <button
                      type="button"
                      onClick={() => removeCategory(c.id)}
                      className="text-rose-400 hover:text-rose-600"
                      title="Удалить категорию"
                    >
                      ✕
                    </button>
                  </span>
                ))}
                {categories.length === 0 && (
                  <span className="text-xs text-slate-400">
                    Категорий пока нет.
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addCategory()}
                  placeholder="Новая категория (напр. Бумага)"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={addCategory}
                  className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
                >
                  + Категория
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Приём товара */}
        {can('stock.manage') && (
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-slate-700">Приём товара (приход)</h2>
            <form onSubmit={receive} className="space-y-3">
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <input
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  type="number"
                  step="0.001"
                  placeholder="Количество"
                  required
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                />
              </div>
              <button className="w-full rounded-lg bg-indigo-600 py-2 font-medium text-white hover:bg-indigo-700">
                Принять на склад
              </button>
              {msg && <p className="text-sm text-slate-600">{msg}</p>}
            </form>
          </div>
        )}
      </div>

      {/* Перемещение и инвентаризация */}
      {can('stock.manage') && (
        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          {/* Перемещение */}
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-slate-700">
              Перемещение между филиалами
            </h2>
            <form onSubmit={transfer} className="space-y-3">
              <select
                value={tProduct}
                onChange={(e) => setTProduct(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={tFrom}
                  onChange={(e) => setTFrom(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                  required
                >
                  <option value="">Откуда</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <select
                  value={tTo}
                  onChange={(e) => setTTo(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                  required
                >
                  <option value="">Куда</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <input
                  value={tQty}
                  onChange={(e) => setTQty(e.target.value)}
                  type="number"
                  step="0.001"
                  placeholder="Кол-во"
                  required
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                />
              </div>
              <button className="w-full rounded-lg bg-sky-600 py-2 font-medium text-white hover:bg-sky-700">
                Переместить
              </button>
              {tMsg && <p className="text-sm text-slate-600">{tMsg}</p>}
            </form>
          </div>

          {/* Инвентаризация */}
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-slate-700">Инвентаризация</h2>
            <form onSubmit={recount} className="space-y-3">
              <select
                value={rProduct}
                onChange={(e) => setRProduct(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={rBranch}
                  onChange={(e) => setRBranch(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <input
                  value={rQty}
                  onChange={(e) => setRQty(e.target.value)}
                  type="number"
                  step="0.001"
                  placeholder="Факт. остаток"
                  required
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                />
              </div>
              <button className="w-full rounded-lg bg-amber-600 py-2 font-medium text-white hover:bg-amber-700">
                Учесть остаток
              </button>
              {rMsg && <p className="text-sm text-slate-600">{rMsg}</p>}
            </form>
          </div>
        </div>
      )}

      {/* Остатки */}
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-slate-700">Остатки</h2>
        {loading ? (
          <p className="text-slate-400">Загрузка…</p>
        ) : stock.length === 0 ? (
          <p className="text-slate-400">Товаров на складе нет.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2">Товар</th>
                <th>Филиал</th>
                <th className="text-right">Остаток</th>
                <th className="text-right">Статус</th>
              </tr>
            </thead>
            <tbody>
              {stock.map((s) => {
                const isLow = lowIds.has(s.productId);
                return (
                  <tr key={s.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 font-medium text-slate-700">
                      {s.product.name}
                      {catNameOf(s.productId) && (
                        <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-500">
                          {catNameOf(s.productId)}
                        </span>
                      )}
                    </td>
                    <td className="text-slate-500">{s.branch.name}</td>
                    <td className="text-right font-semibold">
                      {s.quantity} {s.product.unit?.shortName ?? ''}
                    </td>
                    <td className="text-right">
                      {isLow ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                          мало
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                          ок
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
