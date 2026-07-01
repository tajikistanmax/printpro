'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import {
  PageHeader,
  StatGrid,
  StatCard,
  Card,
  SectionTitle,
  Field,
  Input,
  Select,
  Button,
  Badge,
  EmptyState,
} from '@/components/ui';
import NavIcon from '@/lib/NavIcons';
import FeatureGate from '@/lib/FeatureGate';

function PromocodesInner() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const manage = can('orders.manage');

  const [list, setList] = useState<any[]>([]);
  const [code, setCode] = useState('');
  const [type, setType] = useState('PERCENT');
  const [value, setValue] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [msg, setMsg] = useState('');

  function load() {
    api.get(`/promocodes?companyId=${cid}`).then(setList).catch(() => {});
  }
  useEffect(load, [cid]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await api.post('/promocodes', {
        companyId: cid,
        code,
        discountType: type,
        value: Number(value),
        maxUses: maxUses ? Number(maxUses) : null,
        validUntil: validUntil || undefined,
      });
      setCode('');
      setValue('');
      setMaxUses('');
      setValidUntil('');
      setMsg('✓ Промокод создан');
      load();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function remove(id: string) {
    if (!confirm('Удалить промокод?')) return;
    await api.del(`/promocodes/${id}`);
    load();
  }

  const activeCount = list.filter((p) => {
    const expired = p.validUntil && new Date(p.validUntil) < new Date();
    const used = p.maxUses != null && p.usedCount >= p.maxUses;
    return p.isActive && !expired && !used;
  }).length;

  return (
    <div className="max-w-3xl">
      <PageHeader
        icon="promo"
        title="Промокоды"
        subtitle="Скидочные коды для кассы: процент или фиксированная сумма, с лимитом использований и сроком."
      />

      <StatGrid cols={2}>
        <StatCard icon="promo" tone="indigo" label="Всего промокодов" value={list.length} highlight />
        <StatCard icon="reports" tone="emerald" label="Активных" value={activeCount} />
      </StatGrid>

      {manage && (
        <Card className="mb-6">
          <SectionTitle>Новый промокод</SectionTitle>
          <form onSubmit={create} className="flex flex-wrap items-end gap-3">
            <Field label="Код">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                placeholder="SALE10"
                className="w-32 uppercase"
              />
            </Field>
            <Field label="Тип">
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="PERCENT">Процент %</option>
                <option value="FIXED">Сумма c.</option>
              </Select>
            </Field>
            <Field label="Значение" className="w-24">
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                type="number"
                min="0"
                required
              />
            </Field>
            <Field label="Лимит" className="w-28">
              <Input
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                type="number"
                min="1"
                placeholder="∞"
              />
            </Field>
            <Field label="До">
              <Input
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                type="date"
              />
            </Field>
            <Button type="submit">Создать</Button>
            {msg && <span className="text-sm text-slate-600 dark:text-slate-300">{msg}</span>}
          </form>
        </Card>
      )}

      {list.length === 0 ? (
        <EmptyState icon="promo" title="Промокодов пока нет." />
      ) : (
        <div className="space-y-2">
          {list.map((p) => {
            const expired = p.validUntil && new Date(p.validUntil) < new Date();
            const used = p.maxUses != null && p.usedCount >= p.maxUses;
            return (
              <Card
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 !p-4"
              >
                <div>
                  <span className="font-mono text-lg font-bold text-slate-800 dark:text-slate-100">
                    {p.code}
                  </span>
                  <span className="ml-3 text-sm text-slate-500">
                    {p.discountType === 'PERCENT'
                      ? `−${Number(p.value)}%`
                      : `−${Number(p.value)} c.`}
                    {' · использован '}
                    {p.usedCount}
                    {p.maxUses != null ? ` из ${p.maxUses}` : ''}
                    {p.validUntil
                      ? ` · до ${new Date(p.validUntil).toLocaleDateString('ru-RU')}`
                      : ''}
                  </span>
                  {(expired || used || !p.isActive) && (
                    <Badge tone="slate" className="ml-2">
                      {expired ? 'истёк' : used ? 'исчерпан' : 'выключен'}
                    </Badge>
                  )}
                </div>
                {manage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Удалить"
                    className="text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                    onClick={() => remove(p.id)}
                  >
                    <NavIcon name="close" className="h-4 w-4" />
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function PromocodesPage() {
  return (
    <FeatureGate flag="feature.promocodes">
      <PromocodesInner />
    </FeatureGate>
  );
}
