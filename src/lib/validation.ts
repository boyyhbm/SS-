import { z } from 'zod';
export const passwordSchema = z.string().min(10).max(128);
export const registrationSchema = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(24)
      .regex(/^[a-z0-9_]+$/),
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'passwordMismatch',
  });
export const loginSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(128),
  remember: z.string().optional(),
});
export const librarySchema = z.object({
  gameId: z.string().min(1).max(64),
  action: z.enum(['add', 'remove', 'favorite']),
});
export const settingsSchema = z.object({
  language: z.enum(['ru', 'en']),
  uiSoundEnabled: z.boolean(),
  reducedMotion: z.boolean(),
  backgroundEffectsEnabled: z.boolean(),
  profilePrivate: z.boolean(),
  avatar: z.enum(['violet', 'cyan', 'coral', 'mint']),
});
export const assetSchema = z
  .string()
  .regex(/^\/(art\/[a-zA-Z0-9_-]+\.(svg|png|jpg|webp)|api\/media\/[a-f0-9-]+\.webp)$/);
export const gameSchema = z
  .object({
    id: z.string().max(64).optional(),
    slug: z
      .string()
      .min(3)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().trim().min(2).max(80),
    description: z.string().trim().min(10).max(4000),
    descriptionEn: z.string().trim().min(10).max(4000),
    genre: z.enum(['racing', 'shooter', 'adventure', 'exploration', 'puzzle']),
    cover: assetSchema,
    banner: assetSchema,
    status: z.enum(['DRAFT', 'COMING_SOON', 'AVAILABLE']),
    runtimeKey: z.enum(['midnight-outlaws', 'fold-zero', '']).nullable(),
    sortOrder: z.number().int().min(0).max(10000),
    published: z.boolean(),
  })
  .refine(
    (v) =>
      v.status !== 'AVAILABLE' || ['midnight-outlaws', 'fold-zero'].includes(v.runtimeKey ?? ''),
    {
      message: 'runtimeRequired',
    },
  );
