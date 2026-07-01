'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import {
  PageHeader,
  StatGrid,
  StatCard,
  TableCard,
  Field,
  Input,
  Select,
  Button,
  Badge,
  EmptyState,
} from '@/components/ui';
import NavIcon from '@/lib/NavIcons';

export default function StaffPage() {
  const cid = DEFAULT_COMPANY_ID;

  return (
    <div>
      <PageHeader icon="staff" title="Сотрудники" subtitle="Учётные записи и доступ. Роли и права — в Настройках." />
      <UsersTab cid={cid} />
    </div>
  );
}

// ---------------- Сотрудники ----------------
function UsersTab({ cid }: { cid: string }) {
  const { can } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);

  const [fullName, setFullName] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [roleId, setRoleId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [msg, setMsg] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  function openModal() {
    setFullName('');
    setLogin('');
    setPassword('');
    setPin('');
    setRoleId('');
    setBranchId('');
    setMsg('');
    setModalOpen(true);
  }

  function load() {
    api.get(`/users?companyId=${cid}`).then(setUsers).catch(() => {});
    api.get(`/roles?companyId=${cid}`).then(setRoles).catch(() => {});
    api.get(`/branches?companyId=${cid}`).then(setBranches).catch(() => {});
  }
  useEffect(load, [cid]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await api.post('/users', {
        companyId: cid,
        fullName,
        login,
        password,
        pin: pin || undefined,
        roleId: roleId || undefined,
        branchId: branchId || undefined,
      });
      setFullName('');
      setLogin('');
      setPassword('');
      setPin('');
      setRoleId('');
      setBranchId('');
      setModalOpen(false);
      load();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function toggle(u: any) {
    await api.patch(`/users/${u.id}/active`, { isActive: !u.isActive });
    load();
  }

  async function resetPassword(u: any) {
    const pwd = prompt(`Новый пароль для «${u.fullName}»:`);
    if (!pwd) return;
    try {
      await api.patch(`/users/${u.id}/password`, { password: pwd });
      alert(`Пароль для «${u.fullName}» изменён. Сообщите ему новый пароль.`);
    } catch (err: any) {
      alert('Ошибка: ' + err.message);
    }
  }

  // Задать/сбросить PIN кассира (пустое значение — убрать PIN)
  async function setUserPin(u: any) {
    const val = prompt(
      `PIN (4–6 цифр) для входа на кассу — «${u.fullName}».\nПусто — убрать PIN:`,
      '',
    );
    if (val === null) return;
    const trimmed = val.trim();
    if (trimmed && !/^\d{4,6}$/.test(trimmed)) {
      alert('PIN должен быть 4–6 цифр');
      return;
    }
    try {
      await api.patch(`/users/${u.id}/pin`, { pin: trimmed || null });
      alert(trimmed ? `PIN для «${u.fullName}» задан.` : `PIN для «${u.fullName}» убран.`);
      load();
    } catch (err: any) {
      alert('Ошибка: ' + err.message);
    }
  }

  const activeCount = users.filter((u) => u.isActive).length;

  return (
    <div className="space-y-6">
      <StatGrid cols={3}>
        <StatCard icon="staff" tone="indigo" label="Сотрудников" value={users.length} highlight />
        <StatCard icon="reports" tone="emerald" label="Активных" value={activeCount} />
        <StatCard icon="settings" tone="amber" label="Ролей" value={roles.length} />
      </StatGrid>

      {can('users.manage') && (
        <div className="flex justify-end">
          <Button onClick={openModal}>+ Новый сотрудник</Button>
        </div>
      )}

      <TableCard>
        <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-700/60">
          <h2 className="font-semibold text-slate-700 dark:text-slate-200">Список сотрудников</h2>
        </div>
        {users.length === 0 ? (
          <EmptyState icon="staff" title="Сотрудников нет" />
        ) : (
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Имя</th>
                  <th>Логин</th>
                  <th>Роль</th>
                  <th className="text-right">Статус</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="font-medium text-slate-700 dark:text-slate-200">{u.fullName}</td>
                    <td className="text-slate-500 dark:text-slate-400">{u.login}</td>
                    <td>
                      {u.role?.name ? (
                        <Badge tone="indigo">{u.role.name}</Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="text-right">
                      {can('users.manage') ? (
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => resetPassword(u)}
                            title="Сбросить пароль"
                          >
                            <NavIcon name="key" className="h-4 w-4" />Пароль
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setUserPin(u)}
                            title="Задать PIN для входа на кассу"
                          >
                            <NavIcon name="pin" className="h-4 w-4" />{u.hasPin ? 'PIN ✓' : 'PIN'}
                          </Button>
                          <button
                            onClick={() => toggle(u)}
                            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              u.isActive
                                ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                                : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {u.isActive ? 'Активен' : 'Отключён'}
                          </button>
                        </div>
                      ) : u.isActive ? (
                        <Badge tone="emerald">Активен</Badge>
                      ) : (
                        <Badge tone="slate">Отключён</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>

      {/* ===================== НОВЫЙ СОТРУДНИК (модальное окно) ===================== */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
            onClick={() => setModalOpen(false)}
          />
          <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Новый сотрудник</h3>
              <button
                onClick={() => setModalOpen(false)}
                aria-label="Закрыть"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <NavIcon name="close" className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={create} className="space-y-3">
              <Field label="Ф.И.О. *">
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Например: Иванов Иван" required autoFocus />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Логин *">
                  <Input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="ivan" required />
                </Field>
                <Field label="Пароль *">
                  <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="мин. 4 символа" required />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Роль">
                  <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                    <option value="">— роль —</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Филиал">
                  <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                    <option value="">— филиал —</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Field label="PIN кассира (4–6 цифр, необязательно)">
                <Input
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  placeholder="Для быстрого входа на кассе"
                />
              </Field>

              {msg && <p className="text-sm text-rose-600">{msg}</p>}

              <div className="flex gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setModalOpen(false)} className="flex-1">Отмена</Button>
                <Button type="submit" variant="emerald" className="flex-1">Добавить сотрудника</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
