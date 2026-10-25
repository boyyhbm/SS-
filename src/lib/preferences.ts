import { db } from './db';
import { requireUser } from './auth';
import { settingsSchema } from './validation';
import { rateLimit } from './security';
export async function savePreferences(input: unknown) {
  const user = await requireUser();
  await rateLimit(`preferences:${user.id}`, 60, 60);
  const { avatar, ...settings } = settingsSchema.parse(input);
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { avatar } }),
    db.userSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...settings },
      update: settings,
    }),
  ]);
}
