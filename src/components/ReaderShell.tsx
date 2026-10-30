import {
	ArrowLeft,
	Columns2,
	FileText,
	Info,
	List,
	ScrollText,
	Settings2,
} from "lucide-react";
import { useState } from "react";
import type {
	BookManifest,
	ReaderEngine,
	ReaderSettings,
	ReaderViewMode,
	RelocationEvent,
} from "../core/types";
import { BookInspectorModal } from "./BookInspectorModal";
import { EpubViewport } from "./EpubViewport";
import { ReaderSettingsPopover } from "./ReaderSettingsPopover";
import { TocDrawer } from "./TocDrawer";

export interface ReaderShellProps {
	readonly manifest: BookManifest;
	readonly engine: ReaderEngine;
	readonly relocation: RelocationEvent | null;
	readonly settings: ReaderSettings;
	readonly onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
	readonly chromeVisible: boolean;
	readonly tocOpen: boolean;
	readonly onSetTocOpen: (open: boolean) => void;
	readonly onCloseBook: () => void;
	readonly mountViewport: (
		container: HTMLDivElement | null,
	) => (() => void) | undefined;
}

const QUICK_VIEW_MODES: ReadonlyArray<{
	readonly id: ReaderViewMode;
	readonly title: string;
	readonly icon: typeof Columns2;
}> = [
	{ id: "two-column", title: "Two-Column Spread", icon: Columns2 },
	{ id: "single-column", title: "Single-Column Page", icon: FileText },
	{ id: "scrolled", title: "Continuous Scroll", icon: ScrollText },
];

export function ReaderShell({
	manifest,
	engine,
	relocation,
	settings,
	onUpdateSettings,
	chromeVisible,
	tocOpen,
	onSetTocOpen,
	onCloseBook,
	mountViewport,
}: ReaderShellProps) {
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [inspectorOpen, setInspectorOpen] = useState(false);
	const isFixedLayout = manifest.metadata.layout === "pre-paginated";

	const handleUpdateSettings = (patch: Partial<ReaderSettings>) => {
		if (isFixedLayout) {
			const safePatch = { ...patch };
			delete safePatch.fontFamily;
			delete safePatch.fontSizePercent;
			delete safePatch.lineHeight;
			if (safePatch.viewMode === "scrolled") {
				delete safePatch.viewMode;
			}
			if (Object.keys(safePatch).length > 0) {
				onUpdateSettings(safePatch);
			}
			return;
		}
		onUpdateSettings(patch);
	};

	const percent = Math.round((relocation?.fraction ?? 0) * 100);

	return (
		<div
			data-reader-theme={settings.theme}
			className="relative flex h-full w-full flex-col bg-surface text-ink overflow-hidden transition-colors duration-150"
		>
			{/* Top Bar */}
			<header
				className={`z-30 flex h-13 shrink-0 items-center justify-between border-b border-border-subtle bg-surface/95 px-4 backdrop-blur-xs transition-all duration-200 ${
					chromeVisible
						? "translate-y-0 opacity-100"
						: "-translate-y-full opacity-0 pointer-events-none absolute inset-x-0 top-0"
				}`}
			>
				<div className="flex items-center gap-2 min-w-0">
					<button
						type="button"
						onClick={onCloseBook}
						title="Back to Library"
						className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-elevated hover:text-ink transition-colors"
					>
						<ArrowLeft className="h-4 w-4" />
						<span className="hidden sm:inline">Library</span>
					</button>

					<div className="h-4 w-px bg-border-subtle mx-1" />

					<button
						type="button"
						onClick={() => onSetTocOpen(true)}
						title="Table of Contents"
						className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-surface-elevated transition-colors"
					>
						<List className="h-4 w-4 text-accent" />
						<span>Contents</span>
					</button>
				</div>

				<div className="flex flex-col items-center justify-center min-w-0 px-4 text-center">
					<h1 className="truncate text-sm font-semibold max-w-[36vw] sm:max-w-md">
						{manifest.metadata.title}
					</h1>
					<p className="truncate text-[11px] text-ink-muted max-w-[36vw] sm:max-w-md">
						{relocation?.label ?? manifest.metadata.author}
					</p>
				</div>

				<div className="flex items-center gap-1.5">
					<div
						role="toolbar"
						aria-label="View Mode Switcher"
						className="hidden md:flex items-center rounded-xl border border-border-subtle bg-surface-elevated/60 p-0.5"
					>
						{QUICK_VIEW_MODES.map((mode) => {
							const Icon = mode.icon;
							const active = settings.viewMode === mode.id;
							const isModeDisabled = isFixedLayout && mode.id === "scrolled";
							return (
								<button
									key={mode.id}
									type="button"
									disabled={isModeDisabled}
									title={
										isModeDisabled
											? "Continuous scroll is not available for fixed-layout books"
											: mode.title
									}
									onClick={() => {
										if (!isModeDisabled) {
											handleUpdateSettings({ viewMode: mode.id });
										}
									}}
									className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
										isModeDisabled
											? "opacity-35 cursor-not-allowed text-ink-muted"
											: active
												? "bg-accent text-white shadow-2xs"
												: "text-ink-muted hover:text-ink"
									}`}
								>
									<Icon className="h-3.5 w-3.5" />
								</button>
							);
						})}
					</div>

					<button
						type="button"
						aria-label="Inspect Book Metadata & Fonts"
						title="Book Metadata & Fonts"
						onClick={() => setInspectorOpen(true)}
						className={`inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-colors ${
							inspectorOpen
								? "bg-accent/15 text-accent"
								: "text-ink hover:bg-surface-elevated"
						}`}
					>
						<Info className="h-4 w-4" />
						<span className="hidden sm:inline">Inspect</span>
					</button>

					<button
						type="button"
						aria-label="Reader Settings"
						onClick={() => setSettingsOpen((prev) => !prev)}
						className={`inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-colors ${
							settingsOpen
								? "bg-accent/15 text-accent"
								: "text-ink hover:bg-surface-elevated"
						}`}
					>
						<Settings2 className="h-4 w-4" />
						<span className="hidden sm:inline">Appearance</span>
					</button>
				</div>
			</header>

			<ReaderSettingsPopover
				isOpen={settingsOpen}
				onClose={() => setSettingsOpen(false)}
				settings={settings}
				layoutMode={manifest.metadata.layout}
				onUpdateSettings={handleUpdateSettings}
			/>

			<BookInspectorModal
				isOpen={inspectorOpen}
				onClose={() => setInspectorOpen(false)}
				manifest={manifest}
			/>

			<TocDrawer
				isOpen={tocOpen}
				onClose={() => onSetTocOpen(false)}
				toc={manifest.toc}
				activeTocId={relocation?.tocItem?.id ?? null}
				metadata={manifest.metadata}
				onSelectHref={(href) => void engine.goToHref(href)}
				onOpenInspector={() => setInspectorOpen(true)}
			/>

			{/* Main Viewport Stage */}
			<EpubViewport
				mountViewport={mountViewport}
				onNext={() => void engine.next()}
				onPrev={() => void engine.prev()}
				showNavigationButtons={settings.viewMode !== "scrolled"}
			/>

			{/* Bottom Progress Scrubber Bar */}
			<footer
				className={`z-30 flex h-11 shrink-0 items-center justify-between gap-4 border-t border-border-subtle bg-surface/95 px-4 text-xs text-ink-muted backdrop-blur-xs transition-all duration-200 ${
					chromeVisible
						? "translate-y-0 opacity-100"
						: "translate-y-full opacity-0 pointer-events-none absolute inset-x-0 bottom-0"
				}`}
			>
				<div className="min-w-28 truncate font-medium">
					{relocation
						? settings.viewMode === "scrolled"
							? `Section ${String(relocation.sectionIndex + 1)} / ${String(relocation.sectionTotal)}`
							: `Page ${String(relocation.pageIndex + 1)} of ${String(relocation.pageCount)}`
						: "Loading…"}
				</div>

				<div className="flex flex-1 items-center gap-3 max-w-xl">
					<input
						type="range"
						aria-label="Reading Progress"
						min={0}
						max={1000}
						value={Math.round((relocation?.fraction ?? 0) * 1000)}
						onChange={(e) => {
							const val = Number.parseInt(e.target.value, 10);
							if (!Number.isNaN(val)) {
								void engine.goToFraction(val / 1000);
							}
						}}
						className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-border-subtle accent-accent"
					/>
				</div>

				<div className="min-w-16 text-right font-mono font-medium">
					{percent}%
				</div>
			</footer>
		</div>
	);
}
