# 0014. Client import reads CSV only; XLSX is deferred

Date: 2026-09-18 · Status: accepted

## Context

§6.1 asks for import from Excel/CSV. Reading `.xlsx` needs a large dependency (exceljs, SheetJS), which CLAUDE.md §8.7 only allows with an ADR. CSV needs ~40 lines of our own code.

## Options

1. Add an XLSX library now.
2. Ship CSV with a template that Excel, Numbers and LibreOffice open and save natively (`;` separator, UTF-8 BOM).

## Decision

CSV only for now. The parser autodetects `;` and `,`, handles quotes and BOM, and exports neutralize spreadsheet formulas. Valid rows are imported and invalid ones reported with their spreadsheet row number, so one bad NIF never blocks the rest.

## Consequences

- Users must "Save as CSV". If real gestorías stumble on this, add XLSX reading behind the same `importClients(user, text)` entry point (tech debt TD-016).
