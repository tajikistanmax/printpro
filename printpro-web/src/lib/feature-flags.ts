'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';

/**
 * Тумблеры функций (feature flags). Хранятся как обычные настройки с ключом
 * `feature.*` и публикуются через /settings/ui, поэтому меню и страницы могут
 * читать их без права settings.manage.
 *
 * Семантика: ВКЛючено по умолчанию. Раздел скрывается только если владелец
 * явно выключил тумблер (значение 'false').
 */

export type FeatureFlag = { key: string; label: string; desc?: string };

export const FEATURE_GROUPS: { group: string; items: FeatureFlag[] }[] = [
  {
    group: 'Разделы меню',
    items: [
      { key: 'feature.quotes', label: 'Коммерческие предложения (КП)' },
      { key: 'feature.promocodes', label: 'Промокоды' },
      { key: 'feature.tasks', label: 'Задачи' },
      { key: 'feature.complaints', label: 'Рекламации' },
      { key: 'feature.design', label: 'Дизайн-макеты' },
      { key: 'feature.equipment', label: 'Оборудование' },
      { key: 'feature.purchasing', label: 'Закупки' },
      { key: 'feature.payroll', label: 'Зарплата' },
    ],
  },
  {
    group: 'Касса',
    items: [
      {
        key: 'feature.customerDisplay',
        label: 'Дисплей покупателя',
        desc: 'Кнопка «Второй экран» на кассе для показа корзины клиенту',
      },
    ],
  },
];

/** Какой тумблер скрывает пункт меню (по href). */
export const NAV_FLAG_BY_HREF: Record<string, string> = {
  '/quotes': 'feature.quotes',
  '/promocodes': 'feature.promocodes',
  '/tasks': 'feature.tasks',
  '/complaints': 'feature.complaints',
  '/design': 'feature.design',
  '/equipment': 'feature.equipment',
  '/purchasing': 'feature.purchasing',
  '/payroll': 'feature.payroll',
};

let cache: Record<string, string> | null = null;
let inflight: Promise<Record<string, string>> | null = null;

function loadFlags(): Promise<Record<string, string>> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api
      .get(`/settings/ui?companyId=${DEFAULT_COMPANY_ID}`)
      .then((ui: Record<string, string>) => {
        cache = ui ?? {};
        return cache;
      })
      .catch(() => {
        cache = {};
        return cache;
      })
      .finally(() => {
        inflight = null;
      }) as Promise<Record<string, string>>;
  }
  return inflight;
}

/** Сбросить кэш — вызывается после сохранения настроек. */
export function clearFeatureFlagsCache() {
  cache = null;
  inflight = null;
}

export function isFlagEnabled(
  flags: Record<string, string>,
  key: string,
): boolean {
  return flags[key] !== 'false';
}

export function useFeatureFlags() {
  const [flags, setFlags] = useState<Record<string, string>>(cache ?? {});
  const [loaded, setLoaded] = useState(cache != null);

  useEffect(() => {
    let alive = true;
    loadFlags().then((f) => {
      if (alive) {
        setFlags(f);
        setLoaded(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  return {
    flags,
    loaded,
    isEnabled: (key: string) => isFlagEnabled(flags, key),
  };
}
