'use client';
import { useUI } from '@/lib/ui-store';
import { dictionary } from '@/lib/i18n';
export default function ErrorPage({ reset }: { reset: () => void }) {
  const t = dictionary[useUI((s) => s.language)];
  return (
    <div className="system-message">
      <span className="eyebrow">NEXUS / CONNECTION INTERRUPTED</span>
      <h1>{t.serverError}</h1>
      <button className="button primary" onClick={reset}>
        {t.confirm}
      </button>
    </div>
  );
}
