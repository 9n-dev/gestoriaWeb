import { AppError } from '@/lib/errors';
import {
  assertCan,
  can,
  requireTenantId,
  scopeFor,
  type SessionUser,
} from '@/modules/auth/permissions';
import {
  clientsRepository,
  type ClientFacingClient,
  type ClientFilter,
  type StaffClient,
} from './repository';

const notFound = (id: string) =>
  new AppError('NOT_FOUND', 'No encontramos ese cliente.', `client ${id} not visible`);

function filterFor(user: SessionUser): ClientFilter {
  switch (scopeFor(user, 'client.read')) {
    case 'own':
      return { ids: user.clientIds };
    case 'assigned':
      return { assignedManagerId: user.id };
    case 'all':
      return {};
    default:
      throw new AppError('FORBIDDEN', 'No tienes permiso para realizar esta acción.');
  }
}

/** Clients the user may see: own (client user), assigned (manager) or all (supervisor, admin). */
export async function listClientsFor(
  user: SessionUser,
): Promise<Array<StaffClient | ClientFacingClient>> {
  assertCan(user, 'client.read');
  const repository = clientsRepository(requireTenantId(user));
  return can(user, 'client.readInternalNotes')
    ? repository.listForStaff(filterFor(user))
    : repository.listForClientUser(filterFor(user));
}

export async function getClientFor(
  user: SessionUser,
  id: string,
): Promise<StaffClient | ClientFacingClient> {
  const client = await clientsRepository(requireTenantId(user)).findForStaff(id);
  // Not found and not allowed are indistinguishable from outside.
  if (!client) throw notFound(id);
  const resource = {
    tenantId: client.tenantId,
    clientId: client.id,
    assignedManagerId: client.assignedManagerId,
  };
  if (!can(user, 'client.read', resource)) throw notFound(id);
  if (can(user, 'client.readInternalNotes', resource)) return client;

  const {
    internalNotes: _notes,
    tags: _tags,
    assignedManagerId: _manager,
    taxProfileId: _profile,
    lastActivityAt: _activity,
    createdAt: _created,
    ...clientFacing
  } = client;
  return clientFacing;
}
