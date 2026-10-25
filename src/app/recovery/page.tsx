import { AuthScreen } from '@/components/auth-screen';
export const dynamic = 'force-dynamic';
export default function Recovery() {
  return (
    <AuthScreen mode="recovery" smtpEnabled={!!process.env.SMTP_URL && !!process.env.MAIL_FROM} />
  );
}
