import { useCallback, useState } from "react";
import {
	DEFAULT_READER_SETTINGS,
	type ReaderFontFamily,
	type ReaderSettings,
	type ReaderTheme,
	type ReaderViewMode,
} from "../core/types";

const SETTINGS_KEY = "epub-viewer:settings:v1";
const PROGRESS_PREFIX = "epub-viewer:progress:v1:";

export interface SavedBookProgress {
	readonly fileHash: string;
	readonly fileName: string;
	readonly title: string;
	readonly author: string;
	readonly cfi: string;
	readonly fraction: number;
	readonly label: string;
	readonly updatedAt: number;
}

function isValidViewMode(v: unknown): v is ReaderViewMode {
	return v === "two-column" || v === "single-column" || v === "scrolled";
}

function isValidTheme(v: unknown): v is ReaderTheme {
	return v === "light" || v === "sepia" || v === "dark";
}

function isValidFontFamily(v: unknown): v is ReaderFontFamily {
	return v === "publisher" || v === "serif" || v === "sans" || v === "mono";
}

export function loadStoredSettings(): ReaderSettings {
	try {
		const raw = localStorage.getItem(SETTINGS_KEY);
		if (!raw) return DEFAULT_READER_SETTINGS;
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		return {
			viewMode: isValidViewMode(parsed.viewMode)
				? parsed.viewMode
				: DEFAULT_READER_SETTINGS.viewMode,
			theme: isValidTheme(parsed.theme)
				? parsed.theme
				: DEFAULT_READER_SETTINGS.theme,
			fontFamily: isValidFontFamily(parsed.fontFamily)
				? parsed.fontFamily
				: DEFAULT_READER_SETTINGS.fontFamily,
			fontSizePercent:
				typeof parsed.fontSizePercent === "number" &&
				parsed.fontSizePercent >= 70 &&
				parsed.fontSizePercent <= 200
					? parsed.fontSizePercent
					: DEFAULT_READER_SETTINGS.fontSizePercent,
			lineHeight:
				typeof parsed.lineHeight === "number" &&
				parsed.lineHeight >= 1.1 &&
				parsed.lineHeight <= 2.4
					? parsed.lineHeight
					: DEFAULT_READER_SETTINGS.lineHeight,
		};
	} catch {
		return DEFAULT_READER_SETTINGS;
	}
}

export function saveStoredSettings(settings: ReaderSettings): void {
	try {
		localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
	} catch {
		// Ignore storage quota errors
	}
}

export function loadBookProgress(fileHash: string): SavedBookProgress | null {
	try {
		const raw = localStorage.getItem(`${PROGRESS_PREFIX}${fileHash}`);
		if (!raw) return null;
		return JSON.parse(raw) as SavedBookProgress;
	} catch {
		return null;
	}
}

export function saveBookProgress(progress: SavedBookProgress): void {
	try {
		localStorage.setItem(
			`${PROGRESS_PREFIX}${progress.fileHash}`,
			JSON.stringify(progress),
		);
	} catch {
		// Ignore storage quota errors
	}
}

export function useReadingStorage() {
	const [settings, setSettingsState] = useState<ReaderSettings>(() =>
		loadStoredSettings(),
	);

	const updateSettings = useCallback((patch: Partial<ReaderSettings>) => {
		setSettingsState((prev) => {
			const next: ReaderSettings = { ...prev, ...patch };
			saveStoredSettings(next);
			return next;
		});
	}, []);

	return {
		settings,
		updateSettings,
		loadBookProgress,
		saveBookProgress,
	};
}
