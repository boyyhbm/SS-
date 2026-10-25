import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import './globals.css';
import './visual-system.css';
import { InputSystem } from '@/components/input-system';
export const metadata: Metadata = {
  title: { default: 'NEXUS — Your space to play', template: '%s · NEXUS' },
  description:
    'Авторская игровая консоль в браузере. Персональная библиотека и оригинальные игровые миры.',
  icons: { icon: '/icon.svg' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#090b12' };
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return (
    <html lang="ru" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        {children}
        <InputSystem />
      </body>
    </html>
  );
}
