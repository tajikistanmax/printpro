'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from './api';
import { DEFAULT_COMPANY_ID } from './config';

const TYPE_LABEL: Record<string, string> = {
  INDIVIDUAL: 'физлицо',
  COMPANY: 'компания',
  REGULAR: 'постоянный',
  VIP: 'VIP',
};

export default function GlobalSearch() {
  const cid = DEFAULT_COMPANY_ID;
  const router = useRouter();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      return;
    }
    const t = setTimeout(() => {
      api
        .get(`/search?companyId=${cid}&q=${encodeURIComponent(q.trim())}`)
        .then((r) => {
          setRes(r);
          setOpen(true);
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q, cid]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function go(href: string) {
    setOpen(false);
    setQ('');
    router.push(href);
  }

  const visibleRes = q.trim().length >= 2 ? res : null;
  const empty =
    visibleRes &&
    !res.orders?.length &&
    !res.clients?.length &&
    !res.services?.length &&
    !res.products?.length;

  return (
    <div ref={boxRef} className="relative hidden sm:block">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => visibleRes && setOpen(true)}
        placeholder="Поиск… (заказ, клиент, услуга)"
        className="w-48 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm transition-all focus:w-64 focus:bg-white focus:outline-none md:w-60 dark:border-slate-700 dark:bg-slate-800"
      />
      {open && visibleRes && (
        <div className="absolute right-0 z-50 mt-2 max-h-[70vh] w-80 overflow-auto rounded-2xl border border-slate-100 bg-white p-2 shadow-xl">
          {empty && (
            <div className="px-3 py-4 text-center text-sm text-slate-400">
              Ничего не найдено
            </div>
          )}
          <Group title="Заказы" show={res.orders?.length}>
            {res.orders?.map((o: any) => (
              <Item
                key={o.id}
                onClick={() => go(`/order-card?id=${o.id}`)}
                main={`№${o.orderNumber}`}
                sub={o.client?.fullName ?? o.client?.phone ?? 'без клиента'}
              />
            ))}
          </Group>
          <Group title="Клиенты" show={res.clients?.length}>
            {res.clients?.map((c: any) => (
              <Item
                key={c.id}
                onClick={() => go('/clients')}
                main={c.fullName ?? 'Без имени'}
                sub={`${c.phone} · ${TYPE_LABEL[c.type] ?? ''}`}
              />
            ))}
          </Group>
          <Group title="Услуги" show={res.services?.length}>
            {res.services?.map((s: any) => (
              <Item
                key={s.id}
                onClick={() => go('/services')}
                main={s.name}
                sub={`${s.basePrice} c.`}
              />
            ))}
          </Group>
          <Group title="Товары" show={res.products?.length}>
            {res.products?.map((p: any) => (
              <Item
                key={p.id}
                onClick={() => go('/warehouse')}
                main={p.name}
                sub={`${p.salePrice} c.`}
              />
            ))}
          </Group>
        </div>
      )}
    </div>
  );
}

function Group({
  title,
  show,
  children,
}: {
  title: string;
  show?: number;
  children: React.ReactNode;
}) {
  if (!show) return null;
  return (
    <div className="mb-1">
      <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </div>
      {children}
    </div>
  );
}

function Item({
  onClick,
  main,
  sub,
}: {
  onClick: () => void;
  main: string;
  sub: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-indigo-50"
    >
      <span className="truncate font-medium text-slate-700">{main}</span>
      <span className="shrink-0 truncate text-xs text-slate-400">{sub}</span>
    </button>
  );
}
