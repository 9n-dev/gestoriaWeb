-- Reverts the initial migration. Run manually: psql "$DIRECT_URL" -f down.sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
