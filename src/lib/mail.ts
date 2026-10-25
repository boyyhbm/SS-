import { SMTPClient } from 'emailjs';
// Only implicit TLS is accepted. Never downgrade credential transport to plaintext SMTP.
export async function sendRecoveryEmail(to: string, resetUrl: string) {
  const url = new URL(process.env.SMTP_URL!);
  if (url.protocol !== 'smtps:' || !url.hostname || !process.env.MAIL_FROM) {
    throw new Error('Secure SMTP configuration required');
  }
  const client = new SMTPClient({
    host: url.hostname,
    port: Number(url.port || 465),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: true, servername: url.hostname },
    timeout: 15000,
  });
  try {
    await client.sendAsync({
      from: process.env.MAIL_FROM,
      to,
      subject: 'NEXUS — Password reset / Сброс пароля',
      text: `NEXUS\n${resetUrl}\nСсылка действительна 30 минут. / This link expires in 30 minutes.\nЕсли вы не запрашивали сброс, проигнорируйте письмо. / Ignore if not requested.`,
    });
  } finally {
    client.smtp.close();
  }
}
