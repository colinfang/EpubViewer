import { BookOpen, FileText, FolderOpen, Sparkles, Upload } from "lucide-react";
import { type DragEvent, useEffect, useRef, useState } from "react";
import { APP_VERSION, BUILD_TIME } from "../version";

interface TestEpubEntry {
	readonly name: string;
	readonly size: number;
}

export interface DropzoneLandingProps {
	readonly onSelectFile: (file: Blob & { readonly name?: string }) => void;
	readonly errorMessage: string | null;
	readonly isLoading: boolean;
	readonly loadingFileName: string | null;
}

function formatFileSize(bytes: number): string {
	const mb = bytes / (1024 * 1024);
	if (mb >= 1) {
		return `${mb.toFixed(1)} MB`;
	}
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function DropzoneLanding({
	onSelectFile,
	errorMessage,
	isLoading,
	loadingFileName,
}: DropzoneLandingProps) {
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [isDragging, setIsDragging] = useState(false);
	const [testEpubs, setTestEpubs] = useState<ReadonlyArray<TestEpubEntry>>([]);
	const [loadingTestBook, setLoadingTestBook] = useState<string | null>(null);

	useEffect(() => {
		let active = true;
		fetch("/api/test-epubs")
			.then((res) =>
				res.ok ? (res.json() as Promise<ReadonlyArray<TestEpubEntry>>) : [],
			)
			.then((list) => {
				if (active && Array.isArray(list)) {
					setTestEpubs(list);
				}
			})
			.catch(() => {
				// Ignore if running as static build without dev middleware
			});
		return () => {
			active = false;
		};
	}, []);

	const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragging(true);
	};

	const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragging(false);
	};

	const handleDrop = (e: DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragging(false);
		const file = e.dataTransfer.files[0];
		if (file) {
			onSelectFile(file);
		}
	};

	const handleOpenTestEpub = async (name: string) => {
		try {
			setLoadingTestBook(name);
			const res = await fetch(`/api/test-epubs/${encodeURIComponent(name)}`);
			if (!res.ok) {
				throw new Error(`HTTP ${String(res.status)}`);
			}
			const blob = await res.blob();
			const file = new File([blob], name, { type: "application/epub+zip" });
			onSelectFile(file);
		} finally {
			setLoadingTestBook(null);
		}
	};

	return (
		<div className="flex h-full w-full flex-col items-center justify-center bg-surface px-6 py-12 text-ink overflow-y-auto">
			<div className="w-full max-w-2xl space-y-8">
				<div className="text-center space-y-3">
					<div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent shadow-xs">
						<BookOpen className="h-7 w-7" />
					</div>
					<div className="flex items-center justify-center gap-2">
						<h1 className="text-3xl font-semibold tracking-tight">
							Local EPUB Viewer
						</h1>
						<span className="rounded-full border border-border-subtle bg-surface-elevated px-2.5 py-0.5 text-xs font-medium text-ink-muted">
							v{APP_VERSION}
						</span>
					</div>
					<p className="text-sm text-ink-muted max-w-md mx-auto">
						Zero-backend local reader supporting Two-Column Book Spreads,
						Single-Column Pagination, Continuous Scroll, and Fixed-Layout
						Illustrated Books.
					</p>
				</div>

				{errorMessage ? (
					<div
						role="alert"
						className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
					>
						{errorMessage}
					</div>
				) : null}

				<div
					onDragOver={handleDragOver}
					onDragLeave={handleDragLeave}
					onDrop={handleDrop}
					onClick={() => fileInputRef.current?.click()}
					className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 transition-all ${
						isDragging
							? "border-accent bg-accent/10 scale-[1.01]"
							: "border-border-subtle bg-surface-elevated/60 hover:border-accent/60 hover:bg-surface-elevated"
					}`}
				>
					<input
						ref={fileInputRef}
						type="file"
						accept=".epub,application/epub+zip"
						className="hidden"
						onChange={(e) => {
							const file = e.target.files?.[0];
							if (file) {
								onSelectFile(file);
							}
						}}
					/>

					<div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface shadow-xs group-hover:text-accent transition-colors">
						<Upload className="h-5 w-5" />
					</div>

					{isLoading ? (
						<div className="text-center space-y-1">
							<p className="font-medium text-base">
								Opening {loadingFileName ?? "book"}…
							</p>
							<p className="text-xs text-ink-muted">
								Parsing ZIP central directory &amp; OPF manifest…
							</p>
						</div>
					) : (
						<div className="text-center space-y-2">
							<p className="text-base font-medium">
								Drop an <span className="text-accent font-semibold">.epub</span>{" "}
								file here, or click to browse
							</p>
							<p className="text-xs text-ink-muted">
								100% local in your browser — files never leave your device
							</p>
						</div>
					)}

					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							fileInputRef.current?.click();
						}}
						className="mt-5 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-medium text-white shadow-xs hover:opacity-95 transition-opacity"
					>
						<FolderOpen className="h-4 w-4" />
						Choose Local EPUB File
					</button>
				</div>

				{testEpubs.length > 0 ? (
					<div className="space-y-3">
						<div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
							<Sparkles className="h-3.5 w-3.5 text-accent" />
							<span>Workspace Books (test_epub/)</span>
						</div>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							{testEpubs.map((book) => {
								const isBookLoading = loadingTestBook === book.name;
								return (
									<button
										key={book.name}
										type="button"
										disabled={isLoading || isBookLoading}
										onClick={() => void handleOpenTestEpub(book.name)}
										className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface-elevated/80 p-3.5 text-left transition-all hover:border-accent/60 hover:bg-surface-elevated disabled:opacity-50"
									>
										<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
											<FileText className="h-5 w-5" />
										</div>
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-medium">
												{book.name.replace(/\.epub$/i, "")}
											</p>
											<p className="text-xs text-ink-muted">
												{isBookLoading
													? "Loading…"
													: `${formatFileSize(book.size)} • Click to read`}
											</p>
										</div>
									</button>
								);
							})}
						</div>
					</div>
				) : null}

				<div className="pt-2 text-center text-xs text-ink-muted/50">
					v{APP_VERSION} • {BUILD_TIME}
				</div>
			</div>
		</div>
	);
}
