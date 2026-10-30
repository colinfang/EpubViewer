export type Result<T, E = string> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
	return { ok: true, value };
}

export function err<E = string>(error: E): Result<never, E> {
	return { ok: false, error };
}

export function assertNever(value: never, message?: string): never {
	throw new Error(message ?? `Unexpected value: ${String(value)}`);
}

export type ReaderViewMode = "two-column" | "single-column" | "scrolled";

export type ReaderTheme = "light" | "sepia" | "dark";

export type ReaderFontFamily = "publisher" | "serif" | "sans" | "mono";

export interface ReaderSettings {
	readonly viewMode: ReaderViewMode;
	readonly theme: ReaderTheme;
	readonly fontFamily: ReaderFontFamily;
	readonly fontSizePercent: number;
	readonly lineHeight: number;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
	viewMode: "two-column",
	theme: "light",
	fontFamily: "publisher",
	fontSizePercent: 100,
	lineHeight: 1.6,
};

export type BookLayoutMode = "reflowable" | "pre-paginated";

export type PageSpreadPosition = "left" | "right" | "center" | "none";

export type EmbeddedFontFormat =
	| "OpenType"
	| "TrueType"
	| "WOFF"
	| "WOFF2"
	| "Generic Font";

export interface ParsedFontNames {
	readonly familyName?: string | undefined;
	readonly fullName?: string | undefined;
	readonly subfamily?: string | undefined;
}

export interface EmbeddedFontInfo {
	readonly name: string;
	readonly path: string;
	readonly mediaType: string;
	readonly format: EmbeddedFontFormat;
	readonly sizeBytes: number;
	readonly fontFamily?: string | undefined;
	readonly fullName?: string | undefined;
	readonly subfamily?: string | undefined;
}

export interface BookPackageStats {
	readonly spineCount: number;
	readonly imageCount: number;
	readonly fontCount: number;
	readonly cssCount: number;
	readonly totalEntriesCount: number;
}

export interface BookMetadata {
	readonly identifier: string;
	readonly title: string;
	readonly author: string;
	readonly publisher: string;
	readonly language: string;
	readonly description: string;
	readonly layout: BookLayoutMode;
	readonly spread: "auto" | "none" | "both" | "landscape";
	readonly orientation: "auto" | "portrait" | "landscape";
	readonly direction: "ltr" | "rtl";
	readonly coverBlobUrl: string | null;
	readonly epubVersion: string;
	readonly viewportDimensions: {
		readonly width: number;
		readonly height: number;
	} | null;
	readonly embeddedFonts: ReadonlyArray<EmbeddedFontInfo>;
	readonly stats: BookPackageStats;
}

export interface TocItem {
	readonly id: string;
	readonly label: string;
	readonly href: string;
	readonly subitems: ReadonlyArray<TocItem>;
}

export interface SpineSection {
	readonly index: number;
	readonly id: string;
	readonly href: string;
	readonly linear: boolean;
	readonly pageSpread: PageSpreadPosition;
	readonly sizeBytes: number;
	readonly loadDocument: () => Promise<Document>;
	readonly createUrl: () => Promise<string>;
	readonly resolveHref: (relativeHref: string) => string;
	readonly unload: () => void;
}

export interface BookManifest {
	readonly fileHash: string;
	readonly fileName: string;
	readonly fileSize: number;
	readonly metadata: BookMetadata;
	readonly toc: ReadonlyArray<TocItem>;
	readonly spine: ReadonlyArray<SpineSection>;
	readonly loadFontDetails?: (
		path: string,
	) => Promise<ParsedFontNames | null>;
	readonly resolveHrefToSpine: (href: string) => {
		readonly index: number;
		readonly anchor: string | null;
	} | null;
	readonly destroy: () => void;
}

export interface RelocationEvent {
	readonly cfi: string;
	readonly fraction: number;
	readonly sectionIndex: number;
	readonly sectionTotal: number;
	readonly pageIndex: number;
	readonly pageCount: number;
	readonly tocItem: TocItem | null;
	readonly label: string;
}

export interface ReaderInputEvent {
	readonly type: "next" | "prev" | "toggle-chrome";
}

export interface ReaderEngine {
	mount(container: HTMLElement, initialCfi?: string): Promise<void>;
	next(): Promise<void>;
	prev(): Promise<void>;
	goToHref(href: string): Promise<void>;
	goToFraction(fraction: number): Promise<void>;
	goToCfi(cfi: string): Promise<void>;
	applySettings(settings: ReaderSettings): Promise<void>;
	onRelocate(listener: (event: RelocationEvent) => void): () => void;
	onInput(listener: (event: ReaderInputEvent) => void): () => void;
	destroy(): void;
}
