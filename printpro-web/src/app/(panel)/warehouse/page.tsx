'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import {
  PageHeader,
  StatGrid,
  StatCard,
  Tabs,
  TabItem,
  TableCard,
  Toolbar,
  SearchInput,
  Card,
  SectionTitle,
  Field,
  Input,
  Select,
  Button,
  Badge,
  EmptyState,
} from '@/components/ui';
import type { Tone } from '@/components/ui';
import NavIcon from '@/lib/NavIcons';

const MOV_LABEL: Record<string, string> = {
  IN: 'Приход', OUT: 'Расход', WRITE_OFF: 'Списание', ADJUST: 'Корректировка', RETURN: 'Возврат',
};
const MOV_COLOR: Record<string, string> = {
  IN: 'text-emerald-600 dark:text-emerald-400',
  OUT: 'text-rose-600 dark:text-rose-400',
  WRITE_OFF: 'text-amber-600 dark:text-amber-400',
  ADJUST: 'text-sky-600 dark:text-sky-400',
  RETURN: 'text-emerald-600 dark:text-emerald-400',
};

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n || 0)) + ' c.';
}
function matStatus(qty: number, minStock: number): { label: string; tone: Tone } {
  if (qty <= 0) return { label: 'Отсутствует', tone: 'rose' };
  if (minStock > 0 && qty < minStock * 0.5) return { label: 'Критический', tone: 'rose' };
  if (minStock > 0 && qty <= minStock) return { label: 'Заканчивается', tone: 'amber' };
  return { label: 'Достаточно', tone: 'emerald' };
}
function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function WarehousePage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const canManage = can('stock.manage');
  const canProducts = can('products.manage');

  const [tab, setTab] = useState('stock');
  const [q, setQ] = useState('');
  const [filterCat, setFilterCat] = useState('ALL');
  const [fBranch, setFBranch] = useState('');
  const [fStatus, setFStatus] = useState('');

  const [products, setProducts] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [material, setMaterial] = useState<any | null>(null); // открытая панель
  const [aliasInput, setAliasInput] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState('');
  const [importing, setImporting] = useState(false);
  const [invOpen, setInvOpen] = useState(false);
  const [invBranch, setInvBranch] = useState('');
  const [invCounts, setInvCounts] = useState<Record<string, string>>({});
  const [invBusy, setInvBusy] = useState(false);
  const [invResult, setInvResult] = useState('');

  // Единицы измерения
  const [uName, setUName] = useState('');
  const [uShort, setUShort] = useState('');
  const [uMsg, setUMsg] = useState('');

  // Категории
  const [catName, setCatName] = useState('');

  // Новый товар
  const [pName, setPName] = useState('');
  const [pUnit, setPUnit] = useState('');
  const [pCat, setPCat] = useState('');
  const [pPrice, setPPrice] = useState('');
  const [pPurchase, setPPurchase] = useState('');
  const [pMin, setPMin] = useState('');
  const [pSku, setPSku] = useState('');
  const [pBarcode, setPBarcode] = useState('');
  const [pSize, setPSize] = useState('');
  const [pWeight, setPWeight] = useState('');
  const [pMsg, setPMsg] = useState('');

  // Редактирование товара
  const [editPId, setEditPId] = useState<string | null>(null);
  const [editP, setEditP] = useState<any>({});
  const [editPMsg, setEditPMsg] = useState('');

  // Приём
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

  // Списание (бой/брак/порча)
  const [woProduct, setWoProduct] = useState('');
  const [woBranch, setWoBranch] = useState('');
  const [woQty, setWoQty] = useState('');
  const [woReason, setWoReason] = useState('');
  const [woMsg, setWoMsg] = useState('');

  function load() {
    setLoading(true);
    Promise.all([
      api.get(`/products?companyId=${cid}`),
      api.get(`/units?companyId=${cid}`),
      api.get(`/branches?companyId=${cid}`),
      api.get(`/product-categories?companyId=${cid}`),
    ])
      .then(([p, u, b, c]) => {
        setProducts(p); setUnits(u); setBranches(b); setCategories(c);
        if (p[0]) setProductId(p[0].id);
        if (b[0]) { setBranchId(b[0].id); setTFrom(b[0].id); }
        if (u[0]) setPUnit(u[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    api.get(`/stock/stats?companyId=${cid}`).then(setStats).catch(() => {});
  }
  function loadMovements() {
    api.get(`/stock/movements?companyId=${cid}`).then(setMovements).catch(() => {});
  }

  useEffect(() => { load(); }, [cid]);
  useEffect(() => { if (tab === 'moves') loadMovements(); }, [tab, cid]);

  // ---- данные по товару ----
  const stockOf = (p: any) => (p.stock ?? []).reduce((s: number, r: any) => s + Number(r.quantity), 0);
  const branchOf = (p: any) => {
    const rows = (p.stock ?? []).slice().sort((a: any, b: any) => Number(b.quantity) - Number(a.quantity));
    return rows[0]?.branch?.name ?? '—';
  };

  // ---- единицы ----
  async function addUnit(e: React.FormEvent) {
    e.preventDefault(); setUMsg('');
    if (!uName.trim() || !uShort.trim()) { setUMsg('Заполните оба поля'); return; }
    try {
      await api.post('/units', { companyId: cid, name: uName.trim(), shortName: uShort.trim() });
      setUName(''); setUShort(''); setUMsg('✓ Добавлено'); load();
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
    await api.del(`/product-categories/${id}`); load();
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
        purchasePrice: pPurchase ? Number(pPurchase) : 0,
        minStock: pMin ? Number(pMin) : 0,
        sku: pSku || undefined,
        barcode: pBarcode || undefined,
        size: pSize || undefined,
        weight: pWeight || undefined,
      });
      setPName(''); setPPrice(''); setPPurchase(''); setPMin(''); setPSku(''); setPBarcode(''); setPSize(''); setPWeight('');
      setPMsg('✓ Товар добавлен'); load();
    } catch (err: any) { setPMsg('Ошибка: ' + err.message); }
  }

  // ---- редактирование ----
  function openEditP(p: any) {
    setEditPId(p.id); setEditPMsg('');
    setEditP({
      name: p.name, categoryId: p.categoryId ?? '', unitId: p.unitId ?? '',
      salePrice: String(Number(p.salePrice) || ''), purchasePrice: String(Number(p.purchasePrice) || ''), minStock: String(Number(p.minStock) || ''),
      sku: p.sku ?? '', barcode: p.barcode ?? '', size: p.size ?? '', weight: p.weight ?? '',
      isActive: p.isActive ?? true,
    });
  }
  async function saveEditP() {
    if (!editPId) return; setEditPMsg('');
    try {
      await api.patch(`/products/${editPId}`, {
        name: editP.name,
        categoryId: editP.categoryId || undefined,
        unitId: editP.unitId || undefined,
        salePrice: editP.salePrice ? Number(editP.salePrice) : 0,
        purchasePrice: editP.purchasePrice ? Number(editP.purchasePrice) : 0,
        minStock: editP.minStock ? Number(editP.minStock) : 0,
        sku: editP.sku || undefined,
        barcode: editP.barcode || undefined,
        size: editP.size || undefined,
        weight: editP.weight || undefined,
        isActive: editP.isActive,
      });
      setEditPId(null); load();
      if (material?.id === editPId) openMaterial(editPId);
    } catch (err: any) { setEditPMsg('Ошибка: ' + err.message); }
  }
  async function deleteProduct(id: string) {
    if (!confirm('Удалить товар? Он должен быть без остатков и без движений.')) return;
    try { await api.del(`/products/${id}`); if (editPId === id) setEditPId(null); if (material?.id === id) setMaterial(null); load(); }
    catch (err: any) { setPMsg('Ошибка: ' + err.message); }
  }

  // ---- приём / перемещение / инвентаризация ----
  async function receive(e: React.FormEvent) {
    e.preventDefault(); setReceiveMsg('');
    try {
      await api.post('/stock/receive', { companyId: cid, branchId, productId, quantity: Number(qty), reason: 'Приход через панель' });
      setQty(''); setReceiveMsg('✓ Товар принят на склад'); load();
      if (tab === 'moves') loadMovements();
    } catch (err: any) { setReceiveMsg('Ошибка: ' + err.message); }
  }
  async function transfer(e: React.FormEvent) {
    e.preventDefault(); setTMsg('');
    try {
      await api.post('/stock/transfer', { companyId: cid, productId: tProduct || products[0]?.id, fromBranchId: tFrom, toBranchId: tTo, quantity: Number(tQty) });
      setTQty(''); setTMsg('✓ Перемещено'); load();
    } catch (err: any) { setTMsg('Ошибка: ' + err.message); }
  }
  async function recount(e: React.FormEvent) {
    e.preventDefault(); setRMsg('');
    try {
      const res = await api.post('/stock/recount', { companyId: cid, productId: rProduct || products[0]?.id, branchId: rBranch || branches[0]?.id, countedQuantity: Number(rQty) });
      setRQty(''); setRMsg(`✓ Учтено (расхождение: ${res.diff})`); load();
    } catch (err: any) { setRMsg('Ошибка: ' + err.message); }
  }
  async function writeOff(e: React.FormEvent) {
    e.preventDefault(); setWoMsg('');
    try {
      const r = await api.post('/stock/write-off', { companyId: cid, productId: woProduct || products[0]?.id, branchId: woBranch || branches[0]?.id, quantity: Number(woQty), reason: woReason || undefined });
      setWoQty(''); setWoReason(''); setWoMsg(`✓ Списано (себестоимость ${money(Number(r.cost))})`);
      load(); if (tab === 'moves') loadMovements();
    } catch (err: any) { setWoMsg('Ошибка: ' + err.message); }
  }

  // ---- панель материала ----
  async function openMaterial(id: string) {
    try { const full = await api.get(`/products/${id}`); setMaterial(full); } catch {}
  }
  async function addAlias() {
    const code = aliasInput.trim();
    if (!code || !material) return;
    try {
      await api.post(`/products/${material.id}/barcode-aliases`, { barcode: code });
      setAliasInput('');
      openMaterial(material.id);
    } catch (e: any) {
      alert('Не удалось добавить штрихкод: ' + (e?.message ?? e));
    }
  }
  async function removeAlias(aliasId: string) {
    if (!material) return;
    try {
      await api.del(`/products/barcode-aliases/${aliasId}`);
      openMaterial(material.id);
    } catch { /* ignore */ }
  }
  function quickAction(action: 'receive' | 'transfer' | 'recount') {
    if (!material) return;
    if (action === 'receive') setProductId(material.id);
    if (action === 'transfer') setTProduct(material.id);
    if (action === 'recount') setRProduct(material.id);
    setTab('ops');
    setMaterial(null);
  }
  function printLabel(m: any) {
    const w = window.open('', '_blank', 'width=420,height=300');
    if (!w) return;
    w.document.write(`<html><head><title>Этикетка</title></head><body style="font-family:sans-serif;text-align:center;padding:24px;margin:0">
      <div style="font-size:18px;font-weight:700">${m.name}</div>
      <div style="font-size:13px;color:#64748b;margin-top:4px">${m.size ?? ''}</div>
      <div style="font-family:monospace;font-size:24px;letter-spacing:3px;margin:14px 0">${m.barcode ?? m.sku ?? '—'}</div>
      <div style="font-size:14px;font-weight:600">${money(Number(m.salePrice))}</div>
    </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }
  function exportCSV() {
    downloadCSV('materials.csv',
      ['Материал', 'Категория', 'Ед.', 'Остаток', 'Мин.', 'Цена', 'Артикул', 'Штрихкод'],
      filtered.map((p) => [p.name, p.category?.name ?? '', p.unit?.shortName ?? '', stockOf(p), Number(p.minStock), Number(p.salePrice), p.sku ?? '', p.barcode ?? '']));
  }

  // ---- импорт каталога из CSV/Excel ----
  function parseCSV(text: string): any[] {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return [];
    const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
    const split = (l: string) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''));
    const FIELD: Record<string, string> = {
      'материал': 'name', 'название': 'name', 'наименование': 'name', 'name': 'name', 'товар': 'name',
      'категория': 'category', 'category': 'category',
      'ед.': 'unit', 'ед': 'unit', 'единица': 'unit', 'unit': 'unit',
      'остаток': '_skip', 'stock': '_skip',
      'мин.': 'minStock', 'мин': 'minStock', 'минимум': 'minStock', 'minstock': 'minStock',
      'цена': 'salePrice', 'price': 'salePrice', 'saleprice': 'salePrice', 'цена продажи': 'salePrice',
      'закупка': 'purchasePrice', 'purchaseprice': 'purchasePrice', 'цена закупки': 'purchasePrice',
      'артикул': 'sku', 'sku': 'sku',
      'штрихкод': 'barcode', 'barcode': 'barcode', 'шк': 'barcode',
    };
    const header = split(lines[0]).map((h) => h.toLowerCase());
    const hasHeader = header.some((h) => FIELD[h]);
    const cols = hasHeader
      ? header.map((h) => FIELD[h] ?? null)
      : ['name', 'category', 'unit', '_skip', 'minStock', 'salePrice', 'sku', 'barcode'];
    const dataLines = hasHeader ? lines.slice(1) : lines;
    return dataLines
      .map((l) => {
        const cells = split(l);
        const row: any = {};
        cols.forEach((f, i) => { if (f && f !== '_skip') row[f] = cells[i]; });
        return row;
      })
      .filter((r) => (r.name ?? '').trim());
  }
  function onImportFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => setImportText(String(reader.result));
    reader.readAsText(file, 'utf-8');
  }
  async function doImport() {
    const rows = parseCSV(importText);
    if (!rows.length) { setImportResult('Не найдено строк для импорта'); return; }
    setImporting(true);
    setImportResult('');
    try {
      const r = await api.post('/products/import', { companyId: cid, rows });
      setImportResult(`✓ Готово: создано ${r.created}, обновлено ${r.updated}, пропущено ${r.skipped}`);
      load();
    } catch (e: any) {
      setImportResult('Ошибка: ' + (e?.message ?? e));
    } finally {
      setImporting(false);
    }
  }

  // ---- инвентаризация (лист по филиалу) ----
  function expectedFor(p: any, branchId: string) {
    return Number((p.stock ?? []).find((s: any) => s.branchId === branchId)?.quantity ?? 0);
  }
  function openInventory() {
    setInvBranch(branches[0]?.id ?? '');
    setInvCounts({});
    setInvResult('');
    setInvOpen(true);
  }
  async function applyInventory() {
    const branchId = invBranch || branches[0]?.id;
    if (!branchId) { setInvResult('Нет филиала'); return; }
    const items = Object.entries(invCounts)
      .filter(([, v]) => String(v).trim() !== '')
      .map(([productId, v]) => ({ productId, countedQuantity: Number(v) }))
      .filter((it) => Number.isFinite(it.countedQuantity) && it.countedQuantity >= 0);
    if (!items.length) { setInvResult('Введите фактические остатки хотя бы по одному товару'); return; }
    setInvBusy(true);
    setInvResult('');
    try {
      const r = await api.post('/stock/recount-bulk', { companyId: cid, branchId, items });
      setInvResult(`✓ Применено: ${r.applied}, без изменений: ${r.unchanged}`);
      setInvCounts({});
      load();
    } catch (e: any) {
      setInvResult('Ошибка: ' + (e?.message ?? e));
    } finally {
      setInvBusy(false);
    }
  }

  // ---- фильтрация ----
  const ql = q.trim().toLowerCase();
  const filtered = products.filter((p) => {
    if (filterCat !== 'ALL' && p.categoryId !== filterCat) return false;
    if (fBranch && !(p.stock ?? []).some((r: any) => r.branchId === fBranch)) return false;
    if (fStatus) {
      const st = matStatus(stockOf(p), Number(p.minStock));
      if (fStatus === 'ok' && st.tone !== 'emerald') return false;
      if (fStatus === 'low' && st.tone !== 'amber') return false;
      if (fStatus === 'out' && st.label !== 'Отсутствует' && st.label !== 'Критический') return false;
    }
    if (ql && !p.name.toLowerCase().includes(ql) && !(p.sku ?? '').toLowerCase().includes(ql) && !(p.barcode ?? '').includes(ql)) return false;
    return true;
  });

  const totalValue = products.reduce((s, p) => s + stockOf(p) * (Number(p.salePrice) || 0), 0);
  const lowCount = products.filter((p) => { const x = stockOf(p); return x > 0 && Number(p.minStock) > 0 && x <= Number(p.minStock); }).length;
  const outCount = products.filter((p) => stockOf(p) <= 0).length;

  const tabs: TabItem[] = [
    { key: 'stock', label: 'Остатки', count: products.length },
    ...(canManage ? [{ key: 'ops', label: 'Операции' }] : []),
    { key: 'moves', label: 'Движения' },
    ...(canProducts ? [{ key: 'ref', label: 'Справочники' }] : []),
  ];

  return (
    <div>
      <PageHeader
        icon="warehouse"
        title="Склад и материалы"
        subtitle="Управляйте материалами, остатками и движением"
        actions={
          <div className="flex items-center gap-2">
            {canManage && (
              <Button variant="ghost" onClick={openInventory}>
                <NavIcon name="check" className="h-4 w-4" />Инвентаризация
              </Button>
            )}
            {canProducts && (
              <Button variant="ghost" onClick={() => { setImportOpen(true); setImportResult(''); }}>
                <NavIcon name="download" className="h-4 w-4 rotate-180" />Импорт
              </Button>
            )}
            <Button variant="ghost" onClick={exportCSV}><NavIcon name="download" className="h-4 w-4" />Экспорт</Button>
            {canProducts && <Button onClick={() => setTab('ref')}>+ Новый материал</Button>}
          </div>
        }
      />

      <StatGrid cols={3}>
        <StatCard icon="warehouse" tone="indigo" label="Всего материалов" value={products.length} highlight />
        <StatCard icon="cash" tone="emerald" label="Общая стоимость" value={money(totalValue)} sub="по цене продажи" />
        <StatCard icon="complaints" tone="amber" label="Заканчиваются" value={lowCount} />
        <StatCard icon="reports" tone="rose" label="Отсутствуют" value={outCount} />
        <StatCard icon="purchasing" tone="sky" label="Поставщиков" value={stats?.suppliers ?? '…'} />
        <StatCard icon="orders" tone="violet" label="Поступления сегодня" value={money(stats?.todayReceipts ?? 0)} />
      </StatGrid>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {/* ============ ОСТАТКИ (материалы) ============ */}
      {tab === 'stock' && (
        <>
          {/* Категории-чипы */}
          {categories.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              <button onClick={() => setFilterCat('ALL')} className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${filterCat === 'ALL' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 shadow-sm hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300'}`}>Все категории</button>
              {categories.map((c) => (
                <button key={c.id} onClick={() => setFilterCat(c.id)} className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${filterCat === c.id ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 shadow-sm hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300'}`}>{c.name}</button>
              ))}
            </div>
          )}

          <TableCard>
            <Toolbar>
              <SearchInput value={q} onChange={setQ} placeholder="Поиск по материалам, артикулу, штрихкоду…" />
              <Select value={fBranch} onChange={(e) => setFBranch(e.target.value)} className="w-auto">
                <option value="">Все склады</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
              <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="w-auto">
                <option value="">Все статусы</option>
                <option value="ok">Достаточно</option>
                <option value="low">Заканчивается</option>
                <option value="out">Критический / Нет</option>
              </Select>
              <span className="text-sm text-slate-400">Найдено: {filtered.length}</span>
            </Toolbar>

            {loading ? (
              <EmptyState title="Загрузка…" />
            ) : filtered.length === 0 ? (
              <EmptyState icon="warehouse" title="Материалов нет" hint={q || filterCat !== 'ALL' ? 'Ничего не найдено.' : 'Добавьте материал во вкладке «Справочники».'} />
            ) : (
              <div className="pp-table-scroll">
                <table className="pp-table">
                  <thead>
                    <tr>
                      <th>Материал</th>
                      <th>Категория</th>
                      <th>Ед.</th>
                      <th className="text-right">Остаток</th>
                      <th className="text-right">Мин.</th>
                      <th className="text-right">Цена за ед.</th>
                      <th>Склад</th>
                      <th>Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p) => {
                      const x = stockOf(p);
                      const st = matStatus(x, Number(p.minStock));
                      return (
                        <tr key={p.id} className="cursor-pointer" onClick={() => openMaterial(p.id)}>
                          <td>
                            <div className="flex items-center gap-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400 dark:bg-slate-800"><NavIcon name="warehouse" className="h-5 w-5" /></span>
                              <span>
                                <span className="block font-medium text-slate-700 hover:text-indigo-600 dark:text-slate-200">{p.name}</span>
                                {(p.size || p.sku) && <span className="block text-xs text-slate-400">{p.size || `арт. ${p.sku}`}</span>}
                              </span>
                            </div>
                          </td>
                          <td>{p.category?.name ? <Badge tone="indigo">{p.category.name}</Badge> : <span className="text-slate-400">—</span>}</td>
                          <td className="text-slate-500">{p.unit?.shortName ?? '—'}</td>
                          <td className={`text-right font-semibold ${st.tone === 'emerald' ? 'text-emerald-600' : st.tone === 'amber' ? 'text-amber-600' : 'text-rose-600'}`}>{x}</td>
                          <td className="text-right text-slate-400">{Number(p.minStock) || '—'}</td>
                          <td className="text-right text-slate-600 dark:text-slate-300">{money(Number(p.salePrice) || 0)}</td>
                          <td className="text-slate-500">{branchOf(p)}</td>
                          <td><Badge tone={st.tone}>{st.label}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </TableCard>
        </>
      )}

      {/* ============ ОПЕРАЦИИ ============ */}
      {tab === 'ops' && canManage && (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <SectionTitle>Приём материала (приход)</SectionTitle>
            <form onSubmit={receive} className="space-y-3">
              <Field label="Материал"><Select value={productId} onChange={(e) => setProductId(e.target.value)}>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Склад"><Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
                <Field label="Количество"><Input value={qty} onChange={(e) => setQty(e.target.value)} type="number" step="0.001" placeholder="0" required /></Field>
              </div>
              <Button type="submit" className="w-full">Принять на склад</Button>
              {receiveMsg && <p className="text-sm text-slate-600 dark:text-slate-300">{receiveMsg}</p>}
            </form>
            <p className="mt-2 text-xs text-slate-400">Для приёмки с поставщиком и себестоимостью — раздел «Закупки».</p>
          </Card>

          <Card>
            <SectionTitle>Перемещение между складами</SectionTitle>
            <form onSubmit={transfer} className="space-y-3">
              <Field label="Материал"><Select value={tProduct} onChange={(e) => setTProduct(e.target.value)}>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Откуда"><Select value={tFrom} onChange={(e) => setTFrom(e.target.value)} required><option value="">—</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
                <Field label="Куда"><Select value={tTo} onChange={(e) => setTTo(e.target.value)} required><option value="">—</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
              </div>
              <Field label="Количество"><Input value={tQty} onChange={(e) => setTQty(e.target.value)} type="number" step="0.001" placeholder="0" required /></Field>
              <Button type="submit" variant="sky" className="w-full">Переместить</Button>
              {tMsg && <p className="text-sm text-slate-600 dark:text-slate-300">{tMsg}</p>}
            </form>
          </Card>

          <Card>
            <SectionTitle>Инвентаризация</SectionTitle>
            <form onSubmit={recount} className="space-y-3">
              <Field label="Материал"><Select value={rProduct} onChange={(e) => setRProduct(e.target.value)}>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Склад"><Select value={rBranch} onChange={(e) => setRBranch(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
                <Field label="Факт. остаток"><Input value={rQty} onChange={(e) => setRQty(e.target.value)} type="number" step="0.001" placeholder="0" required /></Field>
              </div>
              <Button type="submit" variant="amber" className="w-full">Учесть остаток</Button>
              {rMsg && <p className="text-sm text-slate-600 dark:text-slate-300">{rMsg}</p>}
            </form>
          </Card>

          <Card>
            <SectionTitle>Списание (бой/брак/порча)</SectionTitle>
            <form onSubmit={writeOff} className="space-y-3">
              <Field label="Материал"><Select value={woProduct} onChange={(e) => setWoProduct(e.target.value)}>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Склад"><Select value={woBranch} onChange={(e) => setWoBranch(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
                <Field label="Количество"><Input value={woQty} onChange={(e) => setWoQty(e.target.value)} type="number" step="0.001" placeholder="0" required /></Field>
              </div>
              <Field label="Причина"><Input value={woReason} onChange={(e) => setWoReason(e.target.value)} placeholder="напр. повреждение" /></Field>
              <Button type="submit" variant="danger" className="w-full">Списать</Button>
              {woMsg && <p className="text-sm text-slate-600 dark:text-slate-300">{woMsg}</p>}
            </form>
            <p className="mt-2 text-xs text-slate-400">Себестоимость спишется из закупочной цены товара.</p>
          </Card>
        </div>
      )}

      {/* ============ ДВИЖЕНИЯ ============ */}
      {tab === 'moves' && (
        <TableCard>
          {movements.length === 0 ? (
            <EmptyState icon="reports" title="Движений нет" hint="Здесь появятся приходы, расходы, списания и корректировки." />
          ) : (
            <div className="pp-table-scroll">
              <table className="pp-table">
                <thead><tr><th>Дата</th><th>Материал</th><th>Тип</th><th className="text-right">Кол-во</th><th className="text-right">Было</th><th className="text-right">Стало</th><th>Причина</th><th>Сотрудник</th></tr></thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id}>
                      <td className="text-slate-400">{new Date(m.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="font-medium text-slate-700 dark:text-slate-200">{m.product?.name}</td>
                      <td className={`font-medium ${MOV_COLOR[m.type] ?? 'text-slate-600'}`}>{MOV_LABEL[m.type] ?? m.type}</td>
                      <td className="text-right font-semibold text-slate-700 dark:text-slate-200">{Number(m.quantity)} {m.product?.unit?.shortName ?? ''}</td>
                      <td className="text-right tabular-nums text-slate-400">{m.beforeQty != null ? Number(m.beforeQty) : '—'}</td>
                      <td className="text-right tabular-nums font-medium text-slate-600 dark:text-slate-300">{m.afterQty != null ? Number(m.afterQty) : '—'}</td>
                      <td className="text-slate-500 dark:text-slate-400">{m.reason ?? '—'}</td>
                      <td className="text-slate-500 dark:text-slate-400">{m.user?.fullName ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TableCard>
      )}

      {/* ============ СПРАВОЧНИКИ ============ */}
      {tab === 'ref' && canProducts && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <SectionTitle>Новый материал</SectionTitle>
            <form onSubmit={createProduct} className="space-y-3">
              <Input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Название материала *" required />
              <Select value={pCat} onChange={(e) => setPCat(e.target.value)}>
                <option value="">— без категории —</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <Select value={pUnit} onChange={(e) => setPUnit(e.target.value)}><option value="">ед. изм.</option>{units.map((u) => <option key={u.id} value={u.id}>{u.shortName}</option>)}</Select>
              <div className="grid grid-cols-3 gap-2">
                <Input value={pPrice} onChange={(e) => setPPrice(e.target.value)} type="number" placeholder="Цена продажи" />
                <Input value={pPurchase} onChange={(e) => setPPurchase(e.target.value)} type="number" placeholder="Закупочная" title="Себестоимость — для отчёта прибыли" />
                <Input value={pMin} onChange={(e) => setPMin(e.target.value)} type="number" placeholder="Мин. остаток" title="Оповещение когда меньше" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input value={pSku} onChange={(e) => setPSku(e.target.value)} placeholder="Артикул" />
                <Input value={pBarcode} onChange={(e) => setPBarcode(e.target.value)} placeholder="Штрихкод" />
                <Input value={pSize} onChange={(e) => setPSize(e.target.value)} placeholder="Размер (610×860 мм)" />
                <Input value={pWeight} onChange={(e) => setPWeight(e.target.value)} placeholder="Вес (2.5 кг)" />
              </div>
              <Button type="submit" variant="emerald" className="w-full">Добавить материал</Button>
              {pMsg && <p className="text-sm text-slate-600 dark:text-slate-300">{pMsg}</p>}
            </form>

            <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-700">
              <div className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Категории</div>
              <div className="flex flex-wrap items-center gap-2">
                {categories.map((c) => (
                  <span key={c.id} className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {c.name}<button type="button" onClick={() => removeCategory(c.id)} className="inline-flex text-rose-400 hover:text-rose-600"><NavIcon name="close" className="h-3.5 w-3.5" /></button>
                  </span>
                ))}
                {categories.length === 0 && <span className="text-xs text-slate-400">Нет категорий.</span>}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Input value={catName} onChange={(e) => setCatName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCategory()} placeholder="Новая категория (напр. Бумага)" />
                <Button type="button" variant="ghost" onClick={addCategory} className="shrink-0">+ Категория</Button>
              </div>
            </div>
          </Card>

          <Card>
            <SectionTitle>Единицы измерения</SectionTitle>
            <div className="mb-3 flex flex-wrap gap-2">
              {units.map((u) => (
                <span key={u.id} className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-sm dark:bg-slate-800">
                  <span className="font-medium text-slate-700 dark:text-slate-200">{u.shortName}</span>
                  <span className="text-slate-400">({u.name})</span>
                  <button onClick={() => removeUnit(u.id)} className="inline-flex text-rose-400 hover:text-rose-600"><NavIcon name="close" className="h-3.5 w-3.5" /></button>
                </span>
              ))}
              {units.length === 0 && <span className="text-sm text-slate-400">Нет единиц. Добавьте: шт, м², рул и т.д.</span>}
            </div>
            <form onSubmit={addUnit} className="flex flex-wrap items-end gap-2">
              <Field label="Полное название"><Input value={uName} onChange={(e) => setUName(e.target.value)} placeholder="Штука" className="w-36" /></Field>
              <Field label="Сокращение"><Input value={uShort} onChange={(e) => setUShort(e.target.value)} placeholder="шт" className="w-24" /></Field>
              <Button type="submit" variant="ghost">+ Единица</Button>
              {uMsg && <span className="text-sm text-slate-500">{uMsg}</span>}
            </form>
          </Card>
        </div>
      )}

      {/* ===================== ИНВЕНТАРИЗАЦИЯ (ЛИСТ) ===================== */}
      {invOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={() => setInvOpen(false)} />
          <div className="relative flex max-h-[88vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-700/60">
              <div>
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Инвентаризация</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Впишите фактический остаток. Пустые строки не трогаются.</p>
              </div>
              <button onClick={() => setInvOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><NavIcon name="close" className="h-4 w-4" /></button>
            </div>

            <div className="border-b border-slate-100 p-4 dark:border-slate-700/60">
              <Field label="Филиал">
                <Select value={invBranch} onChange={(e) => { setInvBranch(e.target.value); setInvCounts({}); }} className="w-auto">
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
            </div>

            <div className="flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-400 dark:bg-slate-800">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Товар</th>
                    <th className="px-3 py-2 text-right font-medium">Учёт</th>
                    <th className="px-3 py-2 text-right font-medium">Факт</th>
                    <th className="px-4 py-2 text-right font-medium">Разница</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => {
                    const exp = expectedFor(p, invBranch);
                    const raw = invCounts[p.id];
                    const has = String(raw ?? '').trim() !== '';
                    const diff = has ? Number(raw) - exp : 0;
                    return (
                      <tr key={p.id} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="px-4 py-2 text-slate-700 dark:text-slate-200">
                          {p.name}
                          <span className="ml-1 text-xs text-slate-400">{p.unit?.shortName ?? ''}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">{exp}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            value={raw ?? ''}
                            onChange={(e) => setInvCounts((c) => ({ ...c, [p.id]: e.target.value }))}
                            inputMode="decimal"
                            placeholder="—"
                            className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          />
                        </td>
                        <td className={`px-4 py-2 text-right tabular-nums font-medium ${!has ? 'text-slate-300' : diff === 0 ? 'text-slate-400' : diff > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {has ? (diff > 0 ? `+${diff}` : diff) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-3 border-t border-slate-100 p-4 dark:border-slate-700/60">
              <Button onClick={applyInventory} disabled={invBusy}>
                <NavIcon name="check" className="h-4 w-4" />{invBusy ? 'Применяю…' : 'Применить'}
              </Button>
              <Button variant="ghost" onClick={() => setInvOpen(false)}>Закрыть</Button>
              {invResult && <span className="text-sm text-slate-600 dark:text-slate-300">{invResult}</span>}
            </div>
          </div>
        </div>
      )}

      {/* ===================== ИМПОРТ КАТАЛОГА ===================== */}
      {importOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={() => setImportOpen(false)} />
          <div className="relative w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Импорт товаров</h3>
              <button onClick={() => setImportOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><NavIcon name="close" className="h-4 w-4" /></button>
            </div>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              Загрузите CSV-файл (из Excel: «Сохранить как → CSV») или вставьте таблицу.
              Колонки: <b>Название, Категория, Ед., Мин., Цена, Закупка, Артикул, Штрихкод</b>.
              Категории и единицы создаются автоматически. Совпадение по названию — обновляется.
            </p>
            <label className="mb-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800">
              <NavIcon name="download" className="h-4 w-4 rotate-180" />Выбрать CSV-файл
              <input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => e.target.files?.[0] && onImportFile(e.target.files[0])} />
            </label>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={8}
              placeholder={'Название;Категория;Ед.;Мин.;Цена;Закупка;Артикул;Штрихкод\nБумага A4;Бумага;пач;5;35;28;PAP-A4;4600001'}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-700 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
            <div className="mt-4 flex items-center gap-3">
              <Button onClick={doImport} disabled={importing || !importText.trim()}>
                <NavIcon name="check" className="h-4 w-4" />{importing ? 'Импорт…' : 'Импортировать'}
              </Button>
              <Button variant="ghost" onClick={() => setImportOpen(false)}>Закрыть</Button>
              {importResult && <span className="text-sm text-slate-600 dark:text-slate-300">{importResult}</span>}
            </div>
          </div>
        </div>
      )}

      {/* ===================== ПАНЕЛЬ МАТЕРИАЛА ===================== */}
      {material && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={() => { setMaterial(null); setEditPId(null); }} />
          <div className="relative z-10 h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Информация о материале</h2>
              <button onClick={() => { setMaterial(null); setEditPId(null); }} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><NavIcon name="close" className="h-4 w-4" /></button>
            </div>

            {editPId === material.id ? (
              <div>
                <div className="grid gap-3">
                  <Field label="Название"><Input value={editP.name} onChange={(e) => setEditP((f: any) => ({ ...f, name: e.target.value }))} /></Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Категория"><Select value={editP.categoryId} onChange={(e) => setEditP((f: any) => ({ ...f, categoryId: e.target.value }))}><option value="">— нет —</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
                    <Field label="Ед."><Select value={editP.unitId} onChange={(e) => setEditP((f: any) => ({ ...f, unitId: e.target.value }))}><option value="">—</option>{units.map((u) => <option key={u.id} value={u.id}>{u.shortName}</option>)}</Select></Field>
                    <Field label="Цена продажи"><Input type="number" value={editP.salePrice} onChange={(e) => setEditP((f: any) => ({ ...f, salePrice: e.target.value }))} /></Field>
                    <Field label="Закупочная (себест.)"><Input type="number" value={editP.purchasePrice} onChange={(e) => setEditP((f: any) => ({ ...f, purchasePrice: e.target.value }))} /></Field>
                    <Field label="Мин. остаток"><Input type="number" value={editP.minStock} onChange={(e) => setEditP((f: any) => ({ ...f, minStock: e.target.value }))} /></Field>
                    <Field label="Артикул"><Input value={editP.sku} onChange={(e) => setEditP((f: any) => ({ ...f, sku: e.target.value }))} /></Field>
                    <Field label="Штрихкод"><Input value={editP.barcode} onChange={(e) => setEditP((f: any) => ({ ...f, barcode: e.target.value }))} /></Field>
                    <Field label="Размер"><Input value={editP.size} onChange={(e) => setEditP((f: any) => ({ ...f, size: e.target.value }))} /></Field>
                    <Field label="Вес"><Input value={editP.weight} onChange={(e) => setEditP((f: any) => ({ ...f, weight: e.target.value }))} /></Field>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <input type="checkbox" checked={editP.isActive} onChange={(e) => setEditP((f: any) => ({ ...f, isActive: e.target.checked }))} className="h-4 w-4 rounded" /> Активен
                  </label>
                </div>
                {editPMsg && <p className="mt-2 text-sm text-rose-600">{editPMsg}</p>}
                <div className="mt-3 flex gap-2"><Button onClick={saveEditP}>Сохранить</Button><Button variant="ghost" onClick={() => setEditPId(null)}>Отмена</Button></div>
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-start gap-3">
                  <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-800"><NavIcon name="warehouse" className="h-7 w-7" /></span>
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800 dark:text-slate-100">{material.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {material.category?.name && <Badge tone="indigo">{material.category.name}</Badge>}
                      {!material.isActive && <Badge tone="slate">отключён</Badge>}
                    </div>
                  </div>
                </div>

                <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <Info label="Штрихкод" value={material.barcode ?? '—'} />
                  <Info label="Артикул" value={material.sku ?? '—'} />
                  <Info label="Ед. измерения" value={material.unit?.name ?? material.unit?.shortName ?? '—'} />
                  <Info label="Размер" value={material.size ?? '—'} />
                  <Info label="Вес" value={material.weight ?? '—'} />
                  <Info label="Цена за ед." value={money(Number(material.salePrice))} />
                </div>

                {/* Доп. штрихкоды (алиасы) — один товар = несколько ШК */}
                <div className="mb-4">
                  <SectionTitle>Доп. штрихкоды</SectionTitle>
                  {(material.barcodeAliases ?? []).length === 0 ? (
                    <p className="-mt-1 mb-2 text-xs text-slate-400">
                      Несколько штрихкодов на один товар — сканер узнаёт любой из них.
                    </p>
                  ) : (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {material.barcodeAliases.map((a: any) => (
                        <span
                          key={a.id}
                          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        >
                          {a.barcode}
                          {canManage && (
                            <button
                              onClick={() => removeAlias(a.id)}
                              className="text-rose-400 transition hover:text-rose-600"
                              title="Удалить"
                            >
                              <NavIcon name="close" className="h-3 w-3" />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  {canManage && (
                    <div className="flex gap-2">
                      <Input
                        value={aliasInput}
                        onChange={(e) => setAliasInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAlias(); } }}
                        placeholder="Отсканируйте или введите ШК"
                        className="flex-1"
                      />
                      <Button size="sm" onClick={addAlias}><NavIcon name="plus" className="h-4 w-4" />Добавить</Button>
                    </div>
                  )}
                </div>

                {/* Остаток */}
                <div className="mb-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
                    <div className="text-xs text-slate-400">Остаток на складе</div>
                    <div className="text-xl font-bold text-slate-800 dark:text-slate-100">{material.stockTotal} {material.unit?.shortName ?? ''}</div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
                    <div className="text-xs text-slate-400">Минимум</div>
                    <div className="text-xl font-bold text-slate-800 dark:text-slate-100">{Number(material.minStock) || '—'}</div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
                    <div className="text-xs text-slate-400">Средний расход</div>
                    <div className="font-semibold text-slate-700 dark:text-slate-200">{material.consumption?.avgPerDay ? `${material.consumption.avgPerDay} / день` : '—'}</div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
                    <div className="text-xs text-slate-400">Хватит на</div>
                    <div className="font-semibold text-slate-700 dark:text-slate-200">{material.consumption?.daysLeft != null ? `${material.consumption.daysLeft} дней` : '—'}</div>
                  </div>
                </div>

                {/* Поставщик / последняя закупка */}
                {material.lastReceipt && (
                  <div className="mb-4 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
                    <div className="mb-1 font-semibold text-slate-700 dark:text-slate-200">Последняя закупка</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <Info label="Поставщик" value={material.lastReceipt.supplier ?? '—'} />
                      <Info label="Дата" value={material.lastReceipt.date ? new Date(material.lastReceipt.date).toLocaleDateString('ru-RU') : '—'} />
                      <Info label="Цена закупки" value={money(material.lastReceipt.cost)} />
                      <Info label="Кол-во" value={String(material.lastReceipt.quantity)} />
                    </div>
                  </div>
                )}

                {/* Быстрые действия */}
                {canManage && (
                  <>
                    <SectionTitle>Быстрые действия</SectionTitle>
                    <div className="mb-4 grid grid-cols-2 gap-2">
                      <Button variant="ghost" size="sm" onClick={() => quickAction('receive')}>＋ Поступление</Button>
                      <Button variant="ghost" size="sm" onClick={() => quickAction('transfer')}><NavIcon name="refresh" className="h-4 w-4" />Перемещение</Button>
                      <Button variant="ghost" size="sm" onClick={() => quickAction('recount')}><NavIcon name="check" className="h-4 w-4" />Инвентаризация</Button>
                      <Button variant="ghost" size="sm" onClick={() => printLabel(material)}><NavIcon name="print" className="h-4 w-4" />Печать этикетки</Button>
                      <Button variant="ghost" size="sm" onClick={exportCSV}><NavIcon name="download" className="h-4 w-4" />Экспорт в Excel</Button>
                      {canProducts && <Button variant="ghost" size="sm" onClick={() => openEditP(material)}><NavIcon name="edit" className="h-4 w-4" />Изменить</Button>}
                    </div>
                  </>
                )}

                {/* Используется в услугах */}
                {material.usedInServices?.length > 0 && (
                  <>
                    <SectionTitle>Используется в услугах ({material.usedInServices.length})</SectionTitle>
                    <div className="flex flex-wrap gap-1.5">
                      {material.usedInServices.map((s: any) => <Badge key={s.id} tone="violet">{s.name}</Badge>)}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="font-medium text-slate-700 dark:text-slate-200">{value}</div>
    </div>
  );
}
