# EPUB Viewer

A modern, privacy-focused EPUB reader running entirely in the browser. All book extraction, layout rendering, and reading progress tracking happen locally on your device without sending any data to an external server.


## Features

- Local & Private: Books are processed completely in memory in your browser.
- Broad EPUB Support: Handles both reflowable texts and pre-paginated fixed-layout publications.
- Reader Controls: Adjustable font families, font sizes, line heights, view modes, and color themes (light, sepia, and dark).
- Efficient Resource Streaming: Uses the native browser DecompressionStream API for on-demand asset loading.
- Local State Persistence: Automatically retains reading positions and viewer preferences across sessions.


## Tech Stack

- Runtime: Node.js 24 (LTS)
- Frontend: React 19, TypeScript, and Tailwind CSS v4
- Build Tooling: Vite
- Quality & Testing: Biome and Vitest


## Getting Started

### Prerequisites

Node.js 24 (LTS) or higher is required.

### Installation

Clone the repository and install dependencies:

```bash
npm install
```

### Development

Start the local development server:

```bash
npm run dev
```

### Production Build

Create an optimized static build in the `dist` folder:

```bash
npm run build
```

### Testing & Verification

Run the Vitest unit test suite:

```bash
npm test
```

Run Biome linting and formatting checks:

```bash
npm run check
```


## Deployment

Because the application is entirely static and client-side, the generated `dist` folder can be hosted on GitHub Pages or any static hosting platform. An automated deployment workflow is configured in `.github/workflows/deploy.yml`.

