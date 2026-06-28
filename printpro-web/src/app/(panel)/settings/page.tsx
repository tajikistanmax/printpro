'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { POS_LAYOUTS, DEFAULT_POS_LAYOUT } from '@/lib/pos-layouts';
import { FEATURE_GROUPS, clearFeatureFlagsCache } from '@/lib/feature-flags';
import NavIcon from '@/lib/NavIcons';
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
  | 'orders'
  | 'pos'
  | 'notifications'
  | 'features'
  | 'backup';

// Разделы-карточки на «хабе». Часть открывает форму на этой же странице,
// часть ведёт на уже существующие страницы платформы.
const CATEGORIES: {
  icon: string;
  title: string;
  subtitle: string;
  items: string[];
  section?: Section;
  href?: string;
}[] = [
  {
    icon: 'staff',
    title: 'Профиль компании',
    subtitle: 'Контакты, реквизиты, логотип',
    items: ['Основная информация', 'Контакты', 'Реквизиты', 'Логотип'],
    section: 'profile',
  },
  {
    icon: 'warehouse',
    title: 'Филиалы',
    subtitle: 'Точки обслуживания и склады',
    items: ['Список филиалов', 'Адреса и телефоны', 'Активность'],
    section: 'branches',
  },
  {
    icon: 'clients',
    title: 'Пользователи и роли',
    subtitle: 'Доступ сотрудников',
    items: ['Пользователи', 'Роли и права'],
    href: '/staff',
  },
  {
    icon: 'orders',
    title: 'Настройки заказов',
    subtitle: 'Нумерация и сроки',
    items: ['Префикс номера', 'Срок по умолчанию'],
    section: 'orders',
  },
  {
    icon: 'services',
    title: 'Цены и услуги',
    subtitle: 'Прайс-лист и себестоимость',
    items: ['Услуги и цены', 'Категории'],
    href: '/services',
  },
  {
    icon: 'complaints',
    title: 'Уведомления',
    subtitle: 'Email, Telegram, в системе',
    items: ['Email-уведомления', 'Telegram', 'В системе'],
    section: 'notifications',
  },
  {
    icon: 'pos',
    title: 'Оформление кассы',
    subtitle: 'Вид экрана продажи',
    items: ['Макет страницы «Касса»'],
    section: 'pos',
  },
  {
    icon: 'settings',
    title: 'Функции системы',
    subtitle: 'Скрыть лишние разделы',
    items: ['Включение/отключение разделов'],
    section: 'features',
  },
  {
    icon: 'reports',
    title: 'Резервная копия',
    subtitle: 'Экспорт всех данных',
    items: ['Скачать копию (JSON)'],
    section: 'backup',
  },
  {
    icon: 'audit',
    title: 'Журнал системы',
    subtitle: 'История действий',
    items: ['Все действия сотрудников'],
    href: '/audit',
  },
];

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
  const [section, setSection] = useState<Section>(null);
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

  function loadBranches() {
    api.get(`/branches?companyId=${cid}&all=1`).then(setBranches).catch(() => {});
  }
  useEffect(() => {
    if (section === 'branches') loadBranches();
  }, [section, cid]);

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

  // ====================== ДЕТАЛЬНЫЙ РАЗДЕЛ ======================
  if (section) {
    const titles: Record<string, string> = {
      profile: 'Профиль компании',
      branches: 'Филиалы',
      orders: 'Настройки заказов',
      pos: 'Оформление кассы',
      notifications: 'Уведомления',
      features: 'Функции системы',
      backup: 'Резервная копия',
    };
    const savableSections = ['profile', 'orders', 'pos', 'notifications', 'features'];
    return (
      <div className="max-w-3xl">
        <button
          onClick={() => { setSection(null); setMsg(''); }}
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-indigo-600 dark:text-slate-400"
        >
          ← Все настройки
        </button>
        <PageHeader icon="settings" title={titles[section]} />

        {section === 'profile' && <ProfileSection s={s} set={set} onLogoFile={onLogoFile} />}
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
        {section === 'orders' && <OrdersSection s={s} set={set} />}
        {section === 'pos' && <PosSection s={s} set={set} />}
        {section === 'notifications' && (
          <NotificationsSection s={s} set={set} testTelegram={testTelegram} testEmail={testEmail} />
        )}
        {section === 'features' && <FeaturesSection s={s} set={set} />}
        {section === 'backup' && <BackupSection downloadBackup={downloadBackup} />}

        {savableSections.includes(section) && (
          <div className="mt-6 flex items-center gap-3">
            <Button onClick={save} className="px-6 py-2.5">Сохранить</Button>
            {msg && <span className="text-sm text-slate-600 dark:text-slate-300">{msg}</span>}
          </div>
        )}
      </div>
    );
  }

  // ====================== ХАБ ======================
  return (
    <div>
      <PageHeader
        icon="settings"
        title="Настройки"
        subtitle="Управление системой и конфигурацией приложения"
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Основные настройки — карточки-разделы */}
        <div>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">
            Основные настройки
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {CATEGORIES.map((c) => (
              <CategoryCard
                key={c.title}
                {...c}
                onClick={() =>
                  c.section ? setSection(c.section) : c.href && router.push(c.href)
                }
              />
            ))}
          </div>
        </div>

        {/* Системные настройки — правый столбец */}
        <div className="space-y-6">
          <h2 className="-mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">
            Системные настройки
          </h2>

          <Card>
            <SectionTitle>Общие настройки</SectionTitle>
            <div className="space-y-3">
              <Field label="Язык системы">
                <Select value={s.language ?? 'ru'} onChange={(e) => set('language', e.target.value)}>
                  {LANGUAGES.map((l) => <option key={l.k} value={l.k}>{l.l}</option>)}
                </Select>
              </Field>
              <Field label="Часовой пояс">
                <Input
                  value={s.timezone ?? ''}
                  onChange={(e) => set('timezone', e.target.value)}
                  placeholder="(UTC +05:00) Душанбе"
                />
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
            <div className="mt-4 flex items-center gap-3">
              <Button onClick={save} size="sm">Сохранить</Button>
              {msg && <span className="text-xs text-slate-500">{msg}</span>}
            </div>
          </Card>

          <Card>
            <SectionTitle>Резервное копирование</SectionTitle>
            <p className="-mt-1 mb-3 text-xs text-slate-400 dark:text-slate-500">
              Скачивает все данные компании одним JSON-файлом. Храните копию в надёжном месте.
            </p>
            <Button variant="ghost" onClick={downloadBackup} className="w-full">
              ⬇ Скачать резервную копию
            </Button>
          </Card>
        </div>
      </div>

      {/* Информация о системе */}
      <div className="mt-8">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">
          Информация о системе
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <InfoCard icon="settings" tone="indigo" label="Версия приложения" value={sys?.appVersion ?? '…'} sub="Backend API" />
          <InfoCard icon="warehouse" tone="emerald" label="База данных" value={sys?.dbVersion ?? '…'} sub="Активна" />
          <InfoCard icon="audit" tone="sky" label="Время работы" value={sys ? fmtUptime(sys.uptimeSeconds) : '…'} sub="Стабильная работа" />
          <InfoCard icon="production" tone="violet" label="Платформа" value={sys ? `Node ${sys.nodeVersion}` : '…'} sub={sys?.platform ?? ''} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Карточка раздела на хабе                                           */
/* ------------------------------------------------------------------ */
function CategoryCard({
  icon,
  title,
  subtitle,
  items,
  onClick,
}: {
  icon: string;
  title: string;
  subtitle: string;
  items: string[];
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex h-full flex-col rounded-2xl border border-slate-200/70 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md dark:border-slate-700/60"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
          <NavIcon name={icon} className="h-[22px] w-[22px]" />
        </span>
        <div className="min-w-0">
          <div className="font-semibold text-slate-800 dark:text-slate-100">{title}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</div>
        </div>
      </div>
      <ul className="mt-3 flex-1 space-y-1.5">
        {items.map((i) => (
          <li key={i} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-[9px] text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300">✓</span>
            {i}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-end text-lg text-slate-300 transition group-hover:text-indigo-500">→</div>
    </button>
  );
}

function InfoCard({
  icon, tone, label, value, sub,
}: {
  icon: string;
  tone: 'indigo' | 'emerald' | 'sky' | 'violet';
  label: string;
  value: string;
  sub?: string;
}) {
  const tones: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
    sky: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300',
    violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
  };
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-700/60">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>
        <NavIcon name={icon} className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
        <div className="truncate font-bold text-slate-800 dark:text-slate-100">{value}</div>
        {sub && <div className="truncate text-xs text-slate-400">{sub}</div>}
      </div>
    </div>
  );
}

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
                    <Button size="sm" variant="ghost" onClick={() => openEditB(b)}>✎</Button>
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

function BackupSection({ downloadBackup }: { downloadBackup: () => void }) {
  return (
    <Card>
      <SectionTitle>Резервная копия</SectionTitle>
      <p className="-mt-1 mb-4 text-xs text-slate-400 dark:text-slate-500">
        Скачивает все данные компании (заказы, клиенты, склад, финансы и т.д.) одним JSON-файлом. Храните копию в надёжном месте.
      </p>
      <Button variant="ghost" onClick={downloadBackup} className="font-medium">
        ⬇ Скачать резервную копию (JSON)
      </Button>
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
