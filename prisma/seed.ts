/**
 * Demo data (CLAUDE.md §7). Idempotent: safe to run repeatedly.
 * Each phase extends it with its own entities (documents, threads, invoices…).
 */
import { createHash } from 'node:crypto';
import { PrismaClient, type DocumentStatus, type Role } from '@prisma/client';
import { addDays, toDateOnly, todayInMadrid } from '../src/lib/dates';
import { hashPassword } from '../src/modules/auth/password';
import { putObject } from '../src/lib/storage/objects';
import { ensureChecklist, refreshChecklist } from '../src/modules/checklists/sync';
import { signDelivery } from '../src/modules/deliveries/service';
import { DEFAULT_REJECTION_REASONS } from '../src/modules/documents/schema';
import { syncObligationsForClient } from '../src/modules/obligations/service';
import { invoicePdf, invoiceTotals, makePdf, type DemoInvoice } from './seed-files';
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

const supplier = (name: string, n: number) => ({ supplierName: name, supplierTaxId: cif('B', n) });
const LUZ = supplier('Energía Levante, S.L.', 9600011);
const TELEFONO = supplier('Telecom Mediterráneo, S.L.', 9600022);
const PAPELERIA = supplier('Papelería Ruzafa, S.L.', 9600033);
const IMPRENTA = supplier('Imprenta Turia, S.L.', 9600044);

type DemoDocument = {
  slug: string;
  client: string;
  status: DocumentStatus;
  invoice?: DemoInvoice;
  /** Fields already typed in (or extracted) and confirmed by the manager. */
  fields?: 'confirmed' | 'proposed';
  sameFileAs?: string;
  sameInvoiceAs?: string;
  rejection?: { reason: string; note: string };
  daysAgo: number;
};

// §7: documents in every state, some with data and some pending, two duplicates, one rejected.
const DEMO_DOCUMENTS: DemoDocument[] = [
  {
    slug: 'luz-julio',
    client: 'Marta Soler Vidal',
    status: 'BOOKED',
    fields: 'confirmed',
    daysAgo: 40,
    invoice: {
      ...LUZ,
      invoiceNumber: 'EL-2026-071842',
      invoiceDate: '2026-07-31',
      taxBase: 86.4,
      vatRate: 21,
    },
  },
  {
    slug: 'telefono-julio',
    client: 'Marta Soler Vidal',
    status: 'BOOKED',
    fields: 'confirmed',
    daysAgo: 38,
    invoice: {
      ...TELEFONO,
      invoiceNumber: 'TM-7731920',
      invoiceDate: '2026-07-28',
      taxBase: 41.32,
      vatRate: 21,
    },
  },
  {
    slug: 'imprenta-agosto',
    client: 'Marta Soler Vidal',
    status: 'IN_REVIEW',
    fields: 'proposed',
    daysAgo: 12,
    invoice: {
      ...IMPRENTA,
      invoiceNumber: 'F26-0418',
      invoiceDate: '2026-08-21',
      taxBase: 320,
      vatRate: 21,
    },
  },
  {
    slug: 'luz-agosto',
    client: 'Marta Soler Vidal',
    status: 'RECEIVED',
    daysAgo: 3,
    invoice: {
      ...LUZ,
      invoiceNumber: 'EL-2026-083377',
      invoiceDate: '2026-08-31',
      taxBase: 92.15,
      vatRate: 21,
    },
  },
  {
    slug: 'papeleria-septiembre',
    client: 'Marta Soler Vidal',
    status: 'RECEIVED',
    daysAgo: 1,
    invoice: {
      ...PAPELERIA,
      invoiceNumber: '2026/1093',
      invoiceDate: '2026-09-10',
      taxBase: 58.6,
      vatRate: 21,
    },
  },
  {
    slug: 'luz-agosto-otra-vez',
    client: 'Marta Soler Vidal',
    status: 'DUPLICATE',
    sameFileAs: 'luz-agosto',
    daysAgo: 2,
  },
  {
    slug: 'ticket-borroso',
    client: 'Marta Soler Vidal',
    status: 'REJECTED',
    daysAgo: 6,
    rejection: { reason: DEFAULT_REJECTION_REASONS[0]!, note: 'No se distingue el importe total.' },
  },
  {
    slug: 'turia-luz',
    client: 'Reformas Turia, S.L.',
    status: 'BOOKED',
    fields: 'confirmed',
    daysAgo: 20,
    invoice: {
      ...LUZ,
      invoiceNumber: 'EL-2026-081120',
      invoiceDate: '2026-08-31',
      taxBase: 412.7,
      vatRate: 21,
    },
  },
  {
    slug: 'turia-imprenta',
    client: 'Reformas Turia, S.L.',
    status: 'IN_REVIEW',
    fields: 'proposed',
    daysAgo: 5,
    invoice: {
      ...IMPRENTA,
      invoiceNumber: 'F26-0455',
      invoiceDate: '2026-09-02',
      taxBase: 1250,
      vatRate: 21,
    },
  },
  {
    slug: 'turia-imprenta-escaneada',
    client: 'Reformas Turia, S.L.',
    status: 'DUPLICATE',
    fields: 'proposed',
    sameInvoiceAs: 'turia-imprenta',
    daysAgo: 4,
  },
  {
    slug: 'clinica-telefono',
    client: 'Clínica Dental Ruzafa, S.L.',
    status: 'RECEIVED',
    daysAgo: 2,
    invoice: {
      ...TELEFONO,
      invoiceNumber: 'TM-7802211',
      invoiceDate: '2026-08-28',
      taxBase: 129.9,
      vatRate: 21,
    },
  },
  {
    slug: 'clinica-papeleria',
    client: 'Clínica Dental Ruzafa, S.L.',
    status: 'RECEIVED',
    daysAgo: 0,
    invoice: {
      ...PAPELERIA,
      invoiceNumber: '2026/1101',
      invoiceDate: '2026-09-12',
      taxBase: 214.35,
      vatRate: 21,
    },
  },
];

async function seedDocuments(tenantId: string, managerOf: Map<string, string>) {
  const period = await prisma.period.upsert({
    where: { year_type_ordinal: { year: 2026, type: 'QUARTER', ordinal: 3 } },
    create: { year: 2026, type: 'QUARTER', ordinal: 3 },
    update: {},
  });
  const documentIds = new Map<string, string>();

  for (const demo of DEMO_DOCUMENTS) {
    const client = await prisma.client.findFirstOrThrow({
      where: { tenantId, legalName: demo.client },
    });
    const original = DEMO_DOCUMENTS.find((d) => d.slug === (demo.sameFileAs ?? demo.sameInvoiceAs));
    const invoice = demo.invoice ?? original?.invoice;
    // Same bytes for an exact duplicate; a re-scan (different bytes, same invoice) for the other kind.
    const bytes = invoice
      ? invoicePdf(invoice, demo.sameInvoiceAs ? `${demo.client} (copia escaneada)` : demo.client)
      : makePdf(['Ticket de compra', '', '(imagen borrosa, ilegible)']);

    const storageKey = `${tenantId}/demo/${demo.slug}.pdf`;
    await putObject(storageKey, bytes, 'application/pdf');
    const fileData = {
      tenantId,
      kind: 'DOCUMENT' as const,
      status: 'CLEAN' as const,
      originalName: `${demo.slug}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      scannedAt: new Date(),
    };
    const file = await prisma.storedFile.upsert({
      where: { storageKey },
      create: { storageKey, ...fileData },
      update: fileData,
    });

    const createdAt = new Date(Date.now() - demo.daysAgo * 86_400_000);
    const closed = demo.status !== 'RECEIVED' && demo.status !== 'IN_REVIEW';
    const data = {
      tenantId,
      clientId: client.id,
      periodId: period.id,
      type: invoice ? ('RECEIVED_INVOICE' as const) : ('RECEIPT' as const),
      status: demo.status,
      source: demo.slug.includes('escaneada') ? ('EMAIL' as const) : ('WEB' as const),
      createdAt,
      processedAt: closed ? new Date(createdAt.getTime() + 5 * 3_600_000) : null,
      processedById: closed ? managerOf.get(client.id) : null,
      rejectionReason: demo.rejection?.reason ?? null,
      rejectionNote: demo.rejection?.note ?? null,
      duplicateOfId: original ? documentIds.get(original.slug) : null,
      ...(demo.fields && invoice
        ? {
            supplierName: invoice.supplierName,
            supplierTaxId: invoice.supplierTaxId,
            invoiceNumber: invoice.invoiceNumber,
            invoiceDate: toDateOnly(invoice.invoiceDate),
            taxBase: invoice.taxBase,
            vatRate: invoice.vatRate,
            ...invoiceTotals(invoice),
            currency: 'EUR',
            confidence: demo.fields === 'confirmed' ? 0.97 : 0.84,
            extractionStatus: 'DONE' as const,
            extractionConfirmed: demo.fields === 'confirmed',
          }
        : { extractionStatus: closed ? ('NOT_APPLICABLE' as const) : ('PENDING' as const) }),
    };
    const document = await prisma.document.upsert({
      where: { fileId: file.id },
      create: { fileId: file.id, ...data },
      update: data,
    });
    documentIds.set(demo.slug, document.id);
  }
}

// §7: obligations of the current year in different states. The sync only creates deadlines that are
// still ahead, so the first half of the year is added here as already filed.
async function seedFiledObligations(tenantId: string, clientId: string, managerId: string) {
  const filed = [
    {
      model: '303',
      ordinal: 1,
      due: '2026-04-20',
      result: 'TO_PAY' as const,
      amount: 1184.32,
      directDebit: true,
    },
    {
      model: '130',
      ordinal: 1,
      due: '2026-04-20',
      result: 'TO_PAY' as const,
      amount: 412.5,
      directDebit: true,
    },
    {
      model: '303',
      ordinal: 2,
      due: '2026-07-20',
      result: 'TO_REFUND' as const,
      amount: 236.1,
      directDebit: false,
    },
    {
      model: '130',
      ordinal: 2,
      due: '2026-07-20',
      result: 'ZERO' as const,
      amount: 0,
      directDebit: false,
    },
  ];
  for (const item of filed) {
    const period = await prisma.period.upsert({
      where: { year_type_ordinal: { year: 2026, type: 'QUARTER', ordinal: item.ordinal } },
      create: { year: 2026, type: 'QUARTER', ordinal: item.ordinal },
      update: {},
    });
    const storageKey = `${tenantId}/demo/justificante-${item.model}-${item.ordinal}t.pdf`;
    const bytes = makePdf([
      `Justificante de presentación (demostración)`,
      '',
      `Modelo ${item.model} · ${item.ordinal}T 2026`,
      `Resultado: ${item.amount.toFixed(2)} EUR`,
    ]);
    await putObject(storageKey, bytes, 'application/pdf');
    const fileData = {
      tenantId,
      kind: 'OBLIGATION_RECEIPT' as const,
      status: 'CLEAN' as const,
      originalName: `justificante-${item.model}-${item.ordinal}T-2026.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      scannedAt: new Date(),
    };
    const file = await prisma.storedFile.upsert({
      where: { storageKey },
      create: { storageKey, ...fileData },
      update: fileData,
    });
    const data = {
      dueDate: toDateOnly(item.due),
      status: 'FILED' as const,
      result: item.result,
      resultAmount: item.amount,
      directDebit: item.directDebit,
      filedAt: toDateOnly(addDays(item.due, -3)),
      filedById: managerId,
      receiptFileId: file.id,
    };
    await prisma.obligation.upsert({
      where: { clientId_model_periodId: { clientId, model: item.model, periodId: period.id } },
      create: { tenantId, clientId, model: item.model, periodId: period.id, ...data },
      update: data,
    });
  }
}

// §7: conversations half-way, an open requirement from Hacienda, deliveries (one signed, one waiting).
async function seedCommunication(
  tenantId: string,
  clientId: string,
  managerId: string,
  supervisorId: string,
  clientUserId: string,
) {
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);
  const conversations = [
    {
      subject: 'Requerimiento de Hacienda: IVA del 2T 2026',
      type: 'REQUIREMENT' as const,
      messages: [
        {
          authorId: managerId,
          hours: 70,
          body: 'Hola, Marta: Hacienda nos pide justificar las facturas de gastos del segundo trimestre. Tenemos 10 días hábiles. ¿Puedes subirnos la factura del portátil y la del alquiler del coworking?',
        },
        {
          authorId: clientUserId,
          hours: 46,
          body: 'La del coworking ya la subí ayer. La del portátil la tengo que pedir a la tienda, os la paso esta semana.',
        },
        {
          authorId: managerId,
          hours: 45,
          body: 'Perfecto, la del coworking ya la tengo. Quedo pendiente de la otra.',
        },
      ],
    },
    {
      subject: '¿Puedo deducir la cuota del gimnasio?',
      type: 'GENERAL' as const,
      messages: [
        {
          authorId: clientUserId,
          hours: 5,
          body: 'Buenas, como trabajo desde casa y paso muchas horas sentada, me he apuntado al gimnasio. ¿Me lo puedo deducir?',
        },
      ],
    },
    {
      subject: 'Suele entregar tarde',
      type: 'INTERNAL' as const,
      messages: [
        {
          authorId: managerId,
          hours: 30,
          body: '@Salvador Ibáñez este trimestre vuelve a ir justa con las facturas. ¿Le adelantamos el recordatorio?',
        },
        {
          authorId: supervisorId,
          hours: 28,
          body: 'Sí, y si el día 10 no ha llegado todo, llámala.',
        },
      ],
    },
  ];
  for (const conversation of conversations) {
    if (
      await prisma.thread.findFirst({
        where: { tenantId, clientId, subject: conversation.subject },
      })
    )
      continue;
    const last = hoursAgo(Math.min(...conversation.messages.map((m) => m.hours)));
    const thread = await prisma.thread.create({
      data: {
        tenantId,
        clientId,
        subject: conversation.subject,
        type: conversation.type,
        createdById: conversation.messages[0]!.authorId,
        lastMessageAt: last,
        createdAt: hoursAgo(conversation.messages[0]!.hours),
      },
    });
    for (const message of conversation.messages) {
      await prisma.message.create({
        data: {
          tenantId,
          threadId: thread.id,
          authorId: message.authorId,
          body: message.body,
          createdAt: hoursAgo(message.hours),
          mentionedUserIds: message.body.includes('@Salvador') ? [supervisorId] : [],
        },
      });
    }
    // The author of the last message has read it; the other side has not.
    await prisma.threadRead.create({
      data: {
        tenantId,
        threadId: thread.id,
        userId: conversation.messages.at(-1)!.authorId,
        lastReadAt: last,
      },
    });
  }

  for (const template of [
    {
      name: 'Reclamar documentación',
      body: 'Hola, {{cliente}}:\n\nPara preparar tus impuestos antes del {{plazo}} todavía nos falta:\n{{pendientes}}\n\n¿Nos lo puedes subir esta semana? ¡Gracias!',
    },
    {
      name: 'Acuse de recibo',
      body: 'Recibido, {{cliente}}. Lo revisamos y te decimos algo si falta cualquier cosa.',
    },
  ]) {
    if (
      !(await prisma.template.findFirst({
        where: { tenantId, kind: 'MESSAGE', name: template.name },
      }))
    ) {
      await prisma.template.create({ data: { tenantId, kind: 'MESSAGE', ...template } });
    }
  }

  const deliveries = [
    {
      slug: 'entrega-303-2t',
      title: 'Modelo 303 presentado · 2T 2026',
      category: 'FILED_FORM' as const,
      requiresSignature: false,
      sign: false,
    },
    {
      slug: 'entrega-encargo',
      title: 'Hoja de encargo profesional 2026',
      category: 'LETTER' as const,
      requiresSignature: true,
      sign: true,
    },
    {
      slug: 'entrega-cuentas',
      title: 'Borrador de la declaración de la Renta 2025',
      category: 'OTHER' as const,
      requiresSignature: true,
      sign: false,
    },
  ];
  for (const demo of deliveries) {
    const storageKey = `${tenantId}/demo/${demo.slug}.pdf`;
    if (await prisma.storedFile.findUnique({ where: { storageKey } })) continue;
    const bytes = makePdf([
      demo.title,
      '',
      'Documento de demostración, sin validez.',
      '',
      'Gestoría Pérez & Asociados',
    ]);
    await putObject(storageKey, bytes, 'application/pdf');
    const file = await prisma.storedFile.create({
      data: {
        tenantId,
        kind: 'DELIVERY',
        status: 'CLEAN',
        storageKey,
        originalName: `${demo.slug}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        scannedAt: new Date(),
      },
    });
    const delivery = await prisma.delivery.create({
      data: {
        tenantId,
        clientId,
        fileId: file.id,
        title: demo.title,
        category: demo.category,
        requiresSignature: demo.requiresSignature,
        uploadedById: managerId,
        visibleFrom: hoursAgo(72),
        notifiedAt: hoursAgo(72),
      },
    });
    if (demo.sign) {
      await signDelivery(
        {
          id: clientUserId,
          tenantId,
          role: 'CLIENT_USER',
          status: 'ACTIVE',
          clientIds: [clientId],
          supportTenantIds: [],
        },
        delivery.id,
        true,
        { ip: '203.0.113.24', userAgent: 'Mozilla/5.0 (demo seed)' },
      );
    }
  }
}

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
  const supervisor = await upsertUser(
    perez.id,
    'supervisor@demo.es',
    'Salvador Ibáñez',
    'SUPERVISOR',
    passwordHash,
  );
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

  const clients = await prisma.client.findMany({
    where: { tenantId: perez.id },
    select: { id: true, assignedManagerId: true },
  });
  await seedDocuments(
    perez.id,
    new Map(clients.map((c) => [c.id, c.assignedManagerId ?? managers.gestor.id])),
  );

  const marta = await prisma.client.findUniqueOrThrow({
    where: { tenantId_taxId: { tenantId: perez.id, taxId: nif(12345678) } },
  });
  await prisma.clientUser.upsert({
    where: { clientId_userId: { clientId: marta.id, userId: cliente.id } },
    update: {},
    create: { tenantId: perez.id, clientId: marta.id, userId: cliente.id },
  });

  await seedFiledObligations(perez.id, marta.id, managers.gestor.id);
  await seedCommunication(perez.id, marta.id, managers.gestor.id, supervisor.id, cliente.id);

  // Checklists of the period being collected, ticked from the demo documents.
  for (const client of clients) {
    const periodId = await ensureChecklist(perez.id, client.id, { today });
    await refreshChecklist(perez.id, client.id, [periodId]);
  }
  // One filing already under way, with the amount the client should expect.
  const underWay = await prisma.obligation.findFirst({
    where: {
      tenantId: perez.id,
      model: '303',
      status: 'PENDING_DOCS',
      client: { legalName: 'Reformas Turia, S.L.' },
    },
    orderBy: { dueDate: 'asc' },
  });
  if (underWay) {
    await prisma.obligation.update({
      where: { id: underWay.id },
      data: { status: 'IN_PROGRESS', estimatedAmount: 3420.75 },
    });
  }

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
    `Seed done: ${DEMO_CLIENTS.length} clients and ${DEMO_DOCUMENTS.length} documents in "perez", tenant "otra", superadmin. Password of every demo user: ${DEMO_PASSWORD}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
