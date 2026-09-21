-- PostgreSQL cannot drop an enum value: rebuild the type without it.
DELETE FROM "reminder_logs" WHERE "kind" = 'RETENTION_NOTICE';
ALTER TYPE "ReminderKind" RENAME TO "ReminderKind_old";
CREATE TYPE "ReminderKind" AS ENUM ('OBLIGATION_DEADLINE', 'MISSING_DOCS', 'PERMANENT_DOC_EXPIRY', 'INVOICE_OVERDUE', 'CLIENT_INACTIVITY');
ALTER TABLE "reminder_logs" ALTER COLUMN "kind" TYPE "ReminderKind" USING ("kind"::text::"ReminderKind");
DROP TYPE "ReminderKind_old";
