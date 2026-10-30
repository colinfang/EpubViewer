# Project Guidelines

This project is a standalone, local EPUB reader built with a modern web tech stack:

- Stack: Node.js 24 (LTS), React 19, TypeScript 6+, Vite 7, and Tailwind CSS v4.
- TypeScript: Target ES2025 with strict types and type-erasable syntax (`erasableSyntaxOnly`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`).
- Quality & Testing: Biome for formatting and linting, Vitest for unit testing.
- Web Standards: Native DecompressionStream for lazy ZIP streaming, Shadow DOM for style isolation, ResizeObserver, and Web Crypto API.


## Mobile & Android Storage Performance

On Android, every read or stream from an `<input type="file">` handle (including `file.slice()`, `file.stream()`, `FileReader`, and `blob:` URLs pointing to the file) incurs a 3–4 second latency penalty over SAF Binder IPC:

- Avoid repeated or micro-sliced disk reads: Buffer archives <= 64 MB into memory upfront in `loadEpubFromFile`, and use lazy streaming slice reads only for files > 64 MB.


## Requirements

For the current implementation status and planned features, refer to [Requirements.md](./Requirements.md).


## Foliate-js Reference

Upstream [`foliate-js`](https://github.com/johnfactotum/foliate-js) serves strictly as an algorithmic implementation reference for reader engine code under [`src/core/engine/`](./src/core/engine/) (CFI, pagination, and fixed-layout):

- Consult `foliate-js` first when implementing or improving reader layout/engine features (e.g. pagination, text search, highlights, CFI) rather than reinventing algorithms.
- Keep engine code native in TypeScript under `src/core/engine/`—never vendor raw upstream files or add `foliate-js` as a package.
- Ignore non-EPUB formats (MOBI, FB2, CBZ, PDF) and extraneous UI components.
