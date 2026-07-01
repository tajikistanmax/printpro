'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import {
  PageHeader,
  StatGrid,
  StatCard,
  Tabs,
  TabItem,
  Card,
  TableCard,
  SectionTitle,
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
  const { can } = useAuth();
  const [tab, setTab] = useState<'users' | 'roles'>('users');

  const tabs: TabItem[] = [
    { key: 'users', label: 'Сотрудники' },
    ...(can('roles.manage') ? [{ key: 'roles', label: 'Роли и права' }] : []),
  ];

  return (
    <div>
      <PageHeader icon="staff" title="Сотрудники и роли" subtitle="Учётные записи, роли и права доступа" />

      <Tabs tabs={tabs} active={tab} onChange={(k) => setTab(k as 'users' | 'roles')} />

      {tab === 'users' ? <UsersTab cid={cid} /> : <RolesTab cid={cid} />}
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
      setMsg('✓ Сотрудник добавлен');
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
        <Card>
          <SectionTitle>Новый сотрудник</SectionTitle>
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ф.И.О."
              required
            />
            <Input
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="Логин"
              required
            />
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="Пароль (мин. 4)"
              required
            />
            <Input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              placeholder="PIN кассира (4–6 цифр, необязательно)"
            />
            <Select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
            >
              <option value="">— роль —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
            <Select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
            >
              <option value="">— филиал —</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
            <Button type="submit">Добавить</Button>
          </form>
          {msg && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{msg}</p>}
        </Card>
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
    </div>
  );
}

// ---------------- Роли и права ----------------
function RolesTab({ cid }: { cid: string }) {
  const [roles, setRoles] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [selectedRole, setSelectedRole] = useState<any | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  const [newRole, setNewRole] = useState('');

  function load() {
    api.get(`/roles?companyId=${cid}`).then(setRoles).catch(() => {});
    api.get('/permissions').then(setPermissions).catch(() => {});
  }
  useEffect(load, [cid]);

  function selectRole(role: any) {
    setSelectedRole(role);
    setMsg('');
    const codes = new Set<string>(
      role.permissions?.map((p: any) => p.permission.code) ?? [],
    );
    setChecked(codes);
  }

  function togglePerm(code: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function save() {
    if (!selectedRole) return;
    setMsg('');
    try {
      await api.put(`/roles/${selectedRole.id}/permissions`, {
        permissionCodes: Array.from(checked),
      });
      setMsg('✓ Права сохранены');
      load();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function createRole(e: React.FormEvent) {
    e.preventDefault();
    if (!newRole.trim()) return;
    await api.post('/roles', { companyId: cid, name: newRole });
    setNewRole('');
    load();
  }

  // Группируем права по разделам
  const grouped = useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const p of permissions) {
      (g[p.group ?? 'Прочее'] ??= []).push(p);
    }
    return g;
  }, [permissions]);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Список ролей */}
      <Card>
        <SectionTitle>Роли</SectionTitle>
        <div className="space-y-1">
          {roles.map((r) => (
            <button
              key={r.id}
              onClick={() => selectRole(r)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                selectedRole?.id === r.id ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <span className="font-medium text-slate-700 dark:text-slate-200">{r.name}</span>
              <span className="text-xs text-slate-400 dark:text-slate-500">
                {r.permissions?.length ?? 0} прав
              </span>
            </button>
          ))}
        </div>
        <form onSubmit={createRole} className="mt-4 flex gap-2">
          <Input
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            placeholder="Новая роль"
            className="flex-1"
          />
          <Button type="submit" variant="ghost" className="shrink-0">+</Button>
        </form>
      </Card>

      {/* Права роли — галочки */}
      <Card className="lg:col-span-2">
        {!selectedRole ? (
          <EmptyState icon="settings" title="Выберите роль слева, чтобы настроить права." />
        ) : (
          <>
            <SectionTitle right={<Button variant="emerald" onClick={save}>Сохранить</Button>}>
              Права роли: {selectedRole.name}
            </SectionTitle>

            <div className="space-y-4">
              {Object.entries(grouped).map(([group, perms]) => (
                <div key={group}>
                  <div className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
                    {group}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {perms.map((p) => (
                      <label
                        key={p.code}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 dark:text-slate-200"
                      >
                        <input
                          type="checkbox"
                          checked={checked.has(p.code)}
                          onChange={() => togglePerm(p.code)}
                        />
                        {p.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {msg && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{msg}</p>}
          </>
        )}
      </Card>
    </div>
  );
}
