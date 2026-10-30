# Requirements


## Implemented

- Archive Loading & Storage:
    - In-memory archive buffering (<= 64 MB) to eliminate mobile Android SAF latency, with lazy streaming ZIP fallback for large files (> 64 MB).
    - Local file loading (drag-and-drop or file picker) with streaming ZIP decompression, zero-copy uncompressed blob slicing, and concurrent font extraction.
    - Automatic reading position and appearance settings saved per book in localStorage.

- Reading Views & Layout Engines:
    - View modes: Two-column spread, single-column page, and continuous scroll.
    - Rendition support: Dynamic reflowable text and fixed-layout (pre-paginated) EPUB rendering.
    - Architecture: Native engine modules (`src/core/engine/`) ported from `foliate-js` with upstream provenance tracking.
    - Themes (Light, Sepia, Dark) and typography controls (font family, size, line spacing).
    - Fixed layout: Typography overrides and continuous scroll are locked to preserve page layout.

- Navigation & Controls:
    - Book structure & progress: Collapsible Table of Contents drawer with chapter hierarchy, and bottom scrubber bar with section tracking and percentage readout.
    - Paginated page turning: Touch tap on outer zones, mouse wheel, keyboard arrows, and floating navigation arrows; center tap and mouse clicks toggle UI chrome to preserve text selection.
    - Continuous scroll navigation: Seamless vertical scrolling across chapter boundaries via touch, wheel, and keyboard; floating navigation arrows automatically hidden.

- Book Metadata & Font Inspector:
    - Specification & layout: EPUB version, layout mode (fixed vs reflowable), and native viewport dimensions.
    - Package asset statistics: Spine section counts, image assets, stylesheets, and total archive entry count.
    - Embedded font analysis: Real-time font search, file size tracking, and format categorization (OpenType, TrueType, WOFF, WOFF2).
    - Binary font table parsing: Reads SFNT `name` tables to recover original typeface family names, full names, and weights from minified font files.


## Planned

- Content & Annotations:
    - Full-text in-book search with snippet previews and match navigation.
    - Text highlights, annotations, and bookmarks with Markdown export.
    - Inline footnote and citation preview popovers.
    - Image zoom and pan modal for illustrations.
    - Quick dictionary definitions and translations for selected words.

- Library & Storage:
    - Bookshelf library view with local file persistence (OPFS or IndexedDB).
    - Offline PWA support with OS file association and WebDAV sync.

- Advanced Reading & Accessibility:
    - Custom font uploads, margin controls, and OLED black theme.
    - Text-to-speech audio narration with synchronized sentence tracking.
