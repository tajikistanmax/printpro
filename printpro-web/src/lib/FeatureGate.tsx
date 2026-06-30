'use client';

import { ReactNode, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useFeatureFlags } from './feature-flags';

/**
 * Страж раздела. Если соответствующий тумблер (feature.*) выключен,
 * страница недоступна даже по прямой ссылке — пользователя уводит на Главную.
 *
 * Использование: оберните содержимое страницы в <FeatureGate flag="feature.quotes">…</FeatureGate>
 */
export default function FeatureGate({
  flag,
  children,
}: {
  flag: string;
  children: ReactNode;
}) {
  const { isEnabled, loaded } = useFeatureFlags();
  const router = useRouter();
  const allowed = isEnabled(flag);

  useEffect(() => {
    if (loaded && !allowed) router.replace('/dashboard');
  }, [loaded, allowed, router]);

  // Пока флаги грузятся или раздел выключен — ничего не показываем
  if (!loaded || !allowed) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-400">
        {loaded ? 'Раздел отключён…' : 'Загрузка…'}
      </div>
    );
  }

  return <>{children}</>;
}
