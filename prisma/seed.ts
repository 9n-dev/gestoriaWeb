/**
 * Base demo data (CLAUDE.md §7). Idempotent: safe to run repeatedly.
 * Each phase extends it with its own entities (documents, obligations, threads, invoices…).
 */
import { PrismaClient, type Role } from '@prisma/client';
import { hashPassword } from '../src/modules/auth/password';

const prisma = new PrismaClient();
const DEMO_PASSWORD = 'demo1234';

async function upsertUser(
  tenantId: string | null,
  email: string,
  name: string,
  role: Role,
  passwordHash: string,
) {
  const existing = await prisma.user.findFirst({ where: { tenantId, email } });
  const data = { name, role, passwordHash, status: 'ACTIVE' as const, emailVerifiedAt: new Date() };
  return existing
    ? prisma.user.update({ where: { id: existing.id }, data })
    : prisma.user.create({ data: { tenantId, email, ...data } });
}

async function main() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const perez = await prisma.tenant.upsert({
    where: { slug: 'perez' },
    update: { status: 'ACTIVE' },
    create: {
      slug: 'perez',
      name: 'Gestoría Pérez & Asociados',
      legalName: 'Pérez & Asociados Gestoría, S.L.',
      taxId: 'B12345674',
      city: 'Valencia',
      province: 'Valencia',
      status: 'ACTIVE',
      onboardingCompletedAt: new Date(),
    },
  });

  await upsertUser(perez.id, 'admin@demo.es', 'Amparo Pérez', 'TENANT_ADMIN', passwordHash);
  await upsertUser(perez.id, 'supervisor@demo.es', 'Salvador Ibáñez', 'SUPERVISOR', passwordHash);
  const gestor = await upsertUser(
    perez.id,
    'gestor@demo.es',
    'Lucía Ferrer',
    'MANAGER',
    passwordHash,
  );
  const gestor2 = await upsertUser(
    perez.id,
    'gestor2@demo.es',
    'Andrés Molina',
    'MANAGER',
    passwordHash,
  );
  const cliente = await upsertUser(
    perez.id,
    'cliente@demo.es',
    'Marta Soler',
    'CLIENT_USER',
    passwordHash,
  );

  // Synthetic tax ids with valid control characters. The 12 demo clients arrive in phase 2.
  const clients = [
    { taxId: '12345678Z', legalName: 'Marta Soler Vidal', code: 'msoler', managerId: gestor.id },
    { taxId: 'B76543214', legalName: 'Reformas Turia, S.L.', code: 'turia', managerId: gestor2.id },
  ];
  for (const { taxId, legalName, code, managerId } of clients) {
    await prisma.client.upsert({
      where: { tenantId_taxId: { tenantId: perez.id, taxId } },
      update: { assignedManagerId: managerId },
      create: {
        tenantId: perez.id,
        taxId,
        legalName,
        inboundEmailCode: code,
        assignedManagerId: managerId,
      },
    });
  }
  const marta = await prisma.client.findUniqueOrThrow({
    where: { tenantId_taxId: { tenantId: perez.id, taxId: '12345678Z' } },
  });
  await prisma.clientUser.upsert({
    where: { clientId_userId: { clientId: marta.id, userId: cliente.id } },
    update: {},
    create: { tenantId: perez.id, clientId: marta.id, userId: cliente.id },
  });

  // A second tenant, to check isolation by hand: otra.localhost:3000
  const otra = await prisma.tenant.upsert({
    where: { slug: 'otra' },
    update: {},
    create: { slug: 'otra', name: 'Asesoría Otra', status: 'ACTIVE' },
  });
  await upsertUser(otra.id, 'admin@demo.es', 'Admin de Otra', 'TENANT_ADMIN', passwordHash);

  await upsertUser(null, 'superadmin@demo.es', 'Soporte Plataforma', 'SUPERADMIN', passwordHash);

  console.info('Seed done: tenants "perez" and "otra"; every demo user has password demo1234');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
