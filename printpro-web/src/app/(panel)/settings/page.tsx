'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { POS_LAYOUTS, DEFAULT_POS_LAYOUT } from '@/lib/pos-layouts';
import { DISPLAY_LAYOUTS, DEFAULT_DISPLAY_LAYOUT } from '@/lib/display-layouts';
import { FEATURE_GROUPS, clearFeatureFlagsCache } from '@/lib/feature-flags';
import { openCustomerDisplay, buildPairingUrl } from '@/lib/customer-display';
import QRCode from 'qrcode';
import {
  VFD_PROTOCOLS,
  VFD_BAUDS,
  vfdSupported,
  requestVfdPort,
  vfdTest,
  readVfdConfig,
} from '@/lib/vfd-display';
import {
  ESCPOS_BAUDS,
  ESCPOS_CODEPAGES,
  readEscposConfig,
  requestEscposPort,
  escposTest,
} from '@/lib/escpos-printer';
import NavIcon from '@/lib/NavIcons';
import ImageUpload from '@/lib/ImageUpload';
import {
  PageHeader,
  Card,
  SectionTitle,
  Field,
  Input,
  Select,
  Button,
  Badge,
  EmptyState,
} from '@/components/ui';

const CURRENCIES = ['TJS', 'USD', 'RUB', 'EUR'];
const LANGUAGES = [
  { k: 'ru', l: 'Русский' },
  { k: 'tg', l: 'Тоҷикӣ' },
  { k: 'en', l: 'English' },
];
const DATE_FORMATS = [
  { k: 'DD.MM.YYYY', l: '23.05.2025' },
  { k: 'YYYY-MM-DD', l: '2025-05-23' },
  { k: 'DD/MM/YYYY', l: '23/05/2025' },
];

type Section =
  | null
  | 'profile'
  | 'branches'
  | 'catalog'
  | 'roles'
  | 'orders'
  | 'pos'
  | 'display'
  | 'sync'
  | 'notifications'
  | 'features'
  | 'backup';

function fmtUptime(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} дн ${h} ч`;
  if (h > 0) return `${h} ч ${m} мин`;
  return `${m} мин`;
}

export default function SettingsPage() {
  const cid = DEFAULT_COMPANY_ID;
  const router = useRouter();
  const [s, setS] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section>('profile');
  const [sys, setSys] = useState<any>(null);

  // Филиалы
  const [branches, setBranches] = useState<any[]>([]);
  const [bName, setBName] = useState('');
  const [bAddr, setBAddr] = useState('');
  const [bPhone, setBPhone] = useState('');
  const [editBId, setEditBId] = useState<string | null>(null);
  const [editB, setEditB] = useState<any>({});

  useEffect(() => {
    api
      .get(`/settings?companyId=${cid}`)
      .then((d) => setS(d ?? {}))
      .catch(() => {})
      .finally(() => setLoading(false));
    api.get('/system/info').then(setSys).catch(() => {});
  }, [cid]);

  const loadBranches = useCallback(() => {
    api.get(`/branches?companyId=${cid}&all=1`).then(setBranches).catch(() => {});
  }, [cid]);

  useEffect(() => {
    if (section === 'branches') loadBranches();
  }, [section, loadBranches]);

  function set(key: string, value: string) {
    setS((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setMsg('');
    try {
      await api.put('/settings', { companyId: cid, values: s });
      clearFeatureFlagsCache();
      setMsg('✓ Настройки сохранены');
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function downloadBackup() {
    setMsg('Готовлю резервную копию…');
    try {
      const dump = await api.get(`/backup/export?companyId=${cid}`);
      const blob = new Blob([JSON.stringify(dump, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `printpro-backup-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg('✓ Резервная копия скачана');
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function testTelegram() {
    setMsg('Сохраняю и проверяю Telegram…');
    try {
      await api.put('/settings', { companyId: cid, values: s });
      const res = await api.post('/notifications/telegram/test', { companyId: cid });
      setMsg(
        res.ok
          ? '✓ Сообщение отправлено в Telegram'
          : 'Не отправлено: проверьте токен бота и chat_id',
      );
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function testEmail() {
    if (!s.smtpUser) {
      setMsg('Сначала укажите логин (email) SMTP');
      return;
    }
    setMsg('Сохраняю и отправляю тестовое письмо…');
    try {
      await api.put('/settings', { companyId: cid, values: s });
      const res = await api.post('/notifications/email/test', {
        companyId: cid,
        to: s.smtpTestTo || s.smtpUser,
      });
      setMsg(
        res.ok
          ? `✓ Тестовое письмо отправлено на ${s.smtpTestTo || s.smtpUser}`
          : 'Не отправлено: ' + (res.message ?? 'проверьте настройки SMTP'),
      );
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  function onLogoFile(file: File) {
    if (file.size > 1024 * 1024) {
      setMsg('Логотип слишком большой — выберите файл до 1 МБ');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set('logoDataUrl', String(reader.result));
    reader.readAsDataURL(file);
  }

  // ---- филиалы ----
  async function addBranch(e: React.FormEvent) {
    e.preventDefault();
    if (!bName.trim()) return;
    try {
      await api.post('/branches', {
        companyId: cid,
        name: bName.trim(),
        address: bAddr.trim() || undefined,
        phone: bPhone.trim() || undefined,
      });
      setBName(''); setBAddr(''); setBPhone('');
      loadBranches();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }
  function openEditB(b: any) {
    setEditBId(b.id);
    setEditB({ name: b.name, address: b.address ?? '', phone: b.phone ?? '' });
  }
  async function saveEditB() {
    if (!editBId) return;
    try {
      await api.patch(`/branches/${editBId}`, {
        name: editB.name,
        address: editB.address || undefined,
        phone: editB.phone || undefined,
      });
      setEditBId(null);
      loadBranches();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }
  async function toggleBranch(b: any) {
    try {
      await api.patch(`/branches/${b.id}`, { isActive: !b.isActive });
      loadBranches();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  if (loading)
    return <p className="text-slate-400 dark:text-slate-500">Загрузка…</p>;

  // ====================== МАКЕТ: МЕНЮ + ДЕТАЛЬ + ПРАВАЯ КОЛОНКА ======================
  const titles: Record<string, string> = {
    profile: 'Компания и профиль',
    branches: 'Филиалы и склады',
    catalog: 'Справочники',
    roles: 'Роли и права',
    orders: 'Заказы',
    pos: 'Касса и оплата',
    display: 'Дисплей покупателя',
    sync: 'Синхронизация',
    notifications: 'Уведомления',
    features: 'Функции системы',
  };
  const subtitles: Record<string, string> = {
    profile: 'Реквизиты, контакты, логотип и общие параметры',
    branches: 'Точки обслуживания и склады',
    catalog: 'Категории товаров, услуг и единицы измерения',
    roles: 'Роли доступа и права сотрудников',
    orders: 'Нумерация и сроки заказов',
    pos: 'Оформление экрана продажи',
    display: 'Второй экран: графический монитор и текстовый VFD-дисплей',
    sync: 'Обмен данными между локальным сервером и облаком',
    notifications: 'Email, Telegram и системные уведомления',
    features: 'Включение и отключение разделов',
  };
  const savableSections = ['profile', 'orders', 'pos', 'display', 'notifications', 'features'];

  const NAV: { key?: Section; href?: string; icon: string; title: string; tone: string }[] = [
    { key: 'profile',       icon: 'staff',      title: 'Компания и профиль',  tone: 'indigo' },
    { key: 'branches',      icon: 'warehouse',  title: 'Филиалы и склады',    tone: 'sky' },
    { key: 'catalog',       icon: 'barcode',    title: 'Справочники',         tone: 'amber' },
    { key: 'roles',         icon: 'clients',    title: 'Роли и права',        tone: 'violet' },
    { key: 'orders',        icon: 'orders',     title: 'Заказы',              tone: 'amber' },
    { key: 'notifications', icon: 'complaints', title: 'Уведомления',         tone: 'rose' },
    { key: 'pos',           icon: 'pos',        title: 'Касса и оплата',      tone: 'sky' },
    { key: 'display',       icon: 'production', title: 'Дисплей покупателя',  tone: 'violet' },
    { key: 'sync',          icon: 'refresh',    title: 'Синхронизация',       tone: 'emerald' },
    { key: 'features',      icon: 'settings',   title: 'Функции системы',     tone: 'indigo' },
    { href: '/audit',       icon: 'audit',      title: 'Журнал системы',      tone: 'slate' },
  ];

  return (
    <div>
      <PageHeader
        icon="settings"
        title="Настройки"
        subtitle="Управление системой и конфигурацией приложения"
      />

      <div className="grid gap-6 lg:grid-cols-[260px_1fr] xl:grid-cols-[260px_1fr_300px]">
        {/* ---- Левое меню категорий ---- */}
        <nav className="space-y-1.5 lg:sticky lg:top-4 lg:self-start">
          {NAV.map((n) => {
            const active = !!n.key && n.key === section;
            const inner = (
              <>
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONE_TILE[n.tone]}`}>
                  <NavIcon name={n.icon} className="h-[18px] w-[18px]" />
                </span>
                <span className="flex-1 truncate text-sm font-medium">{n.title}</span>
                <NavIcon name="arrowLeft" className="h-4 w-4 shrink-0 rotate-180 text-slate-300" />
              </>
            );
            const cls = `flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
              active
                ? 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300'
                : 'border-transparent text-slate-700 hover:bg-white hover:shadow-sm dark:text-slate-200 dark:hover:bg-slate-800'
            }`;
            return (
              <button
                key={n.title}
                onClick={() => (n.href ? router.push(n.href) : (setSection(n.key!), setMsg('')))}
                className={cls}
              >
                {inner}
              </button>
            );
          })}
        </nav>

        {/* ---- Деталь выбранной категории ---- */}
        <div className="min-w-0">
          <div className="mb-5">
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              {section ? titles[section] : ''}
            </h2>
            {section && subtitles[section] && (
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitles[section]}</p>
            )}
          </div>

          {section === 'profile' && (
            <div className="space-y-6">
              <ProfileSection s={s} set={set} onLogoFile={onLogoFile} />
              <Card>
                <SectionTitle>Общие параметры</SectionTitle>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Язык системы">
                    <Select value={s.language ?? 'ru'} onChange={(e) => set('language', e.target.value)}>
                      {LANGUAGES.map((l) => <option key={l.k} value={l.k}>{l.l}</option>)}
                    </Select>
                  </Field>
                  <Field label="Часовой пояс">
                    <Input value={s.timezone ?? ''} onChange={(e) => set('timezone', e.target.value)} placeholder="(UTC +05:00) Душанбе" />
                  </Field>
                  <Field label="Формат даты">
                    <Select value={s.dateFormat ?? 'DD.MM.YYYY'} onChange={(e) => set('dateFormat', e.target.value)}>
                      {DATE_FORMATS.map((d) => <option key={d.k} value={d.k}>{d.l}</option>)}
                    </Select>
                  </Field>
                  <Field label="Валюта">
                    <Select value={s.currency ?? 'TJS'} onChange={(e) => set('currency', e.target.value)}>
                      {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </Select>
                  </Field>
                </div>
              </Card>
            </div>
          )}
          {section === 'branches' && (
            <BranchesSection
              branches={branches}
              bName={bName} setBName={setBName}
              bAddr={bAddr} setBAddr={setBAddr}
              bPhone={bPhone} setBPhone={setBPhone}
              addBranch={addBranch}
              editBId={editBId} editB={editB} setEditB={setEditB}
              openEditB={openEditB} saveEditB={saveEditB} cancelEditB={() => setEditBId(null)}
              toggleBranch={toggleBranch}
            />
          )}
          {section === 'catalog' && <CatalogSection cid={cid} />}
          {section === 'roles' && <RolesSection cid={cid} />}
          {section === 'orders' && <OrdersSection s={s} set={set} />}
          {section === 'pos' && <PosSection s={s} set={set} />}
          {section === 'display' && <DisplaySection s={s} set={set} setMsg={setMsg} />}
          {section === 'sync' && <SyncSection />}
          {section === 'notifications' && (
            <NotificationsSection s={s} set={set} testTelegram={testTelegram} testEmail={testEmail} />
          )}
          {section === 'features' && <FeaturesSection s={s} set={set} />}

          {section && savableSections.includes(section) && (
            <div className="mt-6 flex items-center gap-3">
              <Button onClick={save} className="px-6 py-2.5"><NavIcon name="check" className="h-4 w-4" />Сохранить изменения</Button>
              {msg && <span className="text-sm text-slate-600 dark:text-slate-300">{msg}</span>}
            </div>
          )}
        </div>

        {/* ---- Правая колонка ---- */}
        <div className="space-y-6 xl:sticky xl:top-4 xl:self-start">
          {/* Быстрые действия */}
          <div className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900">
            <h3 className="mb-3 px-1 text-sm font-bold text-slate-800 dark:text-slate-100">Быстрые действия</h3>
            <div className="space-y-1">
              <QuickAction icon="download" tone="emerald" title="Экспорт данных" sub="Выгрузить всё в JSON" onClick={downloadBackup} />
              <QuickAction icon="clients" tone="violet" title="Сотрудники" sub="Учётные записи и доступ" onClick={() => router.push('/staff')} />
              <QuickAction icon="audit" tone="sky" title="Журнал системы" sub="История действий" onClick={() => router.push('/audit')} />
            </div>
          </div>

          {/* Информация о системе */}
          <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm dark:border-slate-700/60 dark:bg-slate-900">
            <h3 className="mb-3 text-sm font-bold text-slate-800 dark:text-slate-100">Информация о системе</h3>
            <dl className="space-y-2.5 text-sm">
              <InfoRow label="Версия системы" value={sys?.appVersion ?? '…'} />
              <InfoRow label="База данных" value={sys?.dbVersion ?? '…'} />
              <InfoRow label="Время работы" value={sys ? fmtUptime(sys.uptimeSeconds) : '…'} />
              <InfoRow label="Платформа" value={sys ? `Node ${sys.nodeVersion}` : '…'} />
              <div className="flex items-center justify-between pt-1">
                <dt className="text-slate-500 dark:text-slate-400">Статус</dt>
                <dd>
                  <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                    В порядке
                  </span>
                </dd>
              </div>
            </dl>
          </div>

          {/* Подсказка */}
          <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-violet-50 p-5 dark:border-indigo-500/20 dark:from-indigo-500/10 dark:to-violet-500/10">
            <div className="mb-1.5 flex items-center gap-2 font-semibold text-indigo-700 dark:text-indigo-300">
              <NavIcon name="alert" className="h-4 w-4" />Подсказка
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Изменения в настройках могут потребовать перезагрузки системы для корректного применения.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

const TONE_TILE: Record<string, string> = {
  indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
  sky: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  rose: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300',
};

function QuickAction({
  icon, tone, title, sub, onClick,
}: {
  icon: string;
  tone: string;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800"
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONE_TILE[tone]}`}>
        <NavIcon name={icon} className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{title}</span>
        <span className="block truncate text-xs text-slate-400">{sub}</span>
      </span>
      <NavIcon name="arrowLeft" className="h-4 w-4 shrink-0 rotate-180 text-slate-300" />
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="font-medium tabular-nums text-slate-800 dark:text-slate-100">{value}</dd>
    </div>
  );
}

/* (старые карточки-разделы заменены на меню категорий выше) */

/* ------------------------------------------------------------------ */
/*  Разделы                                                            */
/* ------------------------------------------------------------------ */
function ProfileSection({
  s, set, onLogoFile,
}: {
  s: Record<string, string>;
  set: (k: string, v: string) => void;
  onLogoFile: (f: File) => void;
}) {
  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle>Основная информация</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Название компании">
            <Input value={s.companyName ?? ''} onChange={(e) => set('companyName', e.target.value)} />
          </Field>
          <Field label="Телефон">
            <Input value={s.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Email">
            <Input value={s.companyEmail ?? ''} onChange={(e) => set('companyEmail', e.target.value)} placeholder="info@example.com" />
          </Field>
          <Field label="Сайт">
            <Input value={s.companyWebsite ?? ''} onChange={(e) => set('companyWebsite', e.target.value)} placeholder="example.com" />
          </Field>
          <Field label="Адрес" className="sm:col-span-2">
            <Input value={s.companyAddress ?? ''} onChange={(e) => set('companyAddress', e.target.value)} placeholder="г. Душанбе, ул. …" />
          </Field>
        </div>
      </Card>

      <Card>
        <SectionTitle>Реквизиты</SectionTitle>
        <p className="-mt-1 mb-3 text-xs text-slate-400 dark:text-slate-500">
          Используются в счетах, актах и коммерческих предложениях.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ИНН">
            <Input value={s.companyInn ?? ''} onChange={(e) => set('companyInn', e.target.value)} />
          </Field>
          <Field label="Расчётный счёт">
            <Input value={s.companyAccount ?? ''} onChange={(e) => set('companyAccount', e.target.value)} />
          </Field>
          <Field label="Банк">
            <Input value={s.companyBank ?? ''} onChange={(e) => set('companyBank', e.target.value)} />
          </Field>
          <Field label="МФО / БИК">
            <Input value={s.companyBankCode ?? ''} onChange={(e) => set('companyBankCode', e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card>
        <SectionTitle>Логотип</SectionTitle>
        <p className="-mt-1 mb-3 text-xs text-slate-400 dark:text-slate-500">
          Показывается в чеках и документах. PNG/JPG до 1 МБ.
        </p>
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
            {s.logoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.logoDataUrl} alt="Логотип" className="h-full w-full object-contain" />
            ) : (
              <span className="text-xs text-slate-400">нет</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800">
              Выбрать файл
              <input
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onLogoFile(e.target.files[0])}
              />
            </label>
            {s.logoDataUrl && (
              <Button variant="ghost" size="sm" onClick={() => set('logoDataUrl', '')}>Удалить</Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function BranchesSection({
  branches, bName, setBName, bAddr, setBAddr, bPhone, setBPhone, addBranch,
  editBId, editB, setEditB, openEditB, saveEditB, cancelEditB, toggleBranch,
}: any) {
  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle>Новый филиал</SectionTitle>
        <form onSubmit={addBranch} className="grid gap-3 sm:grid-cols-3">
          <Field label="Название">
            <Input value={bName} onChange={(e: any) => setBName(e.target.value)} placeholder="Главный офис" required />
          </Field>
          <Field label="Адрес">
            <Input value={bAddr} onChange={(e: any) => setBAddr(e.target.value)} placeholder="ул. …" />
          </Field>
          <Field label="Телефон">
            <Input value={bPhone} onChange={(e: any) => setBPhone(e.target.value)} placeholder="+992 …" />
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit">+ Добавить филиал</Button>
          </div>
        </form>
      </Card>

      <Card>
        <SectionTitle>Филиалы ({branches.length})</SectionTitle>
        {branches.length === 0 ? (
          <EmptyState icon="warehouse" title="Филиалов нет" hint="Добавьте первый филиал выше." />
        ) : (
          <div className="space-y-2">
            {branches.map((b: any) =>
              editBId === b.id ? (
                <div key={b.id} className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-700 dark:bg-indigo-900/20">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Input value={editB.name} onChange={(e: any) => setEditB((f: any) => ({ ...f, name: e.target.value }))} placeholder="Название" />
                    <Input value={editB.address} onChange={(e: any) => setEditB((f: any) => ({ ...f, address: e.target.value }))} placeholder="Адрес" />
                    <Input value={editB.phone} onChange={(e: any) => setEditB((f: any) => ({ ...f, phone: e.target.value }))} placeholder="Телефон" />
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" onClick={saveEditB}>Сохранить</Button>
                    <Button size="sm" variant="ghost" onClick={cancelEditB}>Отмена</Button>
                  </div>
                </div>
              ) : (
                <div key={b.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 px-4 py-3 dark:border-slate-700/60">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-700 dark:text-slate-200">{b.name}</span>
                      {b.isActive ? <Badge tone="emerald">активен</Badge> : <Badge tone="slate">отключён</Badge>}
                    </div>
                    <div className="truncate text-xs text-slate-400">
                      {[b.address, b.phone].filter(Boolean).join(' · ') || 'без адреса'}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" onClick={() => openEditB(b)} aria-label="Изменить"><NavIcon name="edit" className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => toggleBranch(b)}>
                      {b.isActive ? 'Отключить' : 'Включить'}
                    </Button>
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

// Справочники: категории товаров и единицы измерения
function CatalogSection({ cid }: { cid: string }) {
  const [categories, setCategories] = useState<any[]>([]);
  const [serviceCats, setServiceCats] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [catName, setCatName] = useState('');
  const [catParent, setCatParent] = useState(''); // родитель для новой подкатегории
  const [scatName, setScatName] = useState('');
  const [scatParent, setScatParent] = useState(''); // родитель для новой подкатегории услуг
  const [uName, setUName] = useState('');
  const [uShort, setUShort] = useState('');
  const [msg, setMsg] = useState('');
  // Инлайн-редактирование: { kind: 'cat'|'scat'|'unit', id, name, shortName? }
  const [edit, setEdit] = useState<any>(null);

  function load() {
    api.get(`/product-categories?companyId=${cid}`).then(setCategories).catch(() => {});
    api.get(`/service-categories?companyId=${cid}`).then(setServiceCats).catch(() => {});
    api.get(`/units?companyId=${cid}`).then(setUnits).catch(() => {});
  }
  useEffect(load, [cid]);

  function urlFor(kind: string, id: string) {
    return kind === 'unit' ? `/units/${id}`
      : kind === 'scat' ? `/service-categories/${id}`
      : `/product-categories/${id}`;
  }
  async function setDefault(kind: string, id: string) {
    try { await api.patch(urlFor(kind, id), { isDefault: true }); load(); }
    catch (e: any) { setMsg('Ошибка: ' + e.message); }
  }
  async function saveEdit() {
    if (!edit) return;
    const body = edit.kind === 'unit'
      ? { name: edit.name, shortName: edit.shortName }
      : { name: edit.name };
    try { await api.patch(urlFor(edit.kind, edit.id), body); setEdit(null); load(); }
    catch (e: any) { setMsg('Ошибка: ' + e.message); }
  }

  async function addCategory() {
    const n = catName.trim();
    if (!n) return;
    try {
      await api.post('/product-categories', { companyId: cid, name: n, parentId: catParent || undefined });
      setCatName(''); setCatParent(''); setMsg(''); load();
    } catch (e: any) { setMsg('Ошибка: ' + e.message); }
  }
  async function delCategory(id: string) {
    if (!confirm('Удалить категорию? Товары останутся без категории.')) return;
    try { await api.del(`/product-categories/${id}`); load(); } catch (e: any) { setMsg('Ошибка: ' + e.message); }
  }
  async function addServiceCat() {
    const n = scatName.trim();
    if (!n) return;
    try {
      await api.post('/service-categories', { companyId: cid, name: n, parentId: scatParent || undefined });
      setScatName(''); setScatParent(''); setMsg(''); load();
    } catch (e: any) { setMsg('Ошибка: ' + e.message); }
  }
  async function delServiceCat(id: string) {
    if (!confirm('Удалить категорию услуг? Услуги останутся без категории.')) return;
    try { await api.del(`/service-categories/${id}`); load(); } catch (e: any) { setMsg('Ошибка: ' + e.message); }
  }
  async function addUnit(e: React.FormEvent) {
    e.preventDefault();
    const short = uShort.trim() || uName.trim();
    const name = uName.trim() || uShort.trim();
    if (!short) return;
    try {
      await api.post('/units', { companyId: cid, name, shortName: short });
      setUName(''); setUShort(''); setMsg(''); load();
    } catch (e: any) { setMsg('Ошибка: ' + e.message); }
  }
  async function delUnit(id: string) {
    if (!confirm('Удалить единицу измерения?')) return;
    try { await api.del(`/units/${id}`); load(); } catch (e: any) { setMsg('Ошибка: ' + e.message); }
  }

  const renderRow = (kind: string, it: any) => {
    const editing = edit?.kind === kind && edit.id === it.id;
    const label = kind === 'unit' ? `${it.shortName} — ${it.name}` : it.name;
    return (
      <div key={it.id} className="flex items-center justify-between gap-2 border-b border-slate-100 py-2 last:border-0 dark:border-slate-700/60">
        {editing ? (
          <div className="flex flex-1 flex-wrap items-center gap-2">
            {kind === 'unit' && (
              <Input value={edit.shortName ?? ''} onChange={(e) => setEdit({ ...edit, shortName: e.target.value })} placeholder="шт" className="w-20" />
            )}
            <Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder={kind === 'unit' ? 'Штука' : 'Название'} className="min-w-[140px] flex-1" />
            <Button size="sm" onClick={saveEdit}>OK</Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Отмена</Button>
          </div>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setDefault(kind, it.id)}
                title={it.isDefault ? 'По умолчанию' : 'Сделать по умолчанию'}
                aria-label={it.isDefault ? 'По умолчанию' : 'Сделать по умолчанию'}
                className={it.isDefault ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill={it.isDefault ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
                  <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5-5.9-3.2-5.9 3.2 1.2-6.5L2.5 9.4l6.6-.9z" />
                </svg>
              </button>
              <span className="truncate text-sm text-slate-700 dark:text-slate-200">{label}</span>
              {it.isDefault && <Badge tone="amber">по умолчанию</Badge>}
            </div>
            <div className="flex shrink-0 gap-1">
              <Button variant="ghost" size="sm" aria-label="Изменить" onClick={() => setEdit(kind === 'unit' ? { kind, id: it.id, name: it.name, shortName: it.shortName } : { kind, id: it.id, name: it.name })}>
                <NavIcon name="edit" className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" aria-label="Удалить" className="text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20" onClick={() => (kind === 'unit' ? delUnit(it.id) : kind === 'scat' ? delServiceCat(it.id) : delCategory(it.id))}>
                <NavIcon name="close" className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle>Категории товаров</SectionTitle>
        <p className="-mt-1 mb-2 text-xs text-slate-400 dark:text-slate-500">
          Можно создавать подкатегории: напр. «Сувениры» → «Кружки», «Кепки». ★ — категория по умолчанию.
        </p>
        {categories.length === 0 ? (
          <p className="text-xs text-slate-400">Нет категорий.</p>
        ) : (
          <div>
            {categories
              .filter((c) => !c.parentId || !categories.some((p: any) => p.id === c.parentId))
              .map((c) => (
                <div key={c.id}>
                  {renderRow('cat', c)}
                  {categories
                    .filter((ch) => ch.parentId === c.id)
                    .map((ch) => (
                      <div key={ch.id} className="ml-5 border-l-2 border-slate-100 pl-2 dark:border-slate-700/60">
                        {renderRow('cat', ch)}
                      </div>
                    ))}
                </div>
              ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input value={catName} onChange={(e) => setCatName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCategory())} placeholder="Категория или подкатегория" className="min-w-[160px] flex-1" />
          <Select value={catParent} onChange={(e) => setCatParent(e.target.value)} className="w-auto">
            <option value="">— верхний уровень —</option>
            {categories.filter((c) => !c.parentId).map((c) => (
              <option key={c.id} value={c.id}>в «{c.name}»</option>
            ))}
          </Select>
          <Button type="button" variant="ghost" onClick={addCategory} className="shrink-0">+ Добавить</Button>
        </div>
      </Card>

      <Card>
        <SectionTitle>Категории услуг</SectionTitle>
        <p className="-mt-1 mb-2 text-xs text-slate-400 dark:text-slate-500">
          Можно создавать подкатегории: напр. «Печать» → «Визитки», «Баннеры».
        </p>
        {serviceCats.length === 0 ? (
          <p className="text-xs text-slate-400">Нет категорий услуг.</p>
        ) : (
          <div>
            {serviceCats
              .filter((c) => !c.parentId || !serviceCats.some((p: any) => p.id === c.parentId))
              .map((c) => (
                <div key={c.id}>
                  {renderRow('scat', c)}
                  {serviceCats
                    .filter((ch) => ch.parentId === c.id)
                    .map((ch) => (
                      <div key={ch.id} className="ml-5 border-l-2 border-slate-100 pl-2 dark:border-slate-700/60">
                        {renderRow('scat', ch)}
                      </div>
                    ))}
                </div>
              ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input value={scatName} onChange={(e) => setScatName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addServiceCat())} placeholder="Категория или подкатегория" className="min-w-[160px] flex-1" />
          <Select value={scatParent} onChange={(e) => setScatParent(e.target.value)} className="w-auto">
            <option value="">— верхний уровень —</option>
            {serviceCats.filter((c) => !c.parentId).map((c) => (
              <option key={c.id} value={c.id}>в «{c.name}»</option>
            ))}
          </Select>
          <Button type="button" variant="ghost" onClick={addServiceCat} className="shrink-0">+ Добавить</Button>
        </div>
      </Card>

      <Card>
        <SectionTitle>Единицы измерения</SectionTitle>
        <p className="-mt-1 mb-2 text-xs text-slate-400 dark:text-slate-500">★ — единица по умолчанию для новых товаров (обычно «шт»).</p>
        {units.length === 0 ? (
          <p className="text-sm text-slate-400">Нет единиц. Добавьте: шт, м², рул и т.д.</p>
        ) : (
          <div>{units.map((u) => renderRow('unit', u))}</div>
        )}
        <form onSubmit={addUnit} className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Полное название"><Input value={uName} onChange={(e) => setUName(e.target.value)} placeholder="Штука" className="w-36" /></Field>
          <Field label="Сокращение"><Input value={uShort} onChange={(e) => setUShort(e.target.value)} placeholder="шт" className="w-24" /></Field>
          <Button type="submit" variant="ghost">+ Единица</Button>
        </form>
      </Card>

      {msg && <p className="text-sm text-slate-600 dark:text-slate-300">{msg}</p>}
    </div>
  );
}

// Роли и права доступа (перенесено из «Сотрудники»)
function RolesSection({ cid }: { cid: string }) {
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
    setChecked(new Set<string>(role.permissions?.map((p: any) => p.permission.code) ?? []));
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
      await api.put(`/roles/${selectedRole.id}/permissions`, { permissionCodes: Array.from(checked) });
      setMsg('✓ Права сохранены');
      load();
    } catch (err: any) { setMsg('Ошибка: ' + err.message); }
  }
  async function createRole(e: React.FormEvent) {
    e.preventDefault();
    if (!newRole.trim()) return;
    await api.post('/roles', { companyId: cid, name: newRole });
    setNewRole('');
    load();
  }

  const grouped = useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const p of permissions) (g[p.group ?? 'Прочее'] ??= []).push(p);
    return g;
  }, [permissions]);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card>
        <SectionTitle>Роли</SectionTitle>
        <div className="space-y-1">
          {roles.map((r) => (
            <button
              key={r.id}
              onClick={() => selectRole(r)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${selectedRole?.id === r.id ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
            >
              <span className="font-medium text-slate-700 dark:text-slate-200">{r.name}</span>
              <span className="text-xs text-slate-400 dark:text-slate-500">{r.permissions?.length ?? 0} прав</span>
            </button>
          ))}
        </div>
        <form onSubmit={createRole} className="mt-4 flex gap-2">
          <Input value={newRole} onChange={(e) => setNewRole(e.target.value)} placeholder="Новая роль" className="flex-1" />
          <Button type="submit" variant="ghost" className="shrink-0" aria-label="Добавить">+</Button>
        </form>
      </Card>

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
                  <div className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">{group}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {perms.map((p) => (
                      <label key={p.code} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                        <input type="checkbox" checked={checked.has(p.code)} onChange={() => togglePerm(p.code)} />
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

function OrdersSection({ s, set }: { s: Record<string, string>; set: (k: string, v: string) => void }) {
  const prefix = (s.orderPrefix || 'ORD').replace(/[^A-Za-zА-Яа-я0-9]/g, '').toUpperCase() || 'ORD';
  const year = new Date().getFullYear();
  return (
    <Card>
      <SectionTitle>Параметры заказов</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Префикс номера заказа">
          <Input value={s.orderPrefix ?? ''} onChange={(e) => set('orderPrefix', e.target.value)} placeholder="ORD" />
        </Field>
        <Field label="Срок выполнения по умолчанию, дней">
          <Input type="number" min="0" value={s.orderDefaultLeadDays ?? ''} onChange={(e) => set('orderDefaultLeadDays', e.target.value)} placeholder="напр. 3" />
        </Field>
      </div>
      <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-800/50">
        <span className="text-slate-500">Пример номера: </span>
        <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">{prefix}-K1-{year}-000123</span>
        <p className="mt-1 text-xs text-slate-400">
          Код точки (K1…) подставляется автоматически. Срок проставляется новым заказам, если он не указан вручную.
        </p>
      </div>
    </Card>
  );
}

function PosSection({ s, set }: { s: Record<string, string>; set: (k: string, v: string) => void }) {
  return (
    <div className="space-y-6">
    <Card>
      <SectionTitle>Оформление кассы</SectionTitle>
      <p className="-mt-1 mb-4 text-xs text-slate-400 dark:text-slate-500">
        Выберите внешний вид страницы «Касса — продажа». Применится у всех кассиров после сохранения.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {POS_LAYOUTS.map((opt) => {
          const active = (s.posLayout ?? DEFAULT_POS_LAYOUT) === opt.k;
          return (
            <button
              key={opt.k}
              type="button"
              onClick={() => set('posLayout', opt.k)}
              className={`rounded-xl border-2 p-4 text-left transition ${
                active
                  ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-900/20'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800 dark:text-slate-100">{opt.name}</span>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${active ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                  {active && '✓'}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{opt.desc}</p>
            </button>
          );
        })}
      </div>
    </Card>

    <Card>
      <SectionTitle>Дизайн второго экрана (экран клиента)</SectionTitle>
      <p className="-mt-1 mb-4 text-xs text-slate-400 dark:text-slate-500">
        Как выглядит дисплей покупателя (второй экран). Применится после сохранения — переоткройте второй экран.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {DISPLAY_LAYOUTS.map((opt) => {
          const active = (s.customerDisplayLayout ?? DEFAULT_DISPLAY_LAYOUT) === opt.k;
          return (
            <button
              key={opt.k}
              type="button"
              onClick={() => set('customerDisplayLayout', opt.k)}
              className={`rounded-xl border-2 p-4 text-left transition ${
                active
                  ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-900/20'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800 dark:text-slate-100">{opt.name}</span>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${active ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                  {active && '✓'}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{opt.desc}</p>
            </button>
          );
        })}
      </div>
      <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-700/60">
        <ImageUpload
          value={s.displayQr}
          onChange={(url) => set('displayQr', url)}
          label="QR-код для промо-полосы второго экрана (отзыв / связь)"
          size="h-28 w-28"
        />
        <p className="mt-1 text-xs text-slate-400">
          Показывается в блоке «Оставьте отзыв · Отсканируйте QR» на втором экране.
        </p>
      </div>
    </Card>

    <Card>
      <SectionTitle>Оплата</SectionTitle>
      <p className="-mt-1 mb-4 text-xs text-slate-400 dark:text-slate-500">
        Настройки способа «Перевод» на кассе: QR-код для клиента и/или интеграция с платёжной системой.
      </p>
      <div className="space-y-4">
        <ImageUpload
          value={s.payTransferQr}
          onChange={(url) => set('payTransferQr', url)}
          label="QR-код для перевода (показывается клиенту на кассе)"
          size="h-28 w-28"
        />
        <Field label="Реквизит / номер карты (под QR)">
          <Input
            value={s.payTransferRequisite ?? ''}
            onChange={(e) => set('payTransferRequisite', e.target.value)}
            placeholder="напр. 0000 0000 0000 0000"
          />
        </Field>

        <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            API-интеграция оплаты (необязательно)
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Провайдер">
              <Input
                value={s.payApiProvider ?? ''}
                onChange={(e) => set('payApiProvider', e.target.value)}
                placeholder="напр. Alif / DC Pay"
              />
            </Field>
            <Field label="API URL">
              <Input
                value={s.payApiUrl ?? ''}
                onChange={(e) => set('payApiUrl', e.target.value)}
                placeholder="https://..."
              />
            </Field>
            <Field label="API-ключ">
              <Input
                value={s.payApiKey ?? ''}
                onChange={(e) => set('payApiKey', e.target.value)}
                placeholder="секретный ключ"
              />
            </Field>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Живое подключение к провайдеру включим, когда дашь доступы (URL и ключ).
            Ключ виден только владельцу и не публикуется на кассу.
          </p>
        </div>
      </div>
    </Card>
    </div>
  );
}

function DisplaySection({
  s, set, setMsg,
}: {
  s: Record<string, string>;
  set: (k: string, v: string) => void;
  setMsg: (m: string) => void;
}) {
  const supported = vfdSupported();
  const cfg = readVfdConfig(s);
  const vfdOn = s['display.vfd'] === 'true';
  const proto = VFD_PROTOCOLS.find((p) => p.k === cfg.protocol);

  const prn = readEscposConfig(s);
  const prnOn = s['escpos.enabled'] === 'true';

  // Второй экран по сети (отдельный ПК): ссылка сопряжения + QR.
  const [netUrl, setNetUrl] = useState('');
  const [netQr, setNetQr] = useState('');
  const [netCopied, setNetCopied] = useState(false);

  async function showNetworkLink() {
    try {
      // Токен пары компании (создастся при первом запросе, затем идемпотентно).
      const { token } = await api.get<{ token: string }>('/display/pairing');
      const url = buildPairingUrl(window.location.origin, DEFAULT_COMPANY_ID, token);
      setNetUrl(url);
      try {
        setNetQr(await QRCode.toDataURL(url, { margin: 1, width: 200 }));
      } catch {
        setNetQr(''); // без QR — ссылку всё равно покажем текстом
      }
    } catch (e: any) {
      setMsg('Не удалось получить ссылку: ' + (e?.message ?? e));
    }
  }

  async function copyNetworkLink() {
    try {
      await navigator.clipboard.writeText(netUrl);
      setNetCopied(true);
      setTimeout(() => setNetCopied(false), 1500);
    } catch {
      setMsg('Не удалось скопировать автоматически — выделите ссылку и скопируйте вручную');
    }
  }

  async function connect() {
    try {
      const ok = await requestVfdPort();
      setMsg(ok ? '✓ COM-порт выбран. Нажмите «Тест» для проверки.' : 'Порт не выбран');
    } catch (e: any) {
      setMsg('Не удалось открыть порт: ' + (e?.message ?? e));
    }
  }
  async function test() {
    try {
      await vfdTest(cfg);
      setMsg('Отправил тест на дисплей. Пусто или «кракозябры» — смените протокол или кодировку.');
    } catch (e: any) {
      setMsg('Ошибка вывода: ' + (e?.message ?? e));
    }
  }
  async function connectPrinter() {
    try {
      const ok = await requestEscposPort();
      setMsg(ok ? '✓ Принтер выбран. Нажмите «Тест печати».' : 'Порт не выбран');
    } catch (e: any) {
      setMsg('Не удалось открыть порт: ' + (e?.message ?? e));
    }
  }
  async function testPrinter() {
    try {
      const ok = await escposTest(prn);
      setMsg(ok ? 'Отправил тест на принтер. Если «кракозябры» — смените кодовую страницу.' : 'Принтер не отвечает — проверьте порт/скорость.');
    } catch (e: any) {
      setMsg('Ошибка печати: ' + (e?.message ?? e));
    }
  }

  return (
    <div className="space-y-6">
      {/* Графический монитор */}
      <Card>
        <SectionTitle>Графический экран (второй монитор)</SectionTitle>
        <p className="-mt-1 mb-4 text-xs text-slate-400 dark:text-slate-500">
          Обычный второй монитор/телевизор по HDMI или USB. Windows видит его как
          экран — показывает красивую витрину с корзиной целиком. В Windows:
          «Параметры экрана → Расширить эти экраны», затем перетащите окно дисплея
          на второй монитор и разверните на весь экран (F11).
        </p>
        <Toggle
          label="Показывать графический дисплей покупателя"
          desc="Добавляет на кассе кнопку «Второй экран»"
          checked={s['feature.customerDisplay'] !== 'false'}
          onChange={(v) => set('feature.customerDisplay', String(v))}
        />
        <div className="mt-3">
          <Button variant="ghost" onClick={() => openCustomerDisplay()}>
            <NavIcon name="production" className="h-4 w-4" />Открыть второй экран сейчас
          </Button>
        </div>
      </Card>

      {/* Второй экран по сети (отдельный компьютер) */}
      <Card>
        <SectionTitle>Экран покупателя по сети (другой компьютер)</SectionTitle>
        <p className="-mt-1 mb-4 text-xs text-slate-400 dark:text-slate-500">
          Открой эту ссылку в браузере на компьютере со вторым экраном. Он должен
          быть в той же сети, что и касса (для коробки), или иметь интернет (облако).
        </p>
        <Button variant="ghost" onClick={showNetworkLink}>
          <NavIcon name="production" className="h-4 w-4" />Показать ссылку/QR
        </Button>
        {netUrl && (
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
            {netQr && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={netQr}
                alt="QR второго экрана"
                className="h-40 w-40 shrink-0 rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="mb-2 break-all rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                {netUrl}
              </div>
              <Button variant="ghost" onClick={copyNetworkLink}>
                {netCopied ? '✓ Скопировано' : 'Скопировать'}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Текстовый VFD */}
      <Card>
        <SectionTitle>Текстовый дисплей (VFD / линейный)</SectionTitle>
        <p className="-mt-1 mb-4 text-xs text-slate-400 dark:text-slate-500">
          Встроенный в POS-терминал 2-строчный дисплей (тот, что «показывает только
          цифры»), подключённый по COM-порту. Браузер шлёт на него текст напрямую.
        </p>

        {!supported && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            Этот браузер не поддерживает прямое подключение к COM-порту. Откройте
            кассу в <b>Google Chrome</b> или <b>Microsoft Edge</b> на Windows.
          </div>
        )}

        <Toggle
          label="Использовать текстовый VFD-дисплей"
          desc="Дублировать сумму заказа на линейный дисплей у кассы"
          checked={vfdOn}
          onChange={(v) => set('display.vfd', String(v))}
        />

        {vfdOn && (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Протокол дисплея">
                <Select
                  value={cfg.protocol}
                  onChange={(e) => set('display.vfd.protocol', e.target.value)}
                >
                  {VFD_PROTOCOLS.map((p) => (
                    <option key={p.k} value={p.k}>{p.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Скорость порта (baud)">
                <Select
                  value={String(cfg.baud)}
                  onChange={(e) => set('display.vfd.baud', e.target.value)}
                >
                  {VFD_BAUDS.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Кодировка (кириллица)">
                <Select
                  value={cfg.charset}
                  onChange={(e) => set('display.vfd.charset', e.target.value)}
                >
                  <option value="latin">Латиница (транслит) — безопасно везде</option>
                  <option value="cp866">CP866 — если дисплей знает русский</option>
                </Select>
              </Field>
              <Field label="Ширина строки">
                <Select
                  value={String(cfg.width)}
                  onChange={(e) => set('display.vfd.width', e.target.value)}
                >
                  <option value="20">20 символов</option>
                  <option value="16">16 символов</option>
                </Select>
              </Field>
            </div>

            {proto && (
              <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                {proto.name}: {proto.hint}.
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={connect} disabled={!supported}>
                <NavIcon name="plus" className="h-4 w-4" />Подключить устройство (COM-порт)
              </Button>
              <Button variant="ghost" onClick={test} disabled={!supported}>
                <NavIcon name="play" className="h-4 w-4" />Тест
              </Button>
            </div>

            <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
              <b className="text-slate-600 dark:text-slate-300">Как настроить:</b> 1) включите тумблер;
              2) нажмите «Подключить» и выберите COM-порт дисплея (обычно COM1–COM4);
              3) нажмите «Тест». Если текст не появился или нечитаем — поменяйте
              протокол / скорость / кодировку и снова «Тест». 4) Сохраните изменения.
            </div>
          </>
        )}
      </Card>

      {/* Термопринтер чеков ESC/POS */}
      <Card>
        <SectionTitle>Чековый принтер (термо, ESC/POS)</SectionTitle>
        <p className="-mt-1 mb-4 text-xs text-slate-400 dark:text-slate-500">
          Печать чека прямо на термопринтер 58/80 мм по COM-порту (без окна печати браузера).
        </p>

        {!supported && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            Нужен <b>Chrome</b> или <b>Edge</b> на Windows (прямой доступ к COM-порту).
          </div>
        )}

        <Toggle
          label="Печатать чек на термопринтер"
          desc="Добавляет на кассе кнопку «Печать на термопринтер»"
          checked={prnOn}
          onChange={(v) => set('escpos.enabled', String(v))}
        />

        {prnOn && (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Ширина чека">
                <Select value={String(prn.width)} onChange={(e) => set('escpos.width', e.target.value)}>
                  <option value="32">58 мм (32 симв.)</option>
                  <option value="48">80 мм (48 симв.)</option>
                </Select>
              </Field>
              <Field label="Скорость порта (baud)">
                <Select value={String(prn.baud)} onChange={(e) => set('escpos.baud', e.target.value)}>
                  {ESCPOS_BAUDS.map((b) => <option key={b} value={b}>{b}</option>)}
                </Select>
              </Field>
              <Field label="Кодировка (кириллица)">
                <Select value={prn.charset} onChange={(e) => set('escpos.charset', e.target.value)}>
                  <option value="cp866">CP866 — русский (обычно)</option>
                  <option value="latin">Латиница (транслит)</option>
                </Select>
              </Field>
              <Field label="Кодовая страница принтера">
                <Select value={String(prn.codepage)} onChange={(e) => set('escpos.codepage', e.target.value)}>
                  {ESCPOS_CODEPAGES.map((c) => <option key={c.n} value={c.n}>{c.name}</option>)}
                </Select>
              </Field>
            </div>

            <div className="mt-3 space-y-3">
              <Toggle label="Обрезать чек после печати" checked={prn.cut} onChange={(v) => set('escpos.cut', String(v))} />
              <Toggle label="Печатать автоматически после продажи" checked={prn.autoPrint} onChange={(v) => set('escpos.autoPrint', String(v))} />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={connectPrinter} disabled={!supported}>
                <NavIcon name="plus" className="h-4 w-4" />Подключить принтер (COM-порт)
              </Button>
              <Button variant="ghost" onClick={testPrinter} disabled={!supported}>
                <NavIcon name="print" className="h-4 w-4" />Тест печати
              </Button>
            </div>

            <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
              <b className="text-slate-600 dark:text-slate-300">Настройка:</b> 1) включите тумблер;
              2) «Подключить принтер» → выберите COM-порт; 3) «Тест печати». Если русский
              нечитаем — смените кодовую страницу (17/7/6/73). 4) Сохраните.
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function SyncSection() {
  const [st, setSt] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [nowTs] = useState(() => Date.now());

  function loadStatus() {
    api.get('/sync/status').then(setSt).catch(() => {});
  }
  useEffect(() => {
    loadStatus();
    const id = setInterval(loadStatus, 15000);
    return () => clearInterval(id);
  }, []);

  async function runNow() {
    setBusy(true);
    setMsg('Синхронизирую с облаком…');
    try {
      const r = await api.post('/sync/run', {});
      setMsg(`✓ Готово: отправлено в облако ${r.up}, получено ${r.down}`);
      loadStatus();
    } catch (e: any) {
      setMsg('Ошибка: ' + (e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const configured = !!(st?.cloudConfigured && st?.secretConfigured);
  const isCloud = st?.node === 'C';
  const lastSync = st?.lastSyncAt
    ? new Date(st.lastSyncAt).toLocaleString('ru-RU')
    : 'ещё не было';
  const fresh =
    st?.lastSyncAt && nowTs - new Date(st.lastSyncAt).getTime() < 5 * 60 * 1000;

  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle>Состояние</SectionTitle>
        <dl className="space-y-2.5 text-sm">
          <InfoRow label="Этот узел" value={st?.node ?? '…'} />
          <InfoRow label="Адрес облака" value={st?.cloudApi ?? (isCloud ? 'это облако' : 'не задан')} />
          <InfoRow label="Последняя синхронизация" value={lastSync} />
          <div className="flex items-center justify-between pt-1">
            <dt className="text-slate-500 dark:text-slate-400">Готовность</dt>
            <dd>
              {isCloud ? (
                <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300">
                  облачный узел
                </span>
              ) : configured ? (
                <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                  настроено{fresh ? ' · на связи' : ''}
                </span>
              ) : (
                <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                  не настроено
                </span>
              )}
            </dd>
          </div>
        </dl>

        {!isCloud && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={runNow} disabled={busy || !configured}>
              <NavIcon name="refresh" className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
              Синхронизировать сейчас
            </Button>
            <Button variant="ghost" onClick={loadStatus} disabled={busy}>
              Обновить статус
            </Button>
            {msg && <span className="text-sm text-slate-600 dark:text-slate-300">{msg}</span>}
          </div>
        )}
        {isCloud && (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            Вы открыли облачную панель — облако само принимает данные от точек. Кнопка
            синхронизации нужна на локальных серверах точек.
          </p>
        )}
      </Card>

      {!isCloud && !configured && (
        <Card>
          <SectionTitle>Как включить синхронизацию</SectionTitle>
          <ol className="ml-4 list-decimal space-y-2 text-sm text-slate-600 dark:text-slate-300">
            <li>
              В облаке (Render → сервис <b>printpro-api</b> → <b>Environment</b>) скопируйте
              значение <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">SYNC_SECRET</code>.
            </li>
            <li>
              На этом компьютере в файле <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">printpro-api/.env</code> впишите:
              <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-100">SYNC_SECRET=вставьте_секрет
CLOUD_API=https://printpro-api.onrender.com/api</pre>
            </li>
            <li>Перезапустите локальный сервер (чтобы он прочитал новый <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">.env</code>).</li>
            <li>Вернитесь сюда и нажмите «Синхронизировать сейчас».</li>
          </ol>
          <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
            Для постоянного автообмена в фоне можно запустить <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">npm run sync</code> или
            установщик локального узла (Docker).
          </p>
        </Card>
      )}
    </div>
  );
}

function NotificationsSection({
  s, set, testTelegram, testEmail,
}: {
  s: Record<string, string>;
  set: (k: string, v: string) => void;
  testTelegram: () => void;
  testEmail: () => void;
}) {
  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle>В системе</SectionTitle>
        <div className="space-y-3">
          <Toggle label="Оповещать о низком остатке на складе" checked={s.notifyLowStock === 'true'} onChange={(v) => set('notifyLowStock', String(v))} />
          <Toggle label="Оповещать о долгах клиентов" checked={s.notifyDebts === 'true'} onChange={(v) => set('notifyDebts', String(v))} />
          <Toggle label="Оповещать о готовности заказа" checked={s.notifyOrderReady === 'true'} onChange={(v) => set('notifyOrderReady', String(v))} />
        </div>
      </Card>

      <Card>
        <SectionTitle>Telegram</SectionTitle>
        <p className="-mt-1 mb-4 text-xs text-slate-400 dark:text-slate-500">
          Создайте бота через @BotFather, вставьте токен и chat_id (свой ID можно узнать у @userinfobot).
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Токен бота">
            <Input value={s.telegramBotToken ?? ''} onChange={(e) => set('telegramBotToken', e.target.value)} placeholder="123456:ABC-..." />
          </Field>
          <Field label="Chat ID">
            <Input value={s.telegramChatId ?? ''} onChange={(e) => set('telegramChatId', e.target.value)} placeholder="напр. 123456789" />
          </Field>
        </div>
        <Button variant="ghost" onClick={testTelegram} className="mt-3">Сохранить и проверить</Button>
      </Card>

      <Card>
        <SectionTitle>Email (SMTP)</SectionTitle>
        <p className="-mt-1 mb-4 text-xs text-slate-400 dark:text-slate-500">
          Gmail: включите 2-этапную аутентификацию и создайте «пароль приложения». Хост <b>smtp.gmail.com</b>, порт <b>587</b>.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="SMTP-хост">
            <Input value={s.smtpHost ?? ''} onChange={(e) => set('smtpHost', e.target.value)} placeholder="smtp.gmail.com" />
          </Field>
          <Field label="Порт">
            <Input value={s.smtpPort ?? ''} onChange={(e) => set('smtpPort', e.target.value)} placeholder="587" />
          </Field>
          <Field label="Логин (email)">
            <Input value={s.smtpUser ?? ''} onChange={(e) => set('smtpUser', e.target.value)} placeholder="you@gmail.com" />
          </Field>
          <Field label="Пароль приложения">
            <Input value={s.smtpPass ?? ''} onChange={(e) => set('smtpPass', e.target.value)} type="password" placeholder="16 символов" />
          </Field>
          <Field label="Отправитель (необяз.)">
            <Input value={s.smtpFrom ?? ''} onChange={(e) => set('smtpFrom', e.target.value)} placeholder="PrintPro <you@gmail.com>" />
          </Field>
          <Field label="Кому отправить тест">
            <Input value={s.smtpTestTo ?? ''} onChange={(e) => set('smtpTestTo', e.target.value)} placeholder="по умолчанию — себе" />
          </Field>
        </div>
        <Button variant="ghost" onClick={testEmail} className="mt-3">Сохранить и отправить тест</Button>
      </Card>
    </div>
  );
}

function FeaturesSection({ s, set }: { s: Record<string, string>; set: (k: string, v: string) => void }) {
  return (
    <Card>
      <SectionTitle>Функции системы</SectionTitle>
      <p className="-mt-1 mb-4 text-xs text-slate-400 dark:text-slate-500">
        Скройте разделы и возможности, которыми не пользуетесь — меню станет короче. Изменения применятся после сохранения и обновления страницы.
      </p>
      <div className="space-y-5">
        {FEATURE_GROUPS.map((g) => (
          <div key={g.group}>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {g.group}
            </div>
            <div className="space-y-3">
              {g.items.map((f) => (
                <Toggle key={f.key} label={f.label} desc={f.desc} checked={s[f.key] !== 'false'} onChange={(v) => set(f.key, String(v))} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Toggle({
  label, desc, checked, onChange,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-sm text-slate-600 dark:text-slate-300">{label}</span>
        {desc && <span className="block text-xs text-slate-400 dark:text-slate-500">{desc}</span>}
      </span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}
