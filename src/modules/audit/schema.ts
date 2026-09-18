import { z } from 'zod';

export const auditFiltersSchema = z.object({
  entity: z.string().optional(),
  entityId: z.string().optional(),
  actorId: z.string().optional(),
  take: z.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export type AuditFilters = z.input<typeof auditFiltersSchema>;
