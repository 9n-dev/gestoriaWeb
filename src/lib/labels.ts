import type {
  ClientStatus,
  ObligationStatus,
  Period,
  Role,
  TenantStatus,
  UserStatus,
} from '@prisma/client';

/** Spanish labels for enums shown in the UI. */
export const CLIENT_STATUS: Record<ClientStatus, string> = {
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
  DELINQUENT: 'Moroso',
};
export const OBLIGATION_STATUS: Record<ObligationStatus, string> = {
  PENDING_DOCS: 'Pendiente de documentación',
  IN_PROGRESS: 'En curso',
  FILED: 'Presentado',
};
export const ROLE: Record<Role, string> = {
  CLIENT_USER: 'Cliente',
  MANAGER: 'Gestor',
  SUPERVISOR: 'Supervisor',
  TENANT_ADMIN: 'Administrador',
  SUPERADMIN: 'Superadministrador',
};
export const USER_STATUS: Record<UserStatus, string> = {
  INVITED: 'Invitación pendiente',
  ACTIVE: 'Activo',
  DISABLED: 'Desactivado',
};
export const TENANT_STATUS: Record<TenantStatus, string> = {
  PENDING_VERIFICATION: 'Pendiente de verificar',
  ACTIVE: 'Activa',
  SUSPENDED: 'Suspendida',
  CANCELLED: 'De baja',
};

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** "3T 2026", "septiembre 2026", "2026" */
export function periodLabel(period: Pick<Period, 'year' | 'type' | 'ordinal'>): string {
  if (period.type === 'QUARTER') return `${period.ordinal}T ${period.year}`;
  if (period.type === 'MONTH') return `${MONTHS[period.ordinal - 1]} ${period.year}`;
  return String(period.year);
}
