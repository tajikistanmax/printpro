'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import {
  PageHeader,
  TableCard,
  Toolbar,
  Button,
  Badge,
  EmptyState,
  Tone,
} from '@/components/ui';

const ACTION_TONES: Record<string, Tone> = {
  Создание: 'emerald',
  Изменение: 'amber',
  Удаление: 'rose',
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
      <PageHeader
        icon="audit"
        title="Журнал действий"
        subtitle={`Всего записей: ${total}`}
      />

      <TableCard>
        {rows.length === 0 ? (
          <EmptyState icon="audit" title="Записей пока нет" />
        ) : (
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Время</th>
                  <th>Сотрудник</th>
                  <th>Действие</th>
                  <th>Раздел</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="text-slate-500 dark:text-slate-400">
                      {new Date(r.createdAt).toLocaleString('ru-RU')}
                    </td>
                    <td className="font-medium text-slate-700 dark:text-slate-200">{r.user}</td>
                    <td>
                      <Badge tone={ACTION_TONES[r.action] ?? 'slate'}>{r.action}</Badge>
                    </td>
                    <td className="text-slate-500 dark:text-slate-400">
                      {ENTITY_LABELS[r.entity] ?? r.entity}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <Toolbar className="justify-between border-b-0 border-t border-slate-100 dark:border-slate-700/60">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              ← Назад
            </Button>
            <span className="text-sm text-slate-500">
              Стр. {page} из {pages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page >= pages}
            >
              Вперёд →
            </Button>
          </Toolbar>
        )}
      </TableCard>
    </div>
  );
}
