import type { InboxFilters } from '@/modules/documents/service';

type Params = Record<string, string | string[] | undefined>;
const list = (value: string | string[] | undefined) =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/** URL ⇄ inbox filters. Spanish parameter names: they are visible and shareable. */
export function filtersFromParams(params: Params): InboxFilters {
  const statuses = list(params.estado);
  return {
    statuses: statuses.length ? (statuses as InboxFilters['statuses']) : undefined,
    type: (list(params.tipo)[0] || undefined) as InboxFilters['type'],
    clientId: list(params.cliente)[0] || undefined,
    managerId: list(params.gestor)[0] || undefined,
    order: (list(params.orden)[0] || undefined) as InboxFilters['order'],
  };
}

export function filtersToQuery(filters: InboxFilters): string {
  const query = new URLSearchParams();
  filters.statuses?.forEach((status) => query.append('estado', status));
  if (filters.type) query.set('tipo', filters.type);
  if (filters.clientId) query.set('cliente', filters.clientId);
  if (filters.managerId) query.set('gestor', filters.managerId);
  if (filters.order) query.set('orden', filters.order);
  return query.toString();
}
