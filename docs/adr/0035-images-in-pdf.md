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

## Addendum (same day): normalise at the source

Rather than teaching the server more formats, the branding form now re-encodes in the browser — which can decode anything it can display — whatever `pdfImageFrom` would refuse: WebP, interlaced PNG, CMYK JPEG, and images over 4 megapixels (scaled down). The result is a plain PNG with its transparency, swapped into the file input before the form is sent (`components/branding/normalise-logo.ts`). Fine logos go up untouched. The server keeps accepting WebP and keeps its fallback, so nothing depends on the browser behaving. The decoder also gained colour-key transparency (`tRNS` on greyscale and RGB), and the signature certificate got the same treatment as the invoice: logo, brand colour and a laid-out page.

## Second addendum: the server does the rest, and WebP goes

Closing TD-078 turned up the real state of WebP: the branding service accepted it, but the file pipeline every upload goes through (`processFile`, type sniffed from bytes) has never known WebP, so the worker deleted such a logo from the bucket seconds after it was stored. There were no working WebP logos to migrate. The honest fix is one rule in one place: **branding images are PNG or JPEG**, refused otherwise with a message that says so; the form keeps offering WebP in the file picker because it converts it before sending.

With WebP out, the server was taught the remaining variants instead of depending on the browser: Adam7 interlaced PNGs (seven passes scattered into the full image; checked pixel for pixel against files written by ImageMagick, in `fixtures/logos/`), CMYK JPEGs (`/DeviceCMYK` with the inverted `/Decode` that print tools expect; checked by rasterising), and a box filter that shrinks decoded logos to about 300 dpi of their printed size, weighting colour by alpha so transparent pixels do not stain the edges — a 4-megapixel logo no longer adds its weight to every invoice.

## Consequences

- See the second addendum: nothing is left falling back except a PNG over 4 megapixels uploaded without JavaScript.
- Decoded pixels live in memory while the PDF is built (at most 16 MB for the largest accepted image).
- Invoices already issued keep the PDF they were issued with.
