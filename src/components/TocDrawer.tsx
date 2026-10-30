import { BookOpen, X } from "lucide-react";
import type { BookMetadata, TocItem } from "../core/types";

export interface TocDrawerProps {
	readonly isOpen: boolean;
	readonly onClose: () => void;
	readonly toc: ReadonlyArray<TocItem>;
	readonly activeTocId: string | null;
	readonly metadata: BookMetadata;
	readonly onSelectHref: (href: string) => void;
	readonly onOpenInspector?: () => void;
}

interface TocListProps {
	readonly items: ReadonlyArray<TocItem>;
	readonly activeTocId: string | null;
	readonly depth: number;
	readonly onSelectHref: (href: string) => void;
}

function TocTreeList({
	items,
	activeTocId,
	depth,
	onSelectHref,
}: TocListProps) {
	return (
		<ul
			className={
				depth > 0
					? "mt-1 space-y-0.5 border-l border-border-subtle pl-3 ml-2"
					: "space-y-1"
			}
		>
			{items.map((item) => {
				const isActive = activeTocId === item.id;
				return (
					<li key={item.id}>
						<button
							type="button"
							onClick={() => {
								if (item.href) {
									onSelectHref(item.href);
								}
							}}
							className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
								isActive
									? "bg-accent/15 font-semibold text-accent"
									: "text-ink hover:bg-surface-elevated"
							}`}
						>
							{item.label}
						</button>
						{item.subitems.length > 0 ? (
							<TocTreeList
								items={item.subitems}
								activeTocId={activeTocId}
								depth={depth + 1}
								onSelectHref={onSelectHref}
							/>
						) : null}
					</li>
				);
			})}
		</ul>
	);
}

export function TocDrawer({
	isOpen,
	onClose,
	toc,
	activeTocId,
	metadata,
	onSelectHref,
	onOpenInspector,
}: TocDrawerProps) {
	if (!isOpen) return null;

	return (
		<div className="fixed inset-0 z-50 flex">
			<button
				type="button"
				className="fixed inset-0 bg-black/40 backdrop-blur-xs cursor-default"
				onClick={onClose}
				aria-label="Close Table of Contents overlay"
			/>
			<aside
				aria-label="Table of Contents"
				className="relative z-10 flex h-full w-80 max-w-[85vw] flex-col border-r border-border-subtle bg-surface text-ink shadow-2xl"
			>
				<div className="flex items-center justify-between border-b border-border-subtle px-4 py-3.5">
					<div className="flex items-center gap-2.5 min-w-0">
						<BookOpen className="h-4 w-4 shrink-0 text-accent" />
						<span className="truncate text-sm font-semibold">Contents</span>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close Table of Contents"
						className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-elevated hover:text-ink transition-colors"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				<div className="flex items-center gap-3 border-b border-border-subtle bg-surface-elevated/50 px-4 py-3">
					{metadata.coverBlobUrl ? (
						<img
							src={metadata.coverBlobUrl}
							alt={metadata.title}
							className="h-14 w-10 shrink-0 rounded object-cover shadow-xs"
						/>
					) : null}
					<div className="min-w-0 flex-1">
						<p className="truncate text-sm font-semibold">{metadata.title}</p>
						<p className="truncate text-xs text-ink-muted">{metadata.author}</p>
						<div className="mt-1 flex items-center gap-2">
							<span className="inline-block rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
								{metadata.layout === "pre-paginated"
									? "Fixed Layout"
									: "Reflowable"}
							</span>
							{onOpenInspector ? (
								<button
									type="button"
									onClick={() => {
										onClose();
										onOpenInspector();
									}}
									className="text-[10px] font-medium text-ink-muted hover:text-accent underline transition-colors"
								>
									Inspect
								</button>
							) : null}
						</div>
					</div>
				</div>

				<div className="flex-1 overflow-y-auto p-3">
					<TocTreeList
						items={toc}
						activeTocId={activeTocId}
						depth={0}
						onSelectHref={(href) => {
							onSelectHref(href);
							onClose();
						}}
					/>
				</div>
			</aside>
		</div>
	);
}
