import type { MetadataRoute } from 'next';

// PWA-манифест: позволяет «установить» панель как приложение
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PrintPro — управление типографией',
    short_name: 'PrintPro',
    description: 'Касса, заказы, склад, производство и отчёты типографии',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#4f46e5',
    lang: 'ru',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      {
        src: '/icon-maskable.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}
