'use server';
import { revalidatePath } from 'next/cache';
import { savePreferences } from '@/lib/preferences';
import { ApiError } from '@/lib/security';
export async function updatePreferencesAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    // Authentication, ownership, rate limiting and validation are enforced again here.
    await savePreferences(input);
    revalidatePath('/profile');
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof ApiError
          ? error.message
          : error instanceof Error && error.name === 'ZodError'
            ? 'invalidInput'
            : 'serverError',
    };
  }
}
