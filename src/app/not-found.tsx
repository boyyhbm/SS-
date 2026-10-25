'use client';
import Link from 'next/link';
import { dictionary } from '@/lib/i18n';
import { useUI } from '@/lib/ui-store';
export default function NotFound() {
  const t = dictionary[useUI((s) => s.language)];
  return (
    <div className="system-message">
      <span className="eyebrow">NEXUS / 404</span>
      <h1>{t.noWorld}</h1>
      <Link className="button primary" href="/">
        {t.home} →
      </Link>
    </div>
  );
}
