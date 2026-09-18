# 0016. HEIC photos are converted with `heic-convert`, in the worker only

Date: 2026-09-19 · Status: accepted

## Context

§6.3 requires accepting HEIC (iPhone photos) and converting it on the server. Browsers other than Safari cannot decode HEIC, so managers could not preview it. `sharp`'s prebuilt binaries ship without HEVC for patent reasons.

## Options

1. `sharp` with a custom libvips build: fast, but a native toolchain to maintain on every platform.
2. An external conversion API: another processor of personal data.
3. `heic-convert` (libheif compiled to WebAssembly, ~8.5 MB): pure JS, slower, no native code.

## Decision

`heic-convert`, imported only by `src/jobs/worker.ts`. It never enters the Next.js bundle, so Vercel function size is unaffected. The SHA-256 used for duplicate detection is taken from the original bytes, before conversion.

## Consequences

- A 12 MP photo takes a few seconds of CPU in the worker; acceptable for an asynchronous job.
- This is the 'large library' exception CLAUDE.md §8.7 asks to justify. Conversion sits behind `ProcessingDeps.convertHeicToJpeg`, so swapping it is a one-line change.
