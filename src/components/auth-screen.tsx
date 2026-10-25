'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Fingerprint,
  Globe2,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import { motion } from 'motion/react';
import { inputText } from '@/input/i18n';
import { Gamepad2 } from 'lucide-react';
import { Brand } from './console';
import { useUI } from '@/lib/ui-store';
import { dictionary, translate, type TextKey } from '@/lib/i18n';
export function AuthScreen({
  mode,
  next = '/',
  smtpEnabled = false,
  token,
}: {
  mode: 'login' | 'register' | 'recovery' | 'reset';
  next?: string;
  smtpEnabled?: boolean;
  token?: string;
}) {
  const ui = useUI();
  const t = (key: TextKey) => dictionary[ui.language][key];
  const router = useRouter();
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(''),
    [show, setShow] = useState(false);
  const titles = {
    login: 'loginTitle',
    register: 'registerTitle',
    recovery: 'recoveryTitle',
    reset: 'resetTitle',
  } as const;
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (mode === 'login') {
        const result = await signIn('credentials', {
          email: values.email,
          password: values.password,
          remember: values.remember ? 'true' : 'false',
          redirect: false,
        });
        if (result?.error) throw new Error('invalidCredentials');
        router.push(safeNext);
        router.refresh();
      } else {
        const endpoint =
          mode === 'register' ? '/api/register' : mode === 'reset' ? '/api/reset' : '/api/recovery';
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...values, ...(mode === 'reset' ? { token } : {}) }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
        if (mode === 'register') {
          const auth = await signIn('credentials', {
            email: values.email,
            password: values.password,
            remember: 'false',
            redirect: false,
          });
          if (auth?.error) {
            router.push('/login');
            return;
          }
          router.push(safeNext);
          router.refresh();
        } else setSuccess(t(mode === 'reset' ? 'passwordReset' : 'recoverySent'));
      }
    } catch (e) {
      setError(translate(ui.language, e instanceof Error ? e.message : 'serverError'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <div className="auth-art">
        <img src="/art/midnight-keyart.webp" alt="" />
        <div className="auth-art-shade" />
        <div className="auth-brand">
          <Brand />
        </div>
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="auth-story"
        >
          <span className="eyebrow">
            <span className="live-dot" />
            {t('authTag')}
          </span>
          <h1>{t(titles[mode])}</h1>
          <p>{t('authDescription')}</p>
          <div className="auth-story-bottom">
            <span>01 — NEXUS ORIGINALS</span>
            <div>
              <i />
              <i />
              <i />
            </div>
          </div>
        </motion.div>
        <span className="auth-art-credit">ORIGINAL CONCEPT / MIDNIGHT OUTLAWS</span>
      </div>
      <section className="auth-form-side">
        <div className="auth-top">
          <Link
            href="/controllers"
            className="icon-button"
            data-controller-settings
            aria-label={inputText(ui.language, 'controllerSettings')}
          >
            <Gamepad2 size={20} />
          </Link>
          <Link href="/" className="back-link">
            <ArrowLeft size={16} />
            {t('home')}
          </Link>
          <button
            className="language-button"
            onClick={() => ui.setPreferences({ language: ui.language === 'ru' ? 'en' : 'ru' })}
          >
            <Globe2 size={16} />
            {ui.language === 'ru' ? 'EN' : 'RU'}
          </button>
        </div>
        <motion.div
          className="auth-form-wrap"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <span className="auth-icon">
            <Fingerprint size={27} />
          </span>
          <span className="eyebrow">NEXUS ID</span>
          <h2>
            {t(
              mode === 'register'
                ? 'signUp'
                : mode === 'login'
                  ? 'signIn'
                  : mode === 'reset'
                    ? 'resetTitle'
                    : 'forgotPassword',
            )}
          </h2>
          {mode === 'recovery' && (
            <p className="auth-intro">{t(smtpEnabled ? 'recoveryBody' : 'recoveryUnavailable')}</p>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          {success && (
            <div className="form-success" role="status">
              <Check size={18} />
              {success}
            </div>
          )}
          {!success && (
            <form method="post" onSubmit={submit}>
              {mode === 'register' && (
                <label className="field-label">
                  {t('username')}
                  <input
                    disabled={!interactive || busy}
                    name="username"
                    autoComplete="username"
                    required
                    minLength={3}
                    maxLength={24}
                    pattern="[a-zA-Z0-9_]+"
                    placeholder="player_one"
                  />
                  <small>{t('usernameHint')}</small>
                </label>
              )}
              {mode !== 'reset' && (
                <label className="field-label">
                  {t('email')}
                  <input
                    disabled={!interactive || busy}
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    placeholder="player@example.com"
                  />
                </label>
              )}
              {mode !== 'recovery' && (
                <label className="field-label">
                  {t('password')}
                  <div className="password-input">
                    <input
                      disabled={!interactive || busy}
                      type={show ? 'text' : 'password'}
                      name="password"
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      required
                      minLength={mode === 'login' ? 1 : 10}
                      maxLength={128}
                      placeholder="••••••••••••"
                    />
                    <button
                      type="button"
                      aria-label={t('password')}
                      aria-pressed={show}
                      onClick={() => setShow(!show)}
                    >
                      {show ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {mode !== 'login' && <small>{t('passwordHint')}</small>}
                </label>
              )}
              {mode === 'register' && (
                <label className="field-label">
                  {t('confirmPassword')}
                  <input
                    disabled={!interactive || busy}
                    type={show ? 'text' : 'password'}
                    name="confirmPassword"
                    autoComplete="new-password"
                    required
                    minLength={10}
                    maxLength={128}
                    placeholder="••••••••••••"
                  />
                </label>
              )}
              {mode === 'login' && (
                <div className="auth-options">
                  <label>
                    <input disabled={!interactive || busy} name="remember" type="checkbox" />
                    {t('remember')}
                  </label>
                  <Link href="/recovery">{t('forgotPassword')}</Link>
                </div>
              )}
              <button
                className="button primary auth-submit"
                disabled={
                  !interactive ||
                  busy ||
                  (mode === 'recovery' && !smtpEnabled) ||
                  (mode === 'reset' && !token)
                }
              >
                {busy ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <>
                    {t(
                      mode === 'register'
                        ? 'registerButton'
                        : mode === 'login'
                          ? 'loginButton'
                          : mode === 'reset'
                            ? 'resetPassword'
                            : 'sendLink',
                    )}
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>
          )}
          <div className="auth-switch">
            {mode === 'register' ? t('haveAccount') : mode === 'login' ? t('noAccount') : ''}{' '}
            <Link
              href={
                mode === 'register'
                  ? `/login?next=${encodeURIComponent(safeNext)}`
                  : mode === 'login'
                    ? `/register?next=${encodeURIComponent(safeNext)}`
                    : '/login'
              }
            >
              {t(mode === 'login' ? 'signUp' : 'signIn')}
              <ArrowRight size={14} />
            </Link>
          </div>
          <p className="secure-note">
            <ShieldCheck size={14} />
            {t('secureSession')}
          </p>
        </motion.div>
        <footer className="auth-footer">
          <span>NEXUS CONSOLE</span>
          <span>© {new Date().getFullYear()} · FIRST EDITION</span>
        </footer>
      </section>
    </div>
  );
}
