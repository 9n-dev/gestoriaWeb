import { z } from 'zod';
import { emailSchema } from '@/modules/auth/schema';
import { taxIdSchema } from '@/modules/clients/schema';

// Hosts the platform needs for itself, now or later.
const RESERVED_SLUGS = new Set([
  'www',
  'app',
  'api',
  'admin',
  'docs',
  'mail',
  'email',
  'smtp',
  'static',
  'assets',
  'cdn',
  'status',
  'plataforma',
  'soporte',
  'support',
  'ayuda',
  'help',
  'registro',
  'acceso',
  'login',
  'demo',
  'test',
]);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/,
    'Usa entre 3 y 40 letras minúsculas, números o guiones, sin empezar ni acabar en guion.',
  )
  .refine((slug) => !RESERVED_SLUGS.has(slug), 'Esa dirección está reservada. Elige otra.');

export const tenantRegistrationSchema = z.object({
  name: z.string().trim().min(3, 'Indica el nombre de la gestoría.').max(120),
  slug: slugSchema,
  adminName: z.string().trim().min(2, 'Indica tu nombre.').max(120),
  adminEmail: emailSchema,
});
export type TenantRegistration = z.input<typeof tenantRegistrationSchema>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullish()
    .transform((v) => v ?? null);

export const tenantProfileSchema = z.object({
  name: z.string().trim().min(3, 'Indica el nombre de la gestoría.').max(120),
  legalName: optionalText(200),
  taxId: z
    .union([z.literal('').transform(() => null), taxIdSchema])
    .nullish()
    .transform((v) => v ?? null),
  addressLine: optionalText(200),
  postalCode: optionalText(10),
  city: optionalText(100),
  province: optionalText(100),
  contactEmail: z
    .union([z.literal('').transform(() => null), emailSchema])
    .nullish()
    .transform((v) => v ?? null),
  phone: optionalText(30),
});
export type TenantProfileInput = z.input<typeof tenantProfileSchema>;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color no válido.');

/** Shape of `Tenant.branding`. Contrast validation, favicon and sender name arrive in phase 6. */
export const brandingSchema = z.object({
  primaryColor: hexColor.optional(),
  accentColor: hexColor.optional(),
  logoFileId: z.string().optional(),
});
export type Branding = z.infer<typeof brandingSchema>;

export const parseBranding = (value: unknown): Branding => brandingSchema.catch({}).parse(value);
