import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import PwaRegister from '@/lib/PwaRegister';
import CompanyIdResolver from '@/lib/CompanyIdResolver';

export const metadata: Metadata = {
  title: 'PrintPro — система управления типографией',
  description: 'Склад, касса, услуги, заказы и задачи для типографии',
  appleWebApp: { capable: true, title: 'PrintPro', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#4f46e5',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="min-h-full bg-slate-100 text-slate-800">
        <AuthProvider>{children}</AuthProvider>
        <PwaRegister />
        <CompanyIdResolver />
      </body>
    </html>
  );
}
