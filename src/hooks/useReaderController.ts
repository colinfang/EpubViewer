import { useCallback, useEffect, useRef, useState } from "react";
import { loadEpubFromFile } from "../core/archive/epubLoader";
import { createReaderEngine } from "../core/engine/readerEngine";
import type {
	BookManifest,
	ReaderEngine,
	ReaderSettings,
	RelocationEvent,
} from "../core/types";
import { type SavedBookProgress, useReadingStorage } from "./useReadingStorage";

export type ReaderState =
	| { readonly status: "idle" }
	| { readonly status: "loading"; readonly fileName: string }
	| { readonly status: "error"; readonly message: string }
	| {
			readonly status: "ready";
			readonly manifest: BookManifest;
			readonly engine: ReaderEngine;
	  };

export function useReaderController() {
	const { settings, updateSettings, loadBookProgress, saveBookProgress } =
		useReadingStorage();
	const [readerState, setReaderState] = useState<ReaderState>({
		status: "idle",
	});
	const [relocation, setRelocation] = useState<RelocationEvent | null>(null);
	const [chromeVisible, setChromeVisible] = useState<boolean>(true);
	const [tocOpen, setTocOpen] = useState<boolean>(false);

	const activeEngineRef = useRef<ReaderEngine | null>(null);
	const activeManifestRef = useRef<BookManifest | null>(null);
	const settingsRef = useRef<ReaderSettings>(settings);
	settingsRef.current = settings;
	const lastRelocationRef = useRef<RelocationEvent | null>(null);
	const isRestoringRef = useRef<boolean>(true);
	const saveTimerRef = useRef<number | null>(null);
	const pendingSaveRef = useRef<SavedBookProgress | null>(null);

	const flushPendingSave = useCallback(() => {
		if (saveTimerRef.current !== null) {
			clearTimeout(saveTimerRef.current);
			saveTimerRef.current = null;
		}
		if (pendingSaveRef.current !== null) {
			saveBookProgress(pendingSaveRef.current);
			pendingSaveRef.current = null;
		}
	}, [saveBookProgress]);

	const debouncedSaveBookProgress = useCallback(
		(progress: SavedBookProgress) => {
			pendingSaveRef.current = progress;
			if (saveTimerRef.current !== null) {
				clearTimeout(saveTimerRef.current);
			}
			saveTimerRef.current = window.setTimeout(() => {
				saveTimerRef.current = null;
				if (pendingSaveRef.current) {
					saveBookProgress(pendingSaveRef.current);
					pendingSaveRef.current = null;
				}
			}, 300);
		},
		[saveBookProgress],
	);

	const cleanupCurrentBook = useCallback(() => {
		flushPendingSave();
		if (activeEngineRef.current) {
			activeEngineRef.current.destroy();
			activeEngineRef.current = null;
		}
		if (activeManifestRef.current) {
			activeManifestRef.current.destroy();
			activeManifestRef.current = null;
		}
		setRelocation(null);
		setTocOpen(false);
	}, [flushPendingSave]);

	const openFile = useCallback(
		async (file: Blob & { readonly name?: string }) => {
			cleanupCurrentBook();
			const fileName = file.name ?? "book.epub";
			setReaderState({ status: "loading", fileName });

			const result = await loadEpubFromFile(file);
			if (!result.ok) {
				setReaderState({ status: "error", message: result.error });
				return;
			}

			const manifest = result.value;
			const engine = createReaderEngine({
				manifest,
				initialSettings: settingsRef.current,
			});

			activeManifestRef.current = manifest;
			activeEngineRef.current = engine;

			isRestoringRef.current = true;

			engine.onRelocate((event) => {
				lastRelocationRef.current = event;
				setRelocation(event);
				if (!isRestoringRef.current) {
					debouncedSaveBookProgress({
						fileHash: manifest.fileHash,
						fileName: manifest.fileName,
						title: manifest.metadata.title,
						author: manifest.metadata.author,
						cfi: event.cfi,
						fraction: event.fraction,
						label: event.label,
						updatedAt: Date.now(),
					});
				}
			});

			engine.onInput((inputEvent) => {
				if (inputEvent.type === "next") {
					void engine.next();
				} else if (inputEvent.type === "prev") {
					void engine.prev();
				} else if (inputEvent.type === "toggle-chrome") {
					setChromeVisible((prev) => !prev);
				}
			});

			setReaderState({
				status: "ready",
				manifest,
				engine,
			});
		},
		[cleanupCurrentBook, debouncedSaveBookProgress],
	);

	const closeBook = useCallback(() => {
		cleanupCurrentBook();
		setReaderState({ status: "idle" });
	}, [cleanupCurrentBook]);

	useEffect(() => {
		if (activeEngineRef.current) {
			void activeEngineRef.current.applySettings(settings);
		}
	}, [settings]);

	useEffect(() => {
		return () => {
			cleanupCurrentBook();
		};
	}, [cleanupCurrentBook]);

	const mountViewport = useCallback(
		(container: HTMLDivElement | null) => {
			if (!container || readerState.status !== "ready") {
				return;
			}
			const { engine, manifest } = readerState;
			let cancelled = false;

			void (async () => {
				const saved = loadBookProgress(manifest.fileHash);
				const targetCfi = saved?.cfi;
				await engine.mount(container, targetCfi);
				if (cancelled) return;
				isRestoringRef.current = false;
				const currentRelocation = lastRelocationRef.current;
				if (currentRelocation) {
					debouncedSaveBookProgress({
						fileHash: manifest.fileHash,
						fileName: manifest.fileName,
						title: manifest.metadata.title,
						author: manifest.metadata.author,
						cfi: currentRelocation.cfi,
						fraction: currentRelocation.fraction,
						label: currentRelocation.label,
						updatedAt: Date.now(),
					});
				}
			})();

			return () => {
				cancelled = true;
			};
		},
		[debouncedSaveBookProgress, loadBookProgress, readerState],
	);

	return {
		readerState,
		relocation,
		settings,
		updateSettings,
		chromeVisible,
		setChromeVisible,
		tocOpen,
		setTocOpen,
		openFile,
		closeBook,
		mountViewport,
	};
}
