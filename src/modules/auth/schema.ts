import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Introduce un correo electrónico válido.'));

export const passwordLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Introduce tu contraseña.').max(200),
});

export const magicLinkRequestSchema = z.object({ email: emailSchema });

export const magicLinkTokenSchema = z.object({ token: z.string().min(20).max(200) });
