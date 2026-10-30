import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect } from "react";

export interface EpubViewportProps {
	readonly mountViewport: (
		container: HTMLDivElement | null,
	) => (() => void) | undefined;
	readonly onNext: () => void;
	readonly onPrev: () => void;
	readonly showNavigationButtons?: boolean;
}

export function EpubViewport({
	mountViewport,
	onNext,
	onPrev,
	showNavigationButtons = true,
}: EpubViewportProps) {
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.isContentEditable)
			) {
				return;
			}

			if (
				e.key === "ArrowRight" ||
				e.key === "PageDown" ||
				(e.key === " " && !e.shiftKey)
			) {
				e.preventDefault();
				onNext();
			} else if (
				e.key === "ArrowLeft" ||
				e.key === "PageUp" ||
				(e.key === " " && e.shiftKey)
			) {
				e.preventDefault();
				onPrev();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [onNext, onPrev]);

	return (
		<div className="relative flex-1 w-full h-full overflow-hidden select-none">
			<div ref={mountViewport} className="w-full h-full" />

			{showNavigationButtons && (
				<>
					<button
						type="button"
						onClick={onPrev}
						aria-label="Previous Page"
						className="group absolute left-2 top-1/2 -translate-y-1/2 z-20 flex h-16 w-10 items-center justify-center rounded-xl text-ink-muted/50 hover:bg-surface-elevated/80 hover:text-ink transition-all focus:opacity-100"
					>
						<ChevronLeft className="h-6 w-6 transition-transform group-hover:-translate-x-0.5" />
					</button>

					<button
						type="button"
						onClick={onNext}
						aria-label="Next Page"
						className="group absolute right-2 top-1/2 -translate-y-1/2 z-20 flex h-16 w-10 items-center justify-center rounded-xl text-ink-muted/50 hover:bg-surface-elevated/80 hover:text-ink transition-all focus:opacity-100"
					>
						<ChevronRight className="h-6 w-6 transition-transform group-hover:translate-x-0.5" />
					</button>
				</>
			)}
		</div>
	);
}
