# Portal de clientes para gestorías — especificación para Claude Code

Este archivo es la fuente de verdad del proyecto. Léelo entero antes de tocar nada y consúltalo ante cualquier duda. Si algo aquí es ambiguo o contradictorio, pregunta antes de decidir. No inventes requisitos que no estén aquí.

---

## 1. Qué estamos construyendo

Un producto SaaS multi-tenant de marca blanca: un **portal de clientes para gestorías pequeñas (1-10 empleados)** en España. No sustituye al programa contable de la gestoría; se coloca entre la gestoría y sus clientes (autónomos y pymes) para ordenar la recepción de documentación, los plazos fiscales y la comunicación.

Cada gestoría (tenant) lo usa en su propio dominio (`clientes.gestoriaperez.es`) con su logo y colores. El producto se vende a la gestoría; la gestoría atiende a sus clientes finales.

**Idioma de toda la interfaz, mensajes, emails y comentarios de cara al usuario: español.** El código, nombres de variables, commits y documentación técnica: inglés.

---

## 2. Stack (no cambiar sin preguntarme)

| Capa | Elección |
|---|---|
| Framework | Next.js 15, App Router, TypeScript estricto |
| UI | Tailwind CSS + componentes propios (sin librerías de UI pesadas). Radix Primitives permitido para accesibilidad de diálogos, menús y selects |
| Base de datos | PostgreSQL con Prisma. En desarrollo, Postgres en Docker (docker-compose incluido). En producción, Neon |
| Auth | Auth.js v5. Credenciales con contraseña + enlace mágico por email. TOTP para 2FA |
| Archivos | S3 compatible: Cloudflare R2 en producción, MinIO en Docker para desarrollo. Siempre URLs firmadas de corta duración |
| Emails | Resend. Fallback en desarrollo: guardar en tabla `email_log` y mostrar en consola |
| Colas y tareas | BullMQ + Redis (Redis en Docker en desarrollo, Upstash en producción) |
| OCR / IA | API de Anthropic (Claude) con visión para extracción de campos de facturas. Abstraer detrás de una interfaz `DocumentExtractor` para poder cambiar de proveedor |
| Validación | Zod en todos los límites: formularios, API, jobs, variables de entorno |
| Tests | Vitest para unitarios e integración; Playwright para 3-4 flujos críticos end-to-end |
| Despliegue | Vercel para la app; workers de BullMQ en Railway o Fly.io. No uses nada que no funcione en ese esquema |

Variables de entorno validadas con Zod al arrancar (`env.ts`). La app no debe arrancar con configuración incompleta.

---

## 3. Arquitectura y reglas de código

- **Multi-tenant desde el primer commit.** Toda tabla de negocio tiene `tenantId`. Todo acceso a datos pasa por un repositorio o helper que recibe el tenant de la sesión, nunca del cliente. Un test de integración debe demostrar que un usuario del tenant A no puede leer, listar ni modificar nada del tenant B por ningún endpoint.
- **Estructura por dominio**, no por tipo técnico:
  ```
  src/
    app/                 rutas (App Router), solo composición
    modules/
      tenants/
      auth/
      clients/           fichas de cliente y perfiles fiscales
      documents/         subida, estados, extracción
      obligations/       calendario fiscal, obligaciones, presentaciones
      checklists/        checklist por periodo y semáforo
      messaging/         hilos, mensajes, notificaciones
      deliveries/        documentos entregados por la gestoría, firma simple
      billing/           cuotas y facturas de la gestoría a sus clientes
      audit/             registro de auditoría
      branding/          marca blanca
    lib/                 utilidades transversales (db, storage, email, queue, dates)
    jobs/                workers de BullMQ
  ```
  Cada módulo expone `schema.ts` (Zod), `service.ts` (lógica), `repository.ts` (acceso a datos) y sus componentes de UI. Las server actions y route handlers son finos: validan, llaman al servicio, devuelven.
- **Permisos centralizados** en `modules/auth/permissions.ts` con una función `can(user, action, resource)`. Nunca comprobaciones de rol sueltas en componentes.
- **Fechas**: todo en UTC en base de datos; zona horaria `Europe/Madrid` para mostrar y para calcular plazos. Usa `date-fns` + `date-fns-tz`. Los plazos fiscales se calculan con calendario de días hábiles y festivos nacionales (tabla `holidays`, precargada).
- **Errores**: clase `AppError` con código, mensaje para usuario y mensaje técnico. Nunca exponer stack traces ni mensajes de Prisma al cliente.
- **Server Components por defecto**, Client Components solo donde haya interacción. Nada de `useEffect` para cargar datos.
- Accesibilidad WCAG AA: foco visible, etiquetas, contraste, navegación por teclado. Los componentes de tabla del gestor tienen atajos de teclado documentados.
- Sin `any`. Sin `// @ts-ignore`. ESLint + Prettier configurados y pasando en CI.

---

## 4. Roles y permisos

| Rol | Ámbito | Puede |
|---|---|---|
| `CLIENT_USER` | Un cliente (empresa/autónomo) del tenant. Un cliente puede tener varios usuarios | Subir documentos, ver sus obligaciones y entregas, escribir en sus hilos, firmar, ver sus facturas |
| `MANAGER` (gestor) | Clientes asignados dentro del tenant | Todo lo del cliente sobre sus asignados + procesar documentos, reclamar, marcar presentaciones, notas internas |
| `SUPERVISOR` | Todos los clientes del tenant | Lo del gestor + reasignar clientes, ver métricas globales |
| `TENANT_ADMIN` | El tenant | Lo del supervisor + usuarios, marca, plantillas, perfiles fiscales, facturación, exportación de datos |
| `SUPERADMIN` | Plataforma | Alta y baja de tenants, soporte. Sin acceso a datos de clientes salvo "modo soporte" activado por el tenant admin, con caducidad y registro en auditoría |

2FA (TOTP) obligatorio para `MANAGER`, `SUPERVISOR`, `TENANT_ADMIN` y `SUPERADMIN`. Opcional para clientes.

---

## 5. Modelo de datos (Prisma)

Propón el `schema.prisma` completo en la fase 1 y espera mi aprobación antes de generar migraciones. Debe cubrir como mínimo:

- `Tenant` (nombre, slug, dominio personalizado, estado, plan, configuración de marca en JSON, ajustes de recordatorios).
- `User` (tenantId nullable solo para superadmin, email, hash, rol, 2FA secret, estado, último acceso).
- `Client` (tenantId, razón social, NIF, dirección, `taxProfileId`, gestor asignado, estado `ACTIVE | INACTIVE | DELINQUENT`, etiquetas, notas internas).
- `ClientUser` (relación N:M entre User y Client).
- `TaxProfile` (tenantId nullable para los del sistema, nombre, reglas en JSON: régimen, periodicidad IVA, tiene trabajadores, retiene alquileres, intracomunitario, modelos aplicables, checklist de documentos por periodo). Los perfiles del sistema son plantillas; el tenant puede clonarlos y editarlos.
- `Period` (año, trimestre o mes, tipo).
- `Document` (tenantId, clientId, periodId nullable, tipo `ISSUED_INVOICE | RECEIVED_INVOICE | RECEIPT | PAYROLL | BANK_STATEMENT | RENT_RECEIPT | OTHER`, estado `RECEIVED | IN_REVIEW | BOOKED | REJECTED | DUPLICATE`, motivo de rechazo, clave de almacenamiento, hash SHA-256, tamaño, mime, subido por, origen `WEB | EMAIL | WHATSAPP`, campos extraídos: proveedor, NIF proveedor, número, fecha, base, IVA, total, confianza; confirmado por gestor sí/no).
- `PermanentDocument` (escrituras, certificados, alta censal… con fecha de caducidad).
- `Obligation` (tenantId, clientId, modelo `303 | 130 | 131 | 111 | 115 | 349 | 390 | 180 | 190 | 200 | 347 | 100 | ...`, periodo, fecha límite calculada, estado `PENDING_DOCS | IN_PROGRESS | FILED`, importe resultado, a pagar/devolver, domiciliado, justificante).
- `ChecklistItem` (clientId, periodId, tipo de documento requerido, cumplido sí/no, origen automático o manual).
- `Thread` y `Message` (por cliente, asunto, tipo `PERIOD | REQUIREMENT | GENERAL | INTERNAL`, adjuntos, leído por).
- `Delivery` (documento que la gestoría entrega al cliente, con `requiresSignature`, `signedAt`, sello de tiempo, IP).
- `Invoice` e `InvoiceLine` (facturas de la gestoría al cliente: numeración por serie y tenant, estado `DRAFT | ISSUED | PAID | OVERDUE | CANCELLED`, método de cobro, referencias de Stripe/GoCardless).
- `Notification` (usuario, tipo, canal, leída, enlace).
- `AuditLog` (tenantId, actor, acción, entidad, entityId, IP, user agent, diff en JSON, timestamp). Solo inserción; ninguna ruta puede actualizarla ni borrarla.
- `Holiday` (fecha, ámbito nacional/autonómico).
- `EmailLog`, `Job` metadata según haga falta.

Índices en todas las claves foráneas y en (`tenantId`, campos de filtrado frecuente). Borrado lógico (`deletedAt`) para clientes y documentos; borrado físico solo por el proceso de exportación y baja de tenant.

---

## 6. Módulos funcionales y criterios de aceptación

### 6.1 Tenants y onboarding
- Alta de tenant por superadmin o auto-registro con verificación de email.
- Asistente de onboarding: datos de la gestoría, subir logo, elegir colores, invitar equipo, importar clientes desde Excel/CSV (plantilla descargable, validación fila a fila con informe de errores), enviar invitaciones masivas.
- Datos de ejemplo opcionales al terminar el onboarding, borrables con un botón.
- **Aceptación**: una gestoría nueva llega a tener 20 clientes invitados en menos de 10 minutos siguiendo el asistente.

### 6.2 Ficha de cliente y perfiles fiscales
- CRUD de clientes con validación de NIF/CIF español (letra de control).
- Al asignar perfil fiscal, se generan automáticamente las obligaciones del año en curso y del siguiente cuando llegue diciembre (job mensual).
- Cambiar de perfil regenera solo obligaciones futuras no iniciadas y avisa de las diferencias.
- Documentación permanente con fecha de caducidad y aviso 60/30/7 días antes.
- Notas internas invisibles para el cliente (comprobado por test).
- **Aceptación**: crear un autónomo en estimación directa simplificada, trimestral, sin trabajadores, con local alquilado, genera 303, 130, 115, 390, 180, 100 con fechas correctas.

### 6.3 Recepción de documentos
- Subida múltiple desde web y desde PWA con acceso a cámara. Compresión de imágenes en el navegador antes de enviar (máximo lado 2500 px, calidad 0,8). Conversión HEIC en servidor.
- Subida reanudable para conexiones malas (usar multipart de S3).
- Límites: 20 MB por archivo, formatos jpg, png, pdf, heic. Escaneo antivirus con ClamAV en el worker; documentos infectados se marcan y se bloquean.
- Cada documento: tipo, periodo (sugerido por fecha extraída), estado.
- Dirección de correo única por cliente (`<slug>-<código>@docs.<dominio-de-envío>`): webhook de Resend inbound que crea documentos desde adjuntos. Los emails sin adjunto crean un mensaje en el hilo general.
- Detección de duplicados: por hash exacto y por (proveedor NIF + número + fecha) tras extracción.
- Rechazo con motivo de lista configurable por tenant y texto libre; notificación inmediata al cliente.
- **Aceptación**: subir 10 fotos desde móvil en una conexión 3G simulada termina sin errores y sin perder ninguna.

### 6.4 Extracción con IA
- Job asíncrono por documento: envía imagen/PDF a Claude con un prompt estructurado que devuelve JSON (`supplierName, supplierTaxId, invoiceNumber, date, taxBase, vatRate, vatAmount, total, currency, confidence`).
- Validación del JSON con Zod; si falla, reintento con prompt de corrección; si vuelve a fallar, documento queda con `extractionStatus = FAILED` y se procesa a mano.
- El gestor ve los campos propuestos con indicador de confianza y los confirma o corrige en la misma pantalla con un solo atajo.
- Registro de coste por tenant (tokens) para poder facturar el extra.
- **Aceptación**: el test con 10 facturas de ejemplo del repositorio extrae total y fecha correctos en al menos 9.

### 6.5 Checklist y semáforo
- Para cada cliente y periodo, checklist generada desde el perfil fiscal; el gestor puede añadir o quitar ítems.
- Semáforo: verde (todo cumplido), ámbar (faltan ítems y quedan más de 7 días), rojo (faltan ítems y quedan 7 días o menos, o vencido).
- Vista global del trimestre para el tenant: tabla de clientes con semáforo, ordenable, filtrable por gestor y estado, exportable.
- "Cerrar documentación" cambia el estado del periodo y bloquea nuevas subidas salvo desbloqueo por el gestor.

### 6.6 Calendario fiscal y presentaciones
- Tabla de plazos AEAT precargada por año (fichero `data/tax-calendar-<año>.json` con fuente y fecha de actualización en el README). Cálculo de plazo real: si cae en festivo o fin de semana, siguiente día hábil.
- Obligación con estados `PENDING_DOCS → IN_PROGRESS → FILED`. Al marcar `FILED`, el gestor adjunta justificante, indica resultado (a pagar/devolver/cero), importe y si está domiciliado. El cliente recibe notificación.
- Vista del cliente: próximos plazos con importe previsto y estado.
- Recordatorios automáticos escalonados a 15, 7 y 2 días y el mismo día, con plantillas distintas y configurables por tenant. Los recordatorios de "documentación pendiente" incluyen la lista concreta de lo que falta.
- **Aceptación**: los tests de `obligations/deadlines.test.ts` cubren festivos, fin de semana, año bisiesto y cambio de año.

### 6.7 Entregas y firma simple
- La gestoría sube documentos para el cliente (modelos presentados, libros, cartas). Categoría, periodo, visible desde.
- Documentos con `requiresSignature`: el cliente lee, marca conformidad, se guarda timestamp, IP, user agent y hash del documento. Se genera certificado PDF de firma adjunto al documento.
- Historial de visualización y descarga por documento.

### 6.8 Comunicación
- Hilos por cliente y asunto. Tipos: periodo, requerimiento, general, interno (solo gestores).
- Plantillas de mensaje por tenant con variables (`{{cliente}}`, `{{plazo}}`, `{{pendientes}}`).
- Email de notificación con `reply-to` único por hilo; las respuestas por email entran en el hilo (webhook inbound).
- Notificaciones in-app con contador, push web para PWA, preferencias por usuario.
- Menciones a compañeros (`@nombre`) en hilos internos.

### 6.9 Automatizaciones (workers)
- Recordatorios de plazos y de documentación pendiente (cron diario 08:00 Europe/Madrid).
- Aviso al gestor de clientes sin actividad en N días (configurable).
- Caducidad de documentación permanente.
- Generación de obligaciones del año siguiente (1 de diciembre).
- Todos los jobs son idempotentes, con reintentos exponenciales, dead-letter queue y panel mínimo de jobs fallidos para superadmin.

### 6.10 Panel del gestor
- Bandeja unificada de documentos por procesar: vista densa tipo tabla, previsualización lateral, atajos: `J/K` siguiente/anterior, `B` contabilizar, `R` rechazar, `D` duplicado, `E` editar campos, `Enter` confirmar extracción.
- Vistas guardadas por usuario (filtros + orden).
- Dashboard: clientes en rojo, documentos sin procesar, plazos de la semana, carga por gestor, tiempo medio de procesado.
- Exportación de documentos de un periodo a CSV/XLSX con campos extraídos, con formato configurable (columnas, separador decimal) para importar al programa contable.

### 6.11 Facturación de la gestoría a sus clientes
- Cuota mensual por cliente (concepto, importe, IVA, retención IRPF si aplica).
- Generación automática de facturas el día 1 con numeración correlativa por serie y tenant (bloqueo transaccional para evitar saltos y duplicados).
- PDF de factura con los datos legales obligatorios en España. Preparar campos para Verifactu (hash encadenado y QR) tras una interfaz `InvoiceCompliance` que se pueda implementar al final.
- Cobro: Stripe (tarjeta) y GoCardless (SEPA), ambos detrás de una interfaz `PaymentProvider`. Webhooks con verificación de firma e idempotencia.
- Estados, recordatorios de impago a 3, 10 y 20 días; a los 30 días el cliente pasa a `DELINQUENT` (puede subir, no puede descargar). Configurable.

### 6.12 Marca blanca
- Logo, favicon, colores primario y de acento (validar contraste automáticamente y avisar), nombre de remitente, dominio propio.
- Dominio personalizado: instrucciones DNS en pantalla, verificación por TXT, SSL automático a través de la plataforma de despliegue.
- Dominio de envío de email verificado (SPF, DKIM, DMARC) con estado visible.
- Textos de emails y plantillas editables con vista previa.
- Idiomas: español por defecto; estructura i18n preparada para catalán, gallego, euskera e inglés (solo español implementado en esta versión, el resto con ficheros vacíos que hacen fallback).

### 6.13 Cumplimiento, seguridad y auditoría
- Registro de auditoría de toda lectura de documento, descarga, modificación, borrado, cambio de permisos, inicio de sesión y activación de modo soporte.
- 2FA TOTP con códigos de recuperación. Bloqueo tras 5 intentos fallidos (15 min). Sesiones con caducidad 12 h para gestores, 30 días para clientes, revocables.
- Cabeceras de seguridad (CSP estricta, HSTS, etc.). Rate limiting en auth, subida y API pública.
- Cifrado en reposo del bucket, URLs firmadas de 5 minutos, nunca URLs públicas.
- Generación de contrato de encargado de tratamiento (plantilla) al dar de alta un tenant y al invitar un cliente, con aceptación registrada.
- Derecho de acceso y supresión: desde el panel del tenant admin se puede exportar todo lo de un cliente y borrarlo de forma segura (con periodo de gracia de 30 días).
- Exportación completa del tenant (ZIP con CSVs y archivos) al dar de baja, y borrado físico a los 30 días.
- Política de retención de documentos configurable (por defecto 6 años).

### 6.14 PWA y experiencia
- Instalable en móvil, icono, pantalla de inicio, funcionamiento con conexión intermitente (cola de subidas pendientes en IndexedDB).
- Flujo del cliente para subir una factura: máximo tres toques desde la pantalla de inicio.
- Modo claro/oscuro respetando el sistema.
- Centro de ayuda mínimo: 8-10 artículos cortos en `/ayuda` generados desde Markdown.

### 6.15 Operación
- `docker-compose.yml` con Postgres, Redis, MinIO y ClamAV.
- Scripts: `dev`, `build`, `test`, `test:e2e`, `db:migrate`, `db:seed`, `db:reset`, `lint`, `typecheck`.
- CI (GitHub Actions): lint, typecheck, tests unitarios y de integración, build. E2E en un job aparte.
- Sentry (o compatible) para errores; endpoint `/api/health` que comprueba DB, Redis y storage.
- Migraciones reversibles; nunca editar migraciones ya aplicadas.
- README con instalación, variables, arquitectura, despliegue y cómo añadir un perfil fiscal nuevo.

---

## 7. Modo demo

- `npm run db:seed` crea un tenant "Gestoría Pérez & Asociados" con:
  - 1 tenant admin, 1 supervisor, 2 gestores.
  - 12 clientes de perfiles variados (autónomo diseñador, autónomo en módulos, SL pequeña con 3 trabajadores, comunidad de bienes, particular con dos alquileres, etc.), repartidos entre los gestores.
  - Documentos en todos los estados, algunos con extracción hecha y otros pendientes, dos duplicados, un rechazado.
  - Obligaciones del año en curso con distintos estados; al menos un plazo que vence dentro de 5 días desde la fecha de ejecución del seed.
  - Hilos con conversaciones a medias, un requerimiento de Hacienda abierto.
  - Facturas emitidas, una vencida.
- Usuarios demo mostrados en la pantalla de login solo si `DEMO_MODE=true`:
  - admin@demo.es / demo1234, gestor@demo.es / demo1234, cliente@demo.es / demo1234.
- Banner "Entorno de demostración: los datos se reinician cada noche" y job que ejecuta el seed a las 04:00 cuando `DEMO_MODE=true`.
- Los ficheros de ejemplo (facturas, fotos) se generan sintéticamente o se toman de `fixtures/` sin datos reales.

---

## 8. Forma de trabajar

1. **Antes de escribir código**: propón la estructura de carpetas definitiva, el `schema.prisma` completo y la lista de permisos. Espera mi aprobación explícita.
2. Avanza **por fases**, en este orden, y detente al final de cada una con un resumen de lo hecho, lo que queda y cualquier decisión que hayas tomado:
   - Fase 1: infraestructura (Docker, env, Prisma, Auth, roles, multi-tenant, auditoría base, CI).
   - Fase 2: tenants, onboarding, ficha de cliente, perfiles fiscales, generación de obligaciones.
   - Fase 3: recepción de documentos (web, PWA, email inbound), estados, antivirus, duplicados, bandeja del gestor.
   - Fase 4: checklist, semáforo, calendario fiscal, recordatorios, workers.
   - Fase 5: comunicación, notificaciones, entregas y firma simple.
   - Fase 6: marca blanca, dominio propio, plantillas.
   - Fase 7: extracción con IA y exportación contable.
   - Fase 8: facturación y cobros.
   - Fase 9: seguridad avanzada (2FA, rate limiting, CSP), RGPD operativa, exportación y baja de tenant.
   - Fase 10: PWA, offline, ayuda, modo demo completo, pulido y rendimiento.
   Las fases 1-5 son el producto mínimo vendible; si hay que recortar, se recorta a partir de la 6.
3. **Cada fase termina con**: tests pasando, `lint` y `typecheck` limpios, seed actualizado, README actualizado, y una lista de deuda técnica en `docs/tech-debt.md`.
4. **Commits pequeños** con Conventional Commits (`feat(documents): ...`). Una rama por fase.
5. **Tests obligatorios** en: aislamiento entre tenants, permisos por rol, generación de obligaciones por perfil, cálculo de plazos, detección de duplicados, numeración de facturas, idempotencia de webhooks. E2E: cliente sube documento y gestor lo contabiliza; gestor marca obligación presentada y cliente la ve; onboarding completo.
6. **Decisiones**: documenta cada decisión no trivial en `docs/adr/NNNN-titulo.md` (contexto, opciones, decisión, consecuencias).
7. **No hagas**: cambiar de stack, añadir librerías grandes sin justificarlo en un ADR, exponer datos entre tenants "temporalmente", saltarte validación en server actions, usar `any`, dejar TODOs sin issue asociada en `docs/tech-debt.md`.
8. Si una tarea requiere una clave externa que no tengo (Resend, R2, Stripe…), implementa el adaptador con una implementación falsa para desarrollo y deja claro en el README qué hay que configurar.

---

## 9. Definición de "terminado" para el producto

- Una gestoría real puede registrarse, personalizar su marca, importar clientes, invitarlos y recibir documentación en su propio dominio sin intervención manual.
- Ningún test de aislamiento entre tenants falla. Ningún endpoint devuelve datos sin comprobar `can()`.
- Lighthouse en móvil: rendimiento ≥ 90, accesibilidad ≥ 95 en las pantallas del cliente.
- Un gestor puede procesar 50 documentos seguidos solo con teclado.
- Se puede exportar y borrar un tenant completo y el sistema queda limpio.
- Todo lo anterior está documentado en el README y demostrable con el modo demo.
