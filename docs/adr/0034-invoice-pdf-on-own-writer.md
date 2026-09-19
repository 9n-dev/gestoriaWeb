# 0034. Designed invoice PDF on our own writer, QR drawn as vectors

Date: 2026-09-19 · Status: accepted

## Context

TD-056: invoices were a column of 12 pt text and the verification QR was printed as a URL. While looking at it we also found that `€` came out as `?`: the writer treated every character above Latin-1 as unknown, and the euro sign lives at `0x80` in WinAnsi. An invoice is the one document of the portal that the gestoría's clients forward to third parties.

## Options

1. `pdfkit` or `pdf-lib`: full layout, fonts and images; 1–2 MB of dependency for one template (§8: no large libraries without a reason).
2. Render HTML with a headless browser: not available on Vercel functions nor wanted in the worker.
3. Grow `lib/pdf.ts` by what an invoice needs: positioned text in two fonts, right alignment, rectangles, lines, pages.

## Decision

Option 3, ~190 lines. Right alignment needs text widths, so the writer carries the Adobe metrics of Helvetica and Helvetica-Bold for ASCII (amounts, the thing that must line up, are exact; accented letters take the width of their base letter). Text is encoded to WinAnsi with the handful of characters that sit outside Latin-1 (`€`, dashes, quotes). The QR comes from `qrcode` (already a dependency for 2FA) as a module matrix and is drawn as black rectangles, one per horizontal run: sharp at any zoom, no image support needed. A test rebuilds the matrix from the PDF operators and compares it module by module. The layout paginates: rows never split, the table header repeats, totals stay together, every page has "Página n de m". Text is still emitted as `(…) Tj`, which is what the development extractor reads.

## Consequences

- No logo on the invoice at this point (TD-076); added later without a library, see ADR 0035.
- Only Helvetica: characters outside WinAnsi (Cyrillic, CJK) still become `?`. Spanish, Catalan, Galician and Basque are covered.
- Issued invoices are immutable: those issued before this change keep their old PDF.
