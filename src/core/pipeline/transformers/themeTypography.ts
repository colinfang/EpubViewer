import {
	assertNever,
	type ReaderFontFamily,
	type ReaderTheme,
} from "../../types";
import type { DocumentTransformContext } from "../index";

interface ThemePalette {
	readonly bg: string;
	readonly fg: string;
	readonly link: string;
}

export function getThemePalette(theme: ReaderTheme): ThemePalette {
	switch (theme) {
		case "light":
			return {
				bg: "#faf8f5",
				fg: "#1f2328",
				link: "#1d4ed8",
			};
		case "sepia":
			return {
				bg: "#f4ecd8",
				fg: "#3b2e1e",
				link: "#8b4513",
			};
		case "dark":
			return {
				bg: "#16181d",
				fg: "#e6e4df",
				link: "#60a5fa",
			};
		default:
			return assertNever(theme);
	}
}

export function getFontFamilyStack(
	fontFamily: ReaderFontFamily,
): string | null {
	switch (fontFamily) {
		case "publisher":
			return null;
		case "serif":
			return 'Georgia, "Iowan Old Style", Palatino, "Book Antiqua", serif';
		case "sans":
			return 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
		case "mono":
			return '"JetBrains Mono", "Fira Code", Consolas, monospace';
		default:
			return assertNever(fontFamily);
	}
}

const STYLE_TAG_ID = "epub-viewer-theme-typography";

export function themeTypographyTransformer(
	doc: Document,
	ctx: DocumentTransformContext,
): void {
	const head = doc.head ?? doc.querySelector("head") ?? doc.documentElement;
	if (!head) return;

	let styleEl = doc.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
	if (!styleEl) {
		styleEl = doc.createElement("style");
		styleEl.id = STYLE_TAG_ID;
		head.appendChild(styleEl);
	}

	if (ctx.bookMeta.layout === "pre-paginated") {
		styleEl.textContent = `
html, body {
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    -webkit-text-size-adjust: none;
}
`;
		return;
	}

	const palette = getThemePalette(ctx.settings.theme);
	const fontStack = getFontFamilyStack(ctx.settings.fontFamily);
	const fontRule = fontStack ? `font-family: ${fontStack} !important;` : "";

	styleEl.textContent = `
:root {
    --reader-bg: ${palette.bg};
    --reader-fg: ${palette.fg};
    --reader-link: ${palette.link};
    --reader-font-size: ${String(ctx.settings.fontSizePercent)}%;
    --reader-line-height: ${String(ctx.settings.lineHeight)};
    color-scheme: ${ctx.settings.theme === "dark" ? "dark" : "light"};
}

html, body {
    background-color: var(--reader-bg) !important;
    color: var(--reader-fg) !important;
    font-size: var(--reader-font-size) !important;
    line-height: var(--reader-line-height) !important;
    ${fontRule}
}

${
	fontStack
		? `p, div, span, li, blockquote, dd, dt {
    font-family: ${fontStack} !important;
    line-height: var(--reader-line-height) !important;
}`
		: `p, li, blockquote {
    line-height: var(--reader-line-height) !important;
}`
}

a, a:link, a:visited {
    color: var(--reader-link) !important;
}

img, svg, video {
    max-width: 100% !important;
    max-height: 82vh !important;
    height: auto !important;
    object-fit: contain;
    break-inside: avoid;
    page-break-inside: avoid;
}
`;
}
