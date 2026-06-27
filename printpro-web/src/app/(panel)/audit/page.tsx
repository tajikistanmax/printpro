'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';

const ACTION_COLORS: Record<string, string> = {
  Создание: 'bg-emerald-100 text-emerald-700',
  Изменение: 'bg-amber-100 text-amber-700',
  Удаление: 'bg-rose-100 text-rose-700',
};

const ENTITY_LABELS: Record<string, string> = {
  orders: 'Заказы',
  clients: 'Клиенты',
  cash: 'Касса',
  production: 'Производство',
  services: 'Услуги',
  products: 'Товары',
  stock: 'Склад',
  purchasing: 'Закупки',
  tasks: 'Задачи',
  users: 'Сотрудники',
  roles: 'Роли',
  settings: 'Настройки',
};

export default function AuditPage() {
  const cid = DEFAULT_COMPANY_ID;
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => {
    api
      .get(`/audit-log?companyId=${cid}&page=${page}&pageSize=${pageSize}`)
      .then((r) => {
        setRows(r.items ?? []);
        setTotal(r.total ?? 0);
      })
      .catch(() => {});
  }, [cid, page]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Журнал действий</h1>
        <span className="text-sm text-slate-400">всего: {total}</span>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm">
        {rows.length === 0 ? (
          <p className="text-slate-400">Записей пока нет.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-400">
                <th className="py-2 font-medium">Время</th>
                <th className="py-2 font-medium">Сотрудник</th>
                <th className="py-2 font-medium">Действие</th>
                <th className="py-2 font-medium">Раздел</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 text-slate-500">
                    {new Date(r.createdAt).toLocaleString('ru-RU')}
                  </td>
                  <td className="py-2 text-slate-700">{r.user}</td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        ACTION_COLORS[r.action] ?? 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {r.action}
                    </span>
                  </td>
                  <td className="py-2 text-slate-500">
                    {ENTITY_LABELS[r.entity] ?? r.entity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pages > 1 && (
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              ← Назад
            </button>
            <span className="text-slate-500">
              Стр. {page} из {pages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page >= pages}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              Вперёд →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
