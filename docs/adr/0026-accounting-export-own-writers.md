# 0026. Accounting export with our own CSV, ZIP and XLSX writers

Date: 2026-09-19 · Status: accepted

## Context

§6.10 asks for CSV/XLSX export with configurable columns and decimal separator. XLSX libraries are large; the format needed is one sheet of strings and numbers.

## Options

1. exceljs / SheetJS.
2. A 90-line XLSX writer on top of a 60-line ZIP writer (`node:zlib` for deflate and CRC-32).

## Decision

Own writers (`lib/zip.ts`, `lib/xlsx.ts`). Numbers are written as numeric cells, so they import cleanly whatever the locale; CSV uses the tenant's decimal separator, `;` as field separator, a BOM, and neutralises spreadsheet formulas. The format (columns, separator, only booked or not) is a tenant setting, because it must match the gestoría's accounting program once and for all. The ZIP writer is reused by the GDPR exports of phase 9.

## Consequences

- No styles beyond a bold header, no dates as date cells (ISO strings). Enough for import into accounting software; revisit if a gestoría needs a specific vendor format.
- ZIP without zip64: archives up to 4 GB.
