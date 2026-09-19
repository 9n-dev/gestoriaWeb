import { createHash } from 'node:crypto';
import { env } from '@/env';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';
import type { RequestMeta } from '@/lib/request';
import { recordAudit } from '@/modules/audit/service';
import type { SessionUser } from '@/modules/auth/permissions';

/** Bump when the wording changes: everyone is asked to accept the new text. */
export const DPA_VERSION = '2026-09';

type Party = { name: string; taxId: string | null; address: string | null };

const party = (p: Party) =>
  [p.name, p.taxId && `NIF ${p.taxId}`, p.address].filter(Boolean).join(', ');

const CLAUSES = (controller: string, processor: string) => [
  `1. Objeto. ${processor} (el encargado) trata datos personales por cuenta de ${controller} (el responsable) con el único fin de prestar el servicio contratado, conforme al artículo 28 del Reglamento (UE) 2016/679.`,
  '2. Datos tratados. Datos identificativos, de contacto, económicos, fiscales y laborales contenidos en la documentación que el responsable aporta o que se genera durante el servicio.',
  '3. Instrucciones. El encargado trata los datos solo siguiendo instrucciones documentadas del responsable y no los usa para fines propios.',
  '4. Confidencialidad. Las personas autorizadas a tratar los datos están sujetas a un deber de confidencialidad.',
  '5. Seguridad. El encargado aplica medidas técnicas y organizativas apropiadas: cifrado en tránsito y en reposo, control de acceso por roles, registro de accesos y copias de seguridad.',
  '6. Subencargados. El responsable autoriza la contratación de los proveedores de infraestructura necesarios (alojamiento, almacenamiento, correo electrónico y extracción automática de datos), que quedan sujetos a las mismas obligaciones.',
  '7. Derechos de las personas. El encargado asiste al responsable para atender las solicitudes de acceso, rectificación, supresión, oposición, limitación y portabilidad.',
  '8. Brechas de seguridad. El encargado notifica al responsable, sin dilación indebida, cualquier violación de la seguridad de los datos.',
  '9. Fin del servicio. Al terminar la prestación, el encargado devuelve los datos en un formato reutilizable y los suprime en un plazo de 30 días, salvo obligación legal de conservación.',
  '10. Duración. Este contrato está vigente mientras dure la prestación del servicio.',
];

/** Platform ↔ gestoría: the gestoría decides, the platform processes. */
export function tenantDpaText(tenant: Party): string {
  const platform = `el proveedor del portal de clientes (${env.APP_DOMAIN})`;
  return [
    'CONTRATO DE ENCARGO DE TRATAMIENTO',
    `Responsable: ${party(tenant)}.`,
    `Encargado: ${platform}.`,
    '',
    ...CLAUSES(tenant.name, platform),
  ].join('\n');
}

/** Gestoría ↔ client: the client is the controller of the data the gestoría handles for them. */
export function clientDpaText(tenant: Party, client: Party): string {
  return [
    'CONTRATO DE ENCARGO DE TRATAMIENTO',
    `Responsable: ${party(client)}.`,
    `Encargado: ${party(tenant)}.`,
    '',
    ...CLAUSES(client.name, tenant.name),
  ].join('\n');
}

export type PendingAgreement = {
  documentType: 'DPA_TENANT' | 'DPA_CLIENT';
  clientId: string | null;
  title: string;
  text: string;
};

const address = (row: {
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
}) => [row.addressLine, row.postalCode, row.city].filter(Boolean).join(' ') || null;

/**
 * Agreements this user still has to accept in their current version: the tenant admin signs the
 * platform's DPA, every client user signs the gestoría's for each client they represent (§4).
 */
export async function pendingAgreements(user: SessionUser): Promise<PendingAgreement[]> {
  if (!user.tenantId || (user.role !== 'TENANT_ADMIN' && user.role !== 'CLIENT_USER')) return [];
  const accepted = await prisma.legalAcceptance.findMany({
    where: { tenantId: user.tenantId, userId: user.id, version: DPA_VERSION },
    select: { documentType: true, clientId: true },
  });
  const done = new Set(accepted.map((row) => `${row.documentType}:${row.clientId ?? ''}`));

  if (user.role === 'TENANT_ADMIN') {
    if (done.has('DPA_TENANT:')) return [];
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
    const text = tenantDpaText({
      name: tenant.legalName ?? tenant.name,
      taxId: tenant.taxId,
      address: address(tenant),
    });
    return [
      { documentType: 'DPA_TENANT', clientId: null, title: 'Contrato con la plataforma', text },
    ];
  }

  const missing = user.clientIds.filter((clientId) => !done.has(`DPA_CLIENT:${clientId}`));
  if (missing.length === 0) return [];
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  const clients = await prisma.client.findMany({
    where: { tenantId: user.tenantId, id: { in: missing }, deletedAt: null },
    orderBy: { legalName: 'asc' },
  });
  return clients.map((client) => ({
    documentType: 'DPA_CLIENT' as const,
    clientId: client.id,
    title: `Contrato de ${client.legalName} con ${tenant.name}`,
    text: clientDpaText(
      { name: tenant.legalName ?? tenant.name, taxId: tenant.taxId, address: address(tenant) },
      { name: client.legalName, taxId: client.taxId, address: address(client) },
    ),
  }));
}

/** Records the acceptance of everything pending: who, when, from where, and the hash of the exact text. */
export async function acceptAgreements(user: SessionUser, meta: RequestMeta): Promise<number> {
  const pending = await pendingAgreements(user);
  if (!user.tenantId)
    throw new AppError('FORBIDDEN', 'No tienes permiso para realizar esta acción.');
  for (const agreement of pending) {
    const acceptance = await prisma.legalAcceptance.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        clientId: agreement.clientId,
        documentType: agreement.documentType,
        version: DPA_VERSION,
        contentHash: createHash('sha256').update(agreement.text).digest('hex'),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    await recordAudit({
      tenantId: user.tenantId,
      actor: user,
      action: 'legal.accept',
      entity: 'LegalAcceptance',
      entityId: acceptance.id,
      diff: { documentType: agreement.documentType, version: DPA_VERSION },
      ...meta,
    });
  }
  return pending.length;
}
