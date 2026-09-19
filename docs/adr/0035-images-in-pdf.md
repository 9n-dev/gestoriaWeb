# 0035. Logo on the invoice: own PNG decoder, JPEG pass-through, WebP left out

Date: 2026-09-19 · Status: accepted

## Context

TD-076: the invoice header carried the gestoría's name and colour but not its logo — the most visible piece of white label on the one document that leaves the portal. Logos are uploaded as PNG, JPEG or WebP (max 1 MB). ADR 0034 predicted that images would be where a PDF library starts to pay for itself.

## Options

1. `pdf-lib`/`pdfkit` (embed PNG and JPEG; no WebP either).
2. `sharp` to normalise any logo to PNG/JPEG: native binary, heavy on the worker image and on Vercel functions.
3. Do it by hand: JPEG is already a PDF stream (`DCTDecode`); PNG needs decoding because PDF has no alpha inside an image — colour and transparency must be split into an image and a soft mask.

## Decision

Option 3, in `lib/pdf-image.ts` (~150 lines over `node:zlib`). JPEG: read the size from the frame header and embed the bytes untouched (greyscale and RGB; CMYK refused). PNG: inflate, undo the five row filters, read every colour type and bit depth (palette with `tRNS` included), and produce deflated RGB plus a deflated 8-bit `SMask` only when something is transparent. The writer gained `addImage` / `page.image` and emits binary streams through Latin-1 strings, which map bytes one to one. Decoding it turned out smaller than the glue a library would have needed, and the test suite drives it with an in-test PNG encoder so each filter and colour type is exercised on purpose; real Chromium-made PNG and JPEG logos were checked by rasterising the result.

Rules around it: only a logo the antivirus has marked `CLEAN` is used; it is read **before** the numbering transaction so the series lock is never held while the bucket answers; any failure (missing file, bucket down, undecodable image) yields an invoice without logo and an error report, never a failed issue. The legal name stays as text under the logo: the law asks for it and a logo is not text.

## Consequences

- WebP logos, interlaced PNGs, CMYK JPEGs and images over 4 megapixels do not reach the PDF (TD-077). The branding form tells the admin to use PNG or JPG.
- Decoded pixels live in memory while the PDF is built (at most 16 MB for the largest accepted image).
- Invoices already issued keep the PDF they were issued with.
