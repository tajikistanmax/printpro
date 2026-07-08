'use client';

import { useEffect } from 'react';
import { ensureCompanyIdResolved } from './config';

// Разрешает companyId этой установки в рантайме (через /api/system/company-id).
// В облаке id совпадает с fallback — ничего не меняется. В коробке у каждого
// клиента свой companyId — компонент его подхватит и закэширует (один раз
// перезагрузив страницу). См. ensureCompanyIdResolved в lib/config.ts.
export default function CompanyIdResolver() {
  useEffect(() => {
    void ensureCompanyIdResolved();
  }, []);
  return null;
}
