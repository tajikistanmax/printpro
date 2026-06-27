'use client';

import { useEffect } from 'react';

// Регистрирует service worker (для установки как приложения / PWA)
export default function PwaRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  return null;
}
