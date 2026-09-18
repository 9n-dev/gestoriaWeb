/**
 * Demo data (CLAUDE.md §7). Idempotent: safe to run repeatedly.
 * Each phase extends it with its own entities (documents, threads, invoices…).
 */
import { PrismaClient, type Role } from '@prisma/client';
import { addDays, toDateOnly, todayInMadrid } from '../src/lib/dates';
import { hashPassword } from '../src/modules/auth/password';
import { syncObligationsForClient } from '../src/modules/obligations/service';
import { seedSystemData } from './system-data';

const prisma = new PrismaClient();
const DEMO_PASSWORD = 'demo1234';

// Synthetic tax ids with valid control characters: they pass validation and belong to nobody.
const nif = (n: number) => `${String(n).padStart(8, '0')}${'TRWAGMYFPDXBNJZSQVHLCKE'[n % 23]}`;
function cif(letter: string, n: number): string {
  const digits = String(n).padStart(7, '0');
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const d = Number(digits[i]);
    sum += i % 2 === 1 ? d : Math.floor((d * 2) / 10) + ((d * 2) % 10);
  }
  const control = (10 - (sum % 10)) % 10;
  return `${letter}${digits}${'PQRSNW'.includes(letter) ? 'JABCDEFGHI'[control] : control}`;
}

type Manager = 'gestor' | 'gestor2';
const DEMO_CLIENTS: Array<{
  legalName: string;
  taxId: string;
  profile: string;
  manager: Manager;
  email?: string;
  tags?: string[];
}> = [
  {
    legalName: 'Marta Soler Vidal',
    taxId: nif(12345678),
    profile: 'Autónomo · Estimación directa',
    manager: 'gestor',
    email: 'cliente@demo.es',
    tags: ['diseño'],
  },
  {
    legalName: 'Joaquín Ribes Llorens',
    taxId: nif(20000001),
    profile: 'Autónomo · Módulos',
    manager: 'gestor',
    tags: ['taxi'],
  },
  {
    legalName: 'Reformas Turia, S.L.',
    taxId: cif('B', 7654321),
    profile: 'Sociedad limitada con trabajadores y local',
    manager: 'gestor2',
    tags: ['construcción'],
  },
  {
    legalName: 'Hermanos Peris, C.B.',
    taxId: cif('E', 4600012),
    profile: 'Comunidad de bienes',
    manager: 'gestor2',
  },
  {
    legalName: 'Carmen Navarro Gil',
    taxId: nif(20000002),
    profile: 'Arrendador de locales',
    manager: 'gestor',
    tags: ['alquileres'],
  },
  {
    legalName: 'Clínica Dental Ruzafa, S.L.',
    taxId: cif('B', 4600023),
    profile: 'Sociedad limitada con trabajadores y local',
    manager: 'gestor',
  },
  {
    legalName: 'Pau Ferrando Marí',
    taxId: nif(20000003),
    profile: 'Autónomo · Estimación directa con local alquilado',
    manager: 'gestor2',
    tags: ['fisioterapia'],
  },
  {
    legalName: 'Lucía Andreu Costa',
    taxId: nif(20000004),
    profile: 'Autónomo · Estimación directa con trabajadores',
    manager: 'gestor',
    tags: ['peluquería'],
  },
  {
    legalName: 'Horno Sant Blai, S.L.',
    taxId: cif('B', 4600034),
    profile: 'Sociedad limitada con trabajadores y local',
    manager: 'gestor2',
  },
  {
    legalName: 'Vicent Esteve Roig',
    taxId: nif(20000005),
    profile: 'Particular · Solo Renta',
    manager: 'gestor',
  },
  {
    legalName: 'Bicis Malvarrosa, S.L.',
    taxId: cif('B', 4600045),
    profile: 'Sociedad limitada',
    manager: 'gestor2',
  },
  {
    legalName: 'Amparo Tortosa Sanz',
    taxId: nif(20000006),
    profile: 'Autónomo · Estimación directa con trabajadores y local',
    manager: 'gestor',
    tags: ['academia'],
  },
];

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
  await seedSystemData(prisma);
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const today = todayInMadrid();

  const perez = await prisma.tenant.upsert({
    where: { slug: 'perez' },
    update: { status: 'ACTIVE' },
    create: {
      slug: 'perez',
      name: 'Gestoría Pérez & Asociados',
      legalName: 'Pérez & Asociados Gestoría, S.L.',
      taxId: cif('B', 1234567),
      addressLine: 'C/ Colón, 12, 2.º',
      postalCode: '46004',
      city: 'Valencia',
      province: 'Valencia',
      contactEmail: 'hola@gestoriaperez.example',
      status: 'ACTIVE',
      onboardingCompletedAt: new Date(),
    },
  });

  await upsertUser(perez.id, 'admin@demo.es', 'Amparo Pérez', 'TENANT_ADMIN', passwordHash);
  await upsertUser(perez.id, 'supervisor@demo.es', 'Salvador Ibáñez', 'SUPERVISOR', passwordHash);
  const managers = {
    gestor: await upsertUser(perez.id, 'gestor@demo.es', 'Lucía Ferrer', 'MANAGER', passwordHash),
    gestor2: await upsertUser(
      perez.id,
      'gestor2@demo.es',
      'Andrés Molina',
      'MANAGER',
      passwordHash,
    ),
  };
  const cliente = await upsertUser(
    perez.id,
    'cliente@demo.es',
    'Marta Soler',
    'CLIENT_USER',
    passwordHash,
  );

  for (const demo of DEMO_CLIENTS) {
    const profile = await prisma.taxProfile.findFirstOrThrow({
      where: { tenantId: null, name: demo.profile },
    });
    const data = {
      legalName: demo.legalName,
      email: demo.email,
      tags: demo.tags ?? [],
      taxProfileId: profile.id,
      assignedManagerId: managers[demo.manager].id,
      city: 'Valencia',
      province: 'Valencia',
    };
    const client = await prisma.client.upsert({
      where: { tenantId_taxId: { tenantId: perez.id, taxId: demo.taxId } },
      update: data,
      create: {
        tenantId: perez.id,
        taxId: demo.taxId,
        inboundEmailCode: `demo${demo.taxId.toLowerCase()}`,
        ...data,
      },
    });
    await syncObligationsForClient(perez.id, client.id, { today });
  }

  const marta = await prisma.client.findUniqueOrThrow({
    where: { tenantId_taxId: { tenantId: perez.id, taxId: nif(12345678) } },
  });
  await prisma.clientUser.upsert({
    where: { clientId_userId: { clientId: marta.id, userId: cliente.id } },
    update: {},
    create: { tenantId: perez.id, clientId: marta.id, userId: cliente.id },
  });

  // §7 asks for a deadline within 5 days of the seed run, whatever the date. The real calendar
  // cannot guarantee that, so the demo client's next obligation is moved. Demo data only.
  const next = await prisma.obligation.findFirst({
    where: { clientId: marta.id, status: 'PENDING_DOCS' },
    orderBy: { dueDate: 'asc' },
  });
  if (next) {
    await prisma.obligation.update({
      where: { id: next.id },
      data: { dueDate: toDateOnly(addDays(today, 4)) },
    });
  }

  // A second tenant, to check isolation by hand: otra.localhost:3000
  const otra = await prisma.tenant.upsert({
    where: { slug: 'otra' },
    update: {},
    create: {
      slug: 'otra',
      name: 'Asesoría Otra',
      status: 'ACTIVE',
      onboardingCompletedAt: new Date(),
    },
  });
  await upsertUser(otra.id, 'admin@demo.es', 'Admin de Otra', 'TENANT_ADMIN', passwordHash);

  await upsertUser(null, 'superadmin@demo.es', 'Soporte Plataforma', 'SUPERADMIN', passwordHash);

  console.info(
    `Seed done: ${DEMO_CLIENTS.length} clients in "perez", tenant "otra", superadmin. Password of every demo user: ${DEMO_PASSWORD}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
