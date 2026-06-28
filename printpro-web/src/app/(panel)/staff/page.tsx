'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';

export default function StaffPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const [tab, setTab] = useState<'users' | 'roles'>('users');

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-slate-800">Сотрудники и роли</h1>

      <div className="mb-6 flex gap-2">
        <button
          onClick={() => setTab('users')}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            tab === 'users' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600'
          }`}
        >
          Сотрудники
        </button>
        {can('roles.manage') && (
          <button
            onClick={() => setTab('roles')}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              tab === 'roles' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600'
            }`}
          >
            Роли и права
          </button>
        )}
      </div>

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
        roleId: roleId || undefined,
        branchId: branchId || undefined,
      });
      setFullName('');
      setLogin('');
      setPassword('');
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

  return (
    <div className="space-y-6">
      {can('users.manage') && (
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-slate-700">Новый сотрудник</h2>
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ф.И.О."
              required
              className="rounded-lg border border-slate-300 px-3 py-2"
            />
            <input
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="Логин"
              required
              className="rounded-lg border border-slate-300 px-3 py-2"
            />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="Пароль (мин. 4)"
              required
              className="rounded-lg border border-slate-300 px-3 py-2"
            />
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">— роль —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">— филиал —</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <button className="rounded-lg bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-700">
              Добавить
            </button>
          </form>
          {msg && <p className="mt-2 text-sm text-slate-600">{msg}</p>}
        </div>
      )}

      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-slate-700">Список сотрудников</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2">Имя</th>
              <th>Логин</th>
              <th>Роль</th>
              <th className="text-right">Статус</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-slate-100 last:border-0">
                <td className="py-2 font-medium text-slate-700">{u.fullName}</td>
                <td className="text-slate-500">{u.login}</td>
                <td className="text-slate-500">{u.role?.name ?? '—'}</td>
                <td className="text-right">
                  {can('users.manage') ? (
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => resetPassword(u)}
                        className="rounded-lg border border-slate-200 px-2.5 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                        title="Сбросить пароль"
                      >
                        🔑 Пароль
                      </button>
                      <button
                        onClick={() => toggle(u)}
                        className={`rounded-full px-2.5 py-0.5 text-xs ${
                          u.isActive
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-200 text-slate-500'
                        }`}
                      >
                        {u.isActive ? 'Активен' : 'Отключён'}
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">
                      {u.isActive ? 'Активен' : 'Отключён'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-slate-700">Роли</h2>
        <div className="space-y-1">
          {roles.map((r) => (
            <button
              key={r.id}
              onClick={() => selectRole(r)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                selectedRole?.id === r.id ? 'bg-indigo-50' : 'hover:bg-slate-50'
              }`}
            >
              <span className="font-medium text-slate-700">{r.name}</span>
              <span className="text-xs text-slate-400">
                {r.permissions?.length ?? 0} прав
              </span>
            </button>
          ))}
        </div>
        <form onSubmit={createRole} className="mt-4 flex gap-2">
          <input
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            placeholder="Новая роль"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button className="rounded-lg bg-slate-700 px-3 text-sm text-white hover:bg-slate-800">
            +
          </button>
        </form>
      </div>

      {/* Права роли — галочки */}
      <div className="rounded-2xl bg-white p-5 shadow-sm lg:col-span-2">
        {!selectedRole ? (
          <p className="text-slate-400">Выберите роль слева, чтобы настроить права.</p>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-700">
                Права роли: {selectedRole.name}
              </h2>
              <button
                onClick={save}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Сохранить
              </button>
            </div>

            <div className="space-y-4">
              {Object.entries(grouped).map(([group, perms]) => (
                <div key={group}>
                  <div className="mb-2 text-sm font-semibold text-slate-500">
                    {group}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {perms.map((p) => (
                      <label
                        key={p.code}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
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
            {msg && <p className="mt-3 text-sm text-slate-600">{msg}</p>}
          </>
        )}
      </div>
    </div>
  );
}
