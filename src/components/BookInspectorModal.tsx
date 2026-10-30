import {
	BookOpen,
	FileCode,
	FileText,
	Image as ImageIcon,
	Info,
	Layers,
	Search,
	Type,
	X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
	BookManifest,
	EmbeddedFontFormat,
	EmbeddedFontInfo,
	ParsedFontNames,
} from "../core/types";

export interface BookInspectorModalProps {
	readonly isOpen: boolean;
	readonly onClose: () => void;
	readonly manifest: BookManifest;
}

type InspectorTab = "layout" | "fonts" | "assets";

function formatBytes(bytes: number): string {
	if (bytes <= 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	const val = bytes / k ** i;
	return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${sizes[i] ?? "B"}`;
}

function getFormatBadgeClass(format: EmbeddedFontFormat): string {
	switch (format) {
		case "OpenType":
			return "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30";
		case "TrueType":
			return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
		case "WOFF":
		case "WOFF2":
			return "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30";
		default:
			return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";
	}
}

function cleanDescription(raw: string): string {
	if (!raw) return "";
	if (typeof DOMParser !== "undefined") {
		const doc = new DOMParser().parseFromString(raw, "text/html");
		const text = doc.body.textContent ?? "";
		if (text.includes("&#") || text.includes("&amp;")) {
			const secondPass = new DOMParser().parseFromString(text, "text/html");
			return secondPass.body.textContent ?? text;
		}
		return text;
	}
	return raw
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function BookInspectorModal({
	isOpen,
	onClose,
	manifest,
}: BookInspectorModalProps) {
	const [activeTab, setActiveTab] = useState<InspectorTab>("layout");
	const [fontSearch, setFontSearch] = useState("");
	const [dynamicFontDetails, setDynamicFontDetails] = useState<
		Record<string, ParsedFontNames>
	>({});

	useEffect(() => {
		if (!isOpen || activeTab !== "fonts" || !manifest.loadFontDetails) return;
		let cancelled = false;

		const pending = manifest.metadata.embeddedFonts.filter(
			(f) => !f.fontFamily && !dynamicFontDetails[f.path],
		);
		if (pending.length === 0) return;

		// Asynchronously resolve fonts in the background
		void (async () => {
			for (const font of pending) {
				if (cancelled) break;
				try {
					const details = await manifest.loadFontDetails?.(font.path);
					if (details && !cancelled) {
						setDynamicFontDetails((prev) => ({
							...prev,
							[font.path]: details,
						}));
					}
				} catch {
					// Ignore individual font read errors
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [isOpen, activeTab, manifest, dynamicFontDetails]);

	useEffect(() => {
		if (!isOpen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, onClose]);

	const { metadata } = manifest;

	const filteredFonts = useMemo(() => {
		const query = fontSearch.trim().toLowerCase();
		if (!query) return metadata.embeddedFonts;
		return metadata.embeddedFonts.filter((font: EmbeddedFontInfo) => {
			const dyn = dynamicFontDetails[font.path];
			return (
				font.name.toLowerCase().includes(query) ||
				font.path.toLowerCase().includes(query) ||
				font.format.toLowerCase().includes(query) ||
				Boolean(font.fontFamily?.toLowerCase().includes(query)) ||
				Boolean(dyn?.familyName?.toLowerCase().includes(query)) ||
				Boolean(font.fullName?.toLowerCase().includes(query)) ||
				Boolean(dyn?.fullName?.toLowerCase().includes(query))
			);
		});
	}, [metadata.embeddedFonts, fontSearch, dynamicFontDetails]);

	const fontFormatCounts = useMemo(() => {
		const counts: Record<string, number> = {};
		for (const font of metadata.embeddedFonts) {
			counts[font.format] = (counts[font.format] ?? 0) + 1;
		}
		return counts;
	}, [metadata.embeddedFonts]);

	if (!isOpen) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
			<button
				type="button"
				className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity cursor-default"
				onClick={onClose}
				aria-label="Close Inspector dialog"
			/>

			<dialog
				open
				aria-labelledby="inspector-modal-title"
				className="relative z-10 m-0 flex h-[85vh] max-h-[720px] w-full max-w-3xl flex-col rounded-2xl border border-border-subtle bg-surface p-0 text-ink shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 backdrop:bg-transparent"
			>
				{/* Header */}
				<div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-6 py-4">
					<div className="flex items-center gap-3 min-w-0">
						<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent">
							<Info className="h-5 w-5" />
						</div>
						<div className="min-w-0">
							<h2
								id="inspector-modal-title"
								className="text-sm font-semibold truncate"
							>
								Book Inspector & Metadata
							</h2>
							<p className="text-xs text-ink-muted truncate max-w-sm sm:max-w-md">
								{metadata.title}
							</p>
						</div>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close Dialog"
						className="rounded-xl p-2 text-ink-muted hover:bg-surface-elevated hover:text-ink transition-colors"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				{/* Navigation Tabs */}
				<div className="flex shrink-0 items-center gap-1 border-b border-border-subtle bg-surface-elevated/40 px-6 pt-2">
					<button
						type="button"
						onClick={() => setActiveTab("layout")}
						className={`flex items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
							activeTab === "layout"
								? "border-accent text-accent font-semibold"
								: "border-transparent text-ink-muted hover:text-ink"
						}`}
					>
						<BookOpen className="h-3.5 w-3.5" />
						<span>Layout & Rendition</span>
					</button>

					<button
						type="button"
						onClick={() => setActiveTab("fonts")}
						className={`flex items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
							activeTab === "fonts"
								? "border-accent text-accent font-semibold"
								: "border-transparent text-ink-muted hover:text-ink"
						}`}
					>
						<Type className="h-3.5 w-3.5" />
						<span>Embedded Fonts</span>
						<span className="ml-1 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
							{metadata.embeddedFonts.length}
						</span>
					</button>

					<button
						type="button"
						onClick={() => setActiveTab("assets")}
						className={`flex items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
							activeTab === "assets"
								? "border-accent text-accent font-semibold"
								: "border-transparent text-ink-muted hover:text-ink"
						}`}
					>
						<Layers className="h-3.5 w-3.5" />
						<span>Package Assets</span>
					</button>
				</div>

				{/* Tab Content Body */}
				<div className="flex-1 overflow-y-auto p-6 space-y-6">
					{activeTab === "layout" && (
						<div className="space-y-6">
							{/* Key Highlights */}
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
								<div className="rounded-xl border border-border-subtle bg-surface-elevated/50 p-4 space-y-1.5">
									<div className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
										EPUB Specification
									</div>
									<div className="flex items-center gap-2">
										<span className="text-base font-bold">
											EPUB {metadata.epubVersion}
										</span>
									</div>
									<div className="text-xs text-ink-muted">
										Parsed from root package identifier in OPF manifest.
									</div>
								</div>

								<div className="rounded-xl border border-border-subtle bg-surface-elevated/50 p-4 space-y-1.5">
									<div className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
										Rendition Layout
									</div>
									<div className="flex items-center gap-2">
										<span className="text-base font-bold capitalize">
											{metadata.layout === "pre-paginated"
												? "Fixed-Layout (Pre-paginated)"
												: "Reflowable Layout"}
										</span>
									</div>
									<div className="text-xs text-ink-muted leading-relaxed">
										{metadata.layout === "pre-paginated"
											? "Rendered with FixedLayoutRenderer. Content aspect ratio is locked and scaled proportionally with CSS transforms."
											: "Rendered with ReflowablePaginator. Dynamically paginates HTML text and inline images across CSS columns."}
									</div>
								</div>
							</div>

							{/* Viewport and Progression Details */}
							<div className="rounded-xl border border-border-subtle bg-surface-elevated/30 p-4 space-y-3">
								<h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
									Viewport & Display Metrics
								</h3>
								<div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
									<div>
										<div className="text-ink-muted">Native Viewport</div>
										<div className="font-semibold text-ink mt-0.5">
											{metadata.viewportDimensions
												? `${metadata.viewportDimensions.width} × ${metadata.viewportDimensions.height} px`
												: "Fluid / Responsive"}
										</div>
									</div>
									<div>
										<div className="text-ink-muted">Orientation</div>
										<div className="font-semibold text-ink mt-0.5 capitalize">
											{metadata.orientation}
										</div>
									</div>
									<div>
										<div className="text-ink-muted">Page Spread</div>
										<div className="font-semibold text-ink mt-0.5 capitalize">
											{metadata.spread}
										</div>
									</div>
									<div>
										<div className="text-ink-muted">Progression Direction</div>
										<div className="font-semibold text-ink mt-0.5 uppercase">
											{metadata.direction} (
											{metadata.direction === "rtl"
												? "Right-to-Left"
												: "Left-to-Right"}
											)
										</div>
									</div>
									<div>
										<div className="text-ink-muted">Active Engine</div>
										<div className="font-semibold text-accent mt-0.5">
											{metadata.layout === "pre-paginated"
												? "FixedLayoutRenderer"
												: "ReflowablePaginator"}
										</div>
									</div>
									<div>
										<div className="text-ink-muted">Spine Sections</div>
										<div className="font-semibold text-ink mt-0.5">
											{metadata.stats.spineCount} documents
										</div>
									</div>
								</div>
							</div>

							{/* Bibliographic Info */}
							<div className="rounded-xl border border-border-subtle bg-surface-elevated/30 p-4 space-y-3">
								<h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
									Publication Information
								</h3>
								<dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
									<div>
										<dt className="text-ink-muted">Author / Creator</dt>
										<dd className="font-medium text-ink">{metadata.author}</dd>
									</div>
									<div>
										<dt className="text-ink-muted">Publisher</dt>
										<dd className="font-medium text-ink">
											{metadata.publisher || "Not specified"}
										</dd>
									</div>
									<div>
										<dt className="text-ink-muted">Language</dt>
										<dd className="font-medium text-ink">
											{metadata.language}
										</dd>
									</div>
									<div>
										<dt className="text-ink-muted">Identifier</dt>
										<dd
											className="font-mono text-ink truncate"
											title={metadata.identifier}
										>
											{metadata.identifier}
										</dd>
									</div>
								</dl>
								{metadata.description && (
									<div className="pt-2 border-t border-border-subtle text-xs text-ink-muted">
										<div className="font-medium text-ink mb-1">Description</div>
										<p className="line-clamp-4 leading-relaxed">
											{cleanDescription(metadata.description)}
										</p>
									</div>
								)}
							</div>
						</div>
					)}

					{activeTab === "fonts" && (
						<div className="space-y-4">
							{/* Summary bar and search */}
							<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
								<div className="flex flex-wrap items-center gap-1.5">
									{Object.entries(fontFormatCounts).map(([fmt, count]) => (
										<span
											key={fmt}
											className={`rounded-lg border px-2 py-1 text-xs font-medium ${getFormatBadgeClass(
												fmt as EmbeddedFontFormat,
											)}`}
										>
											{fmt}: {count}
										</span>
									))}
								</div>

								<div className="relative w-full sm:w-64">
									<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-muted" />
									<input
										type="text"
										value={fontSearch}
										onChange={(e) => setFontSearch(e.target.value)}
										placeholder="Search fonts…"
										className="h-8 w-full rounded-xl border border-border-subtle bg-surface-elevated/70 pl-8 pr-3 text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-hidden"
									/>
								</div>
							</div>

							{/* Font List */}
							{metadata.embeddedFonts.length === 0 ? (
								<div className="rounded-xl border border-dashed border-border-subtle p-8 text-center text-xs text-ink-muted space-y-1.5">
									<Type className="h-8 w-8 mx-auto text-ink-muted/50" />
									<p className="font-medium text-ink">
										No embedded fonts found
									</p>
									<p>
										This book does not package custom font files and relies on
										system fonts or standard reader typography.
									</p>
								</div>
							) : filteredFonts.length === 0 ? (
								<div className="rounded-xl border border-border-subtle p-6 text-center text-xs text-ink-muted">
									No fonts matching &ldquo;{fontSearch}&rdquo;
								</div>
							) : (
								<div className="rounded-xl border border-border-subtle bg-surface-elevated/20 overflow-hidden">
									<div className="max-h-96 overflow-y-auto divide-y divide-border-subtle">
										{filteredFonts.map((font) => {
											const dyn = dynamicFontDetails[font.path];
											const familyName =
												font.fontFamily ||
												dyn?.familyName ||
												font.name.replace(/\.[a-z0-9]+$/i, "");
											const fullName = font.fullName || dyn?.fullName;
											const weight =
												font.subfamily ||
												dyn?.subfamily ||
												(fullName && fullName !== familyName
													? fullName
															.replace(familyName, "")
															.replace(/^[-_\s]+/, "")
													: null);

											return (
												<div
													key={font.path}
													className="flex items-center justify-between px-4 py-2.5 hover:bg-surface-elevated/60 transition-colors text-xs"
												>
													<div className="min-w-0 pr-3">
														<div className="flex items-center gap-2 truncate">
															<span className="font-semibold text-ink text-sm truncate">
																{familyName}
															</span>
															{weight && (
																<span className="inline-flex items-center rounded-md bg-ink/10 text-ink border border-ink/20 px-2 py-0.5 text-xs font-semibold shadow-2xs">
																	{weight}
																</span>
															)}
														</div>
														<div className="font-mono text-[11px] text-ink-muted truncate mt-0.5">
															{font.name !== familyName
																? `${font.name} · ${font.path}`
																: font.path}
														</div>
													</div>
													<div className="flex items-center gap-2 shrink-0">
														<span
															className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${getFormatBadgeClass(
																font.format,
															)}`}
														>
															{font.format}
														</span>
														<span className="font-mono text-xs text-ink-muted min-w-14 text-right">
															{formatBytes(font.sizeBytes)}
														</span>
													</div>
												</div>
											);
										})}
									</div>
									<div className="border-t border-border-subtle bg-surface-elevated/50 px-4 py-2 text-right text-[11px] text-ink-muted">
										Showing {filteredFonts.length} of{" "}
										{metadata.embeddedFonts.length} fonts
									</div>
								</div>
							)}
						</div>
					)}

					{activeTab === "assets" && (
						<div className="space-y-5">
							{/* Stat cards */}
							<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
								<div className="rounded-xl border border-border-subtle bg-surface-elevated/40 p-3.5 space-y-1">
									<div className="flex items-center gap-1.5 text-xs text-ink-muted">
										<FileText className="h-3.5 w-3.5" />
										<span>Spine Chapters</span>
									</div>
									<div className="text-xl font-bold text-ink">
										{metadata.stats.spineCount}
									</div>
								</div>

								<div className="rounded-xl border border-border-subtle bg-surface-elevated/40 p-3.5 space-y-1">
									<div className="flex items-center gap-1.5 text-xs text-ink-muted">
										<Type className="h-3.5 w-3.5" />
										<span>Embedded Fonts</span>
									</div>
									<div className="text-xl font-bold text-ink">
										{metadata.stats.fontCount}
									</div>
								</div>

								<div className="rounded-xl border border-border-subtle bg-surface-elevated/40 p-3.5 space-y-1">
									<div className="flex items-center gap-1.5 text-xs text-ink-muted">
										<ImageIcon className="h-3.5 w-3.5" />
										<span>Image Assets</span>
									</div>
									<div className="text-xl font-bold text-ink">
										{metadata.stats.imageCount}
									</div>
								</div>

								<div className="rounded-xl border border-border-subtle bg-surface-elevated/40 p-3.5 space-y-1">
									<div className="flex items-center gap-1.5 text-xs text-ink-muted">
										<FileCode className="h-3.5 w-3.5" />
										<span>CSS Stylesheets</span>
									</div>
									<div className="text-xl font-bold text-ink">
										{metadata.stats.cssCount}
									</div>
								</div>
							</div>

							{/* Archive details */}
							<div className="rounded-xl border border-border-subtle bg-surface-elevated/30 p-4 space-y-3">
								<h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
									Archive Information
								</h3>
								<dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
									<div>
										<dt className="text-ink-muted">File Name</dt>
										<dd className="font-medium text-ink truncate">
											{manifest.fileName}
										</dd>
									</div>
									<div>
										<dt className="text-ink-muted">Archive File Size</dt>
										<dd className="font-medium text-ink">
											{formatBytes(manifest.fileSize)}
										</dd>
									</div>
									<div>
										<dt className="text-ink-muted">Total Entries in ZIP</dt>
										<dd className="font-medium text-ink">
											{metadata.stats.totalEntriesCount} files
										</dd>
									</div>
									<div>
										<dt className="text-ink-muted">
											File Fingerprint (SHA-256)
										</dt>
										<dd
											className="font-mono text-ink truncate"
											title={manifest.fileHash}
										>
											{manifest.fileHash}
										</dd>
									</div>
								</dl>
							</div>
						</div>
					)}
				</div>
			</dialog>
		</div>
	);
}
