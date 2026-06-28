'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { API_BASE, DEFAULT_COMPANY_ID, SERVER_ORIGIN } from '@/lib/config';
import { useAuth } from '@/lib/auth';

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(n) + ' c.';
}

const inp =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

const TYPE_LABELS: Record<string, string> = {
  INDIVIDUAL: 'Физлицо', COMPANY: 'Компания', REGULAR: 'Постоянный', VIP: 'VIP',
};
const TYPE_COLORS: Record<string, string> = {
  INDIVIDUAL: 'bg-slate-100 text-slate-600',
  COMPANY: 'bg-sky-100 text-sky-700',
  REGULAR: 'bg-emerald-100 text-emerald-700',
  VIP: 'bg-amber-100 text-amber-700',
};
const STATUS_LABELS: Record<string, string> = {
  ACCEPTED: 'Новый', AWAITING_DESIGN: 'Ожидает макет', IN_DESIGN: 'В дизайне',
  DESIGN_APPROVAL: 'На согласовании', DESIGN_APPROVED: 'Согласован',
  IN_PROGRESS: 'В производстве', READY: 'Готов', DELIVERED: 'Выдан',
  REWORK: 'Переделка', CANCELLED: 'Отменён',
};

export default function ClientsPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const canManage = can('clients.manage');

  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<any | null>(null);

  // Создание
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [cf, setCf] = useState({ fullName: '', phone: '', type: 'INDIVIDUAL', email: '', discount: '', creditLimit: '', address: '', inn: '' });
  const [createMsg, setCreateMsg] = useState('');

  // Редактирование
  const [showEditForm, setShowEditForm] = useState(false);
  const [ef, setEf] = useState<any>({});
  const [editMsg, setEditMsg] = useState('');

  const [uploading, setUploading] = useState(false);
  const [fileMsg, setFileMsg] = useState('');

  function load() {
    const q = `companyId=${cid}&page=${page}&pageSize=${pageSize}${search ? `&search=${encodeURIComponent(search)}` : ''}`;
    api.get(`/clients?${q}`)
      .then((r) => { setList(r.items ?? []); setTotal(r.total ?? 0); })
      .catch(() => {});
  }

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [cid, search, page]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  async function openClient(id: string) {
    const full = await api.get(`/clients/${id}`);
    setSelected(full);
    setShowCreateForm(false);
    setShowEditForm(false);
  }

  // ---- создать ----
  async function createClient(e: React.FormEvent) {
    e.preventDefault(); setCreateMsg('');
    try {
      await api.post('/clients', {
        companyId: cid,
        phone: cf.phone,
        fullName: cf.fullName || undefined,
        type: cf.type,
        email: cf.email || undefined,
        address: cf.address || undefined,
        inn: cf.inn || undefined,
        discount: cf.discount ? Number(cf.discount) : undefined,
        creditLimit: cf.creditLimit ? Number(cf.creditLimit) : undefined,
      });
      setCf({ fullName: '', phone: '', type: 'INDIVIDUAL', email: '', discount: '', creditLimit: '', address: '', inn: '' });
      setShowCreateForm(false);
      load();
    } catch (err: any) { setCreateMsg('Ошибка: ' + err.message); }
  }

  // ---- редактировать ----
  function openEdit() {
    if (!selected) return;
    setEf({
      fullName: selected.fullName ?? '',
      phone: selected.phone ?? '',
      type: selected.type,
      email: selected.email ?? '',
      address: selected.address ?? '',
      inn: selected.inn ?? '',
      discount: String(Number(selected.discount) || ''),
      creditLimit: String(Number(selected.creditLimit) || ''),
      note: selected.note ?? '',
    });
    setEditMsg('');
    setShowEditForm(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault(); setEditMsg('');
    if (!selected) return;
    try {
      await api.patch(`/clients/${selected.id}`, {
        fullName: ef.fullName || undefined,
        phone: ef.phone,
        type: ef.type,
        email: ef.email || undefined,
        address: ef.address || undefined,
        inn: ef.inn || undefined,
        discount: ef.discount ? Number(ef.discount) : 0,
        creditLimit: ef.creditLimit ? Number(ef.creditLimit) : 0,
        note: ef.note || undefined,
      });
      setShowEditForm(false);
      openClient(selected.id);
      load();
    } catch (err: any) { setEditMsg('Ошибка: ' + err.message); }
  }

  // ---- файлы ----
  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    setUploading(true); setFileMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = typeof window !== 'undefined' ? localStorage.getItem('pp_token') : null;
      const res = await fetch(`${API_BASE}/clients/${selected.id}/files`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: fd,
      });
      if (!res.ok) throw new Error('Не удалось загрузить файл');
      await openClient(selected.id);
    } catch (err: any) { setFileMsg('Ошибка: ' + err.message); }
    finally { setUploading(false); e.target.value = ''; }
  }

  async function removeFile(fileId: string) {
    if (!selected) return;
    await api.del(`/clients/files/${fileId}`);
    openClient(selected.id);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Клиенты</h1>
        {canManage && (
          <button
            onClick={() => { setShowCreateForm((v) => !v); setSelected(null); setShowEditForm(false); }}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            {showCreateForm ? 'Отмена' : '+ Новый клиент'}
          </button>
        )}
      </div>

      {/* Форма создания */}
      {showCreateForm && canManage && (
        <div className="mb-6 rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-900">
          <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">Новый клиент</h2>
          <form onSubmit={createClient} className="grid gap-3 md:grid-cols-2">
            <input value={cf.fullName} onChange={(e) => setCf((f) => ({ ...f, fullName: e.target.value }))}
              placeholder="ФИО / название" className={inp} />
            <input value={cf.phone} onChange={(e) => setCf((f) => ({ ...f, phone: e.target.value }))}
              placeholder="Телефон *" required className={inp} />
            <select value={cf.type} onChange={(e) => setCf((f) => ({ ...f, type: e.target.value }))} className={inp}>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input value={cf.email} onChange={(e) => setCf((f) => ({ ...f, email: e.target.value }))}
              type="email" placeholder="Email" className={inp} />
            <input value={cf.address} onChange={(e) => setCf((f) => ({ ...f, address: e.target.value }))}
              placeholder="Адрес" className={inp} />
            <input value={cf.inn} onChange={(e) => setCf((f) => ({ ...f, inn: e.target.value }))}
              placeholder="ИНН" className={inp} />
            <input value={cf.discount} onChange={(e) => setCf((f) => ({ ...f, discount: e.target.value }))}
              type="number" min="0" max="100" placeholder="Скидка, %" className={inp} />
            <input value={cf.creditLimit} onChange={(e) => setCf((f) => ({ ...f, creditLimit: e.target.value }))}
              type="number" min="0" placeholder="Кредитный лимит, c. (0 = без)" className={inp} />
            <div className="md:col-span-2">
              <button className="w-full rounded-lg bg-emerald-600 px-5 py-2 font-medium text-white hover:bg-emerald-700">
                Сохранить
              </button>
            </div>
            {createMsg && <p className="md:col-span-2 text-sm text-rose-600">{createMsg}</p>}
          </form>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Список */}
        <div className="rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-900">
          <div className="mb-3 flex items-center gap-2">
            <input value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }}
              placeholder="Поиск по имени или телефону…" className={`${inp} flex-1`} />
            <span className="whitespace-nowrap text-xs text-slate-400">всего: {total}</span>
          </div>
          {list.length === 0 ? (
            <p className="text-slate-400">Клиентов не найдено.</p>
          ) : (
            <div className="space-y-1">
              {list.map((c) => (
                <button key={c.id} onClick={() => openClient(c.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-slate-50 dark:hover:bg-slate-800 ${selected?.id === c.id ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''}`}>
                  <span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">{c.fullName ?? 'Без имени'}</span>
                    <span className="ml-2 text-slate-400">{c.phone}</span>
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${TYPE_COLORS[c.type]}`}>
                    {TYPE_LABELS[c.type]}
                  </span>
                </button>
              ))}
            </div>
          )}
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-sm dark:border-slate-700">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300">
                ← Назад
              </button>
              <span className="text-slate-500">Стр. {page} из {pages}</span>
              <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300">
                Вперёд →
              </button>
            </div>
          )}
        </div>

        {/* Карточка клиента */}
        <div className="rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-900">
          {!selected ? (
            <p className="text-slate-400">Выберите клиента слева.</p>
          ) : showEditForm ? (
            /* Форма редактирования */
            <>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold text-slate-700 dark:text-slate-200">Редактировать клиента</h2>
                <button onClick={() => setShowEditForm(false)} className="text-sm text-slate-400 hover:text-slate-600">Отмена</button>
              </div>
              <form onSubmit={saveEdit} className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs text-slate-500">ФИО / название</label>
                  <input value={ef.fullName} onChange={(e) => setEf((f: any) => ({ ...f, fullName: e.target.value }))} className={inp} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Телефон *</label>
                  <input value={ef.phone} onChange={(e) => setEf((f: any) => ({ ...f, phone: e.target.value }))} required className={inp} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Тип</label>
                  <select value={ef.type} onChange={(e) => setEf((f: any) => ({ ...f, type: e.target.value }))} className={inp}>
                    {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Email</label>
                  <input type="email" value={ef.email} onChange={(e) => setEf((f: any) => ({ ...f, email: e.target.value }))} className={inp} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">ИНН</label>
                  <input value={ef.inn} onChange={(e) => setEf((f: any) => ({ ...f, inn: e.target.value }))} className={inp} />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs text-slate-500">Адрес</label>
                  <input value={ef.address} onChange={(e) => setEf((f: any) => ({ ...f, address: e.target.value }))} className={inp} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Скидка, %</label>
                  <input type="number" min="0" max="100" value={ef.discount} onChange={(e) => setEf((f: any) => ({ ...f, discount: e.target.value }))} className={inp} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Кредитный лимит, c.</label>
                  <input type="number" min="0" value={ef.creditLimit} onChange={(e) => setEf((f: any) => ({ ...f, creditLimit: e.target.value }))} className={inp} />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs text-slate-500">Примечание</label>
                  <input value={ef.note} onChange={(e) => setEf((f: any) => ({ ...f, note: e.target.value }))} className={inp} placeholder="Любые заметки о клиенте" />
                </div>
                {editMsg && <p className="sm:col-span-2 text-sm text-rose-600">{editMsg}</p>}
                <div className="sm:col-span-2 flex gap-2">
                  <button className="flex-1 rounded-lg bg-indigo-600 py-2 font-medium text-white hover:bg-indigo-700">
                    Сохранить
                  </button>
                  <button type="button" onClick={() => setShowEditForm(false)}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">
                    Отмена
                  </button>
                </div>
              </form>
            </>
          ) : (
            /* Просмотр */
            <>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                  {selected.fullName ?? 'Без имени'}
                </h2>
                <div className="flex items-center gap-1.5">
                  {canManage && (
                    <button onClick={openEdit}
                      className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
                      ✎ Изменить
                    </button>
                  )}
                  {selected.stats?.inactive && (
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-700">неактивный</span>
                  )}
                  <span className={`rounded-full px-2.5 py-1 text-xs ${TYPE_COLORS[selected.type]}`}>
                    {TYPE_LABELS[selected.type]}
                  </span>
                </div>
              </div>

              <div className="mb-4 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                <div>📞 {selected.phone}</div>
                {selected.email && <div>✉ {selected.email}</div>}
                {selected.address && <div>📍 {selected.address}</div>}
                {selected.inn && <div>ИНН: {selected.inn}</div>}
                {Number(selected.discount) > 0 && <div className="text-emerald-600">Скидка: {selected.discount}%</div>}
                {Number(selected.bonusPoints) > 0 && (
                  <div className="text-violet-600">🎁 Бонусы: {Number(selected.bonusPoints).toFixed(0)}</div>
                )}
                {Number(selected.creditLimit) > 0 && (
                  <div>
                    Кредитный лимит: {selected.creditLimit} c.
                    {selected.stats?.creditAvailable != null && (
                      <span className={selected.stats.creditAvailable < 0 ? 'ml-1 text-rose-600' : 'ml-1 text-slate-400'}>
                        (доступно {selected.stats.creditAvailable} c.)
                      </span>
                    )}
                  </div>
                )}
                {selected.note && <div className="rounded-lg bg-slate-50 px-3 py-2 text-slate-500 dark:bg-slate-800">💬 {selected.note}</div>}
              </div>

              {/* Статистика */}
              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Заказов" value={String(selected.stats.ordersCount)} />
                <Stat label="Потрачено" value={money(selected.stats.totalSpent)} />
                <Stat label="Ср. чек" value={money(selected.stats.avgCheck ?? 0)} />
                <Stat label="Долг" value={money(selected.stats.totalDebt)} danger={selected.stats.totalDebt > 0} />
              </div>

              {/* История заказов */}
              <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">История заказов</h3>
              {selected.orders.length === 0 ? (
                <p className="text-sm text-slate-400">Заказов нет.</p>
              ) : (
                <div className="max-h-52 space-y-1 overflow-auto">
                  {selected.orders.map((o: any) => (
                    <div key={o.id}
                      className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0 dark:border-slate-700">
                      <span className="text-slate-600 dark:text-slate-300">
                        №{o.orderNumber} · <span className="text-slate-400">{STATUS_LABELS[o.status]}</span>
                      </span>
                      <span>
                        <span className="text-slate-700 dark:text-slate-200">{money(Number(o.total))}</span>
                        {Number(o.balanceDue) > 0 && (
                          <span className="ml-2 text-rose-600">долг {money(Number(o.balanceDue))}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Файлы */}
              <div className="mt-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Файлы</h3>
                {canManage && (
                  <label className="cursor-pointer rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">
                    {uploading ? 'Загрузка…' : '📎 Загрузить'}
                    <input type="file" onChange={uploadFile} disabled={uploading} className="hidden" />
                  </label>
                )}
              </div>
              {fileMsg && <p className="mt-1 text-xs text-rose-600">{fileMsg}</p>}
              {!selected.files || selected.files.length === 0 ? (
                <p className="mt-1 text-sm text-slate-400">Файлов нет.</p>
              ) : (
                <div className="mt-1 space-y-1">
                  {selected.files.map((f: any) => (
                    <div key={f.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm dark:bg-slate-800">
                      <a href={`${SERVER_ORIGIN}${f.fileUrl}`} target="_blank" rel="noopener noreferrer"
                        className="truncate text-indigo-600 hover:underline">
                        📎 {f.fileName ?? 'файл'}
                      </a>
                      {canManage && (
                        <button onClick={() => removeFile(f.id)} className="ml-2 text-rose-400 hover:text-rose-600">✕</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-800">
      <div className={`font-bold ${danger ? 'text-rose-600' : 'text-slate-800 dark:text-slate-100'}`}>{value}</div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  );
}
