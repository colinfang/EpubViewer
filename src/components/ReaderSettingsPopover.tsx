import {
	Columns2,
	FileText,
	Lock,
	Minus,
	Moon,
	Plus,
	ScrollText,
	Sun,
	Sunset,
} from "lucide-react";
import type {
	BookLayoutMode,
	ReaderFontFamily,
	ReaderSettings,
	ReaderTheme,
	ReaderViewMode,
} from "../core/types";
import { APP_VERSION } from "../version";

export interface ReaderSettingsPopoverProps {
	readonly isOpen: boolean;
	readonly onClose: () => void;
	readonly settings: ReaderSettings;
	readonly layoutMode: BookLayoutMode;
	readonly onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
}

const VIEW_MODES: ReadonlyArray<{
	readonly id: ReaderViewMode;
	readonly label: string;
	readonly icon: typeof Columns2;
}> = [
	{ id: "two-column", label: "2-Col Spread", icon: Columns2 },
	{ id: "single-column", label: "1-Col Page", icon: FileText },
	{ id: "scrolled", label: "Scroll", icon: ScrollText },
];

const THEMES: ReadonlyArray<{
	readonly id: ReaderTheme;
	readonly label: string;
	readonly icon: typeof Sun;
	readonly previewClass: string;
}> = [
	{
		id: "light",
		label: "Light",
		icon: Sun,
		previewClass: "bg-[#faf8f5] text-[#1f2328] border-neutral-300",
	},
	{
		id: "sepia",
		label: "Sepia",
		icon: Sunset,
		previewClass: "bg-[#f4ecd8] text-[#3b2e1e] border-amber-300",
	},
	{
		id: "dark",
		label: "Dark",
		icon: Moon,
		previewClass: "bg-[#16181d] text-[#e6e4df] border-neutral-700",
	},
];

const FONT_FAMILIES: ReadonlyArray<{
	readonly id: ReaderFontFamily;
	readonly label: string;
}> = [
	{ id: "publisher", label: "Publisher" },
	{ id: "serif", label: "Serif" },
	{ id: "sans", label: "Sans" },
	{ id: "mono", label: "Mono" },
];

export function ReaderSettingsPopover({
	isOpen,
	onClose,
	settings,
	layoutMode,
	onUpdateSettings,
}: ReaderSettingsPopoverProps) {
	if (!isOpen) return null;

	const isFixedLayout = layoutMode === "pre-paginated";

	return (
		<>
			<div
				className="fixed inset-0 z-40"
				onClick={onClose}
				aria-hidden="true"
			/>
			<div
				role="dialog"
				aria-label="Reader Settings"
				className="absolute right-4 top-14 z-50 w-80 rounded-2xl border border-border-subtle bg-surface p-4 text-ink shadow-2xl space-y-4"
			>
				<div className="space-y-2">
					<span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
						Layout Mode
					</span>
					<div className="grid grid-cols-3 gap-1.5">
						{VIEW_MODES.map((mode) => {
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
											: undefined
									}
									onClick={() => {
										if (!isModeDisabled) {
											onUpdateSettings({ viewMode: mode.id });
										}
									}}
									className={`flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-medium transition-all ${
										isModeDisabled
											? "cursor-not-allowed border-border-subtle bg-surface-elevated/30 text-ink-muted opacity-40"
											: active
												? "border-accent bg-accent/15 text-accent"
												: "border-border-subtle bg-surface-elevated/60 text-ink hover:bg-surface-elevated"
									}`}
								>
									<Icon className="h-4 w-4" />
									<span>{mode.label}</span>
								</button>
							);
						})}
					</div>
				</div>

				<div className="space-y-2">
					<span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
						Color Theme
					</span>
					<div className="grid grid-cols-3 gap-2">
						{THEMES.map((theme) => {
							const Icon = theme.icon;
							const active = settings.theme === theme.id;
							return (
								<button
									key={theme.id}
									type="button"
									onClick={() => onUpdateSettings({ theme: theme.id })}
									className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-all ${
										theme.previewClass
									} ${active ? "ring-2 ring-accent" : "opacity-80 hover:opacity-100"}`}
								>
									<Icon className="h-3.5 w-3.5" />
									<span>{theme.label}</span>
								</button>
							);
						})}
					</div>
				</div>

				{isFixedLayout && (
					<div className="rounded-xl border border-border-subtle bg-surface-elevated/60 p-3 text-xs text-ink-muted flex items-start gap-2.5">
						<Lock className="h-4 w-4 text-accent shrink-0 mt-0.5" />
						<div>
							<div className="font-semibold text-ink">Typography Locked</div>
							<p className="mt-0.5 leading-relaxed">
								This book uses a <strong>Fixed-Layout</strong> design. Typeface,
								font size, and line spacing cannot be overridden to preserve the
								publisher’s page illustration layout.
							</p>
						</div>
					</div>
				)}

				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
							Typeface
						</span>
						{isFixedLayout && (
							<span className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-muted">
								<Lock className="h-3 w-3" /> Locked
							</span>
						)}
					</div>
					<div className="grid grid-cols-2 gap-1.5">
						{FONT_FAMILIES.map((font) => {
							const active =
								(isFixedLayout ? "publisher" : settings.fontFamily) === font.id;
							return (
								<button
									key={font.id}
									type="button"
									disabled={isFixedLayout}
									title={
										isFixedLayout
											? "Typeface is locked for fixed-layout books"
											: undefined
									}
									onClick={() => {
										if (!isFixedLayout) {
											onUpdateSettings({ fontFamily: font.id });
										}
									}}
									className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition-all ${
										isFixedLayout
											? active
												? "cursor-not-allowed border-accent/40 bg-accent/10 text-accent/70"
												: "cursor-not-allowed border-border-subtle bg-surface-elevated/30 text-ink-muted/50"
											: active
												? "border-accent bg-accent/15 text-accent"
												: "border-border-subtle bg-surface-elevated/60 text-ink hover:bg-surface-elevated"
									}`}
								>
									{font.label}
								</button>
							);
						})}
					</div>
				</div>

				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
							Font Size
						</span>
						<span className="text-xs font-mono text-ink-muted">
							{isFixedLayout ? "Original" : `${settings.fontSizePercent}%`}
						</span>
					</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							aria-label="Decrease font size"
							disabled={isFixedLayout}
							title={
								isFixedLayout
									? "Font size is locked for fixed-layout books"
									: undefined
							}
							onClick={() => {
								if (!isFixedLayout) {
									onUpdateSettings({
										fontSizePercent: Math.max(
											70,
											settings.fontSizePercent - 10,
										),
									});
								}
							}}
							className={`flex flex-1 items-center justify-center rounded-xl border border-border-subtle py-2 ${
								isFixedLayout
									? "cursor-not-allowed bg-surface-elevated/30 text-ink-muted/50"
									: "bg-surface-elevated/60 hover:bg-surface-elevated"
							}`}
						>
							<Minus className="h-4 w-4" />
						</button>
						<button
							type="button"
							disabled={isFixedLayout}
							title={
								isFixedLayout
									? "Font size is locked for fixed-layout books"
									: undefined
							}
							onClick={() => {
								if (!isFixedLayout) {
									onUpdateSettings({ fontSizePercent: 100 });
								}
							}}
							className={`rounded-xl border border-border-subtle px-3 py-2 text-xs font-medium ${
								isFixedLayout
									? "cursor-not-allowed bg-surface-elevated/30 text-ink-muted/50"
									: "bg-surface-elevated/60 hover:bg-surface-elevated"
							}`}
						>
							Reset
						</button>
						<button
							type="button"
							aria-label="Increase font size"
							disabled={isFixedLayout}
							title={
								isFixedLayout
									? "Font size is locked for fixed-layout books"
									: undefined
							}
							onClick={() => {
								if (!isFixedLayout) {
									onUpdateSettings({
										fontSizePercent: Math.min(
											200,
											settings.fontSizePercent + 10,
										),
									});
								}
							}}
							className={`flex flex-1 items-center justify-center rounded-xl border border-border-subtle py-2 ${
								isFixedLayout
									? "cursor-not-allowed bg-surface-elevated/30 text-ink-muted/50"
									: "bg-surface-elevated/60 hover:bg-surface-elevated"
							}`}
						>
							<Plus className="h-4 w-4" />
						</button>
					</div>
				</div>

				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
							Line Spacing
						</span>
						<span className="text-xs font-mono text-ink-muted">
							{isFixedLayout ? "Original" : settings.lineHeight.toFixed(1)}
						</span>
					</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							aria-label="Decrease line spacing"
							disabled={isFixedLayout}
							title={
								isFixedLayout
									? "Line spacing is locked for fixed-layout books"
									: undefined
							}
							onClick={() => {
								if (!isFixedLayout) {
									onUpdateSettings({
										lineHeight:
											Math.round(
												Math.max(1.2, settings.lineHeight - 0.1) * 10,
											) / 10,
									});
								}
							}}
							className={`flex flex-1 items-center justify-center rounded-xl border border-border-subtle py-2 ${
								isFixedLayout
									? "cursor-not-allowed bg-surface-elevated/30 text-ink-muted/50"
									: "bg-surface-elevated/60 hover:bg-surface-elevated"
							}`}
						>
							<Minus className="h-4 w-4" />
						</button>
						<button
							type="button"
							aria-label="Increase line spacing"
							disabled={isFixedLayout}
							title={
								isFixedLayout
									? "Line spacing is locked for fixed-layout books"
									: undefined
							}
							onClick={() => {
								if (!isFixedLayout) {
									onUpdateSettings({
										lineHeight:
											Math.round(
												Math.min(2.2, settings.lineHeight + 0.1) * 10,
											) / 10,
									});
								}
							}}
							className={`flex flex-1 items-center justify-center rounded-xl border border-border-subtle py-2 ${
								isFixedLayout
									? "cursor-not-allowed bg-surface-elevated/30 text-ink-muted/50"
									: "bg-surface-elevated/60 hover:bg-surface-elevated"
							}`}
						>
							<Plus className="h-4 w-4" />
						</button>
					</div>
				</div>

				<div className="pt-2 border-t border-border-subtle/50 text-[11px] text-ink-muted text-center font-mono">
					v{APP_VERSION}
				</div>
			</div>
		</>
	);
}
