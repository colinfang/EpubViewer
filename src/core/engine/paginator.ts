/**
 * EPUB Reflowable Paginator and Continuous Scrolled Engine.
 *
 * Adapted and ported to TypeScript for EpubViewer from upstream foliate-js:
 *   Repository: https://github.com/johnfactotum/foliate-js
 *   Reference: paginator.js
 *   License: MIT © John Factotum
 */

import type { DocumentTransformer } from "../pipeline";
import { runDocumentPipeline } from "../pipeline";
import type {
	BookManifest,
	ReaderInputEvent,
	ReaderSettings,
	RelocationEvent,
	TocItem,
} from "../types";
import { buildCfiFromElement, parseCfi, resolveCfiInDocument } from "./epubcfi";

export interface PaginatorOptions {
	readonly manifest: BookManifest;
	readonly initialSettings: ReaderSettings;
	readonly transformers?: ReadonlyArray<DocumentTransformer>;
	readonly onRelocate: (event: RelocationEvent) => void;
	readonly onInput: (event: ReaderInputEvent) => void;
}

function findMatchingTocItem(
	toc: ReadonlyArray<TocItem>,
	sectionHref: string,
): TocItem | null {
	let matched: TocItem | null = null;
	const normalizedSection = sectionHref.toLowerCase();

	const walk = (items: ReadonlyArray<TocItem>): void => {
		for (const item of items) {
			const hashIdx = item.href.indexOf("#");
			const itemPath = (
				hashIdx >= 0 ? item.href.slice(0, hashIdx) : item.href
			).toLowerCase();
			if (
				itemPath === normalizedSection ||
				normalizedSection.endsWith(`/${itemPath}`) ||
				itemPath.endsWith(`/${normalizedSection}`)
			) {
				matched = item;
			}
			if (item.subitems.length > 0) {
				walk(item.subitems);
			}
		}
	};

	walk(toc);
	return matched;
}

export class ReflowablePaginator {
	private readonly manifest: BookManifest;
	private settings: ReaderSettings;
	private readonly transformers: ReadonlyArray<DocumentTransformer> | undefined;
	private readonly onRelocate: (event: RelocationEvent) => void;
	private readonly onInput: (event: ReaderInputEvent) => void;

	private hostContainer: HTMLElement | null = null;
	private shadowRoot: ShadowRoot | null = null;
	private stageEl: HTMLDivElement | null = null;
	private spineDividerEl: HTMLDivElement | null = null;
	private iframeEl: HTMLIFrameElement | null = null;
	private resizeObserver: ResizeObserver | null = null;

	private currentSectionIndex = 0;
	private currentPageIndex = 0;
	private currentPageCount = 1;
	private currentCfi = "epubcfi(/6/2!/4/2)";
	private pageStride = 1;
	private isLoadingSection = false;
	private currentDocument: Document | null = null;
	private destroyed = false;

	private getContentDoc(): Document | null {
		return this.iframeEl?.contentDocument ?? this.currentDocument;
	}

	public constructor(options: PaginatorOptions) {
		this.manifest = options.manifest;
		this.settings = options.initialSettings;
		this.transformers = options.transformers;
		this.onRelocate = options.onRelocate;
		this.onInput = options.onInput;
	}

	public async mount(
		container: HTMLElement,
		initialCfi?: string,
	): Promise<void> {
		this.hostContainer = container;
		container.innerHTML = "";

		const host = document.createElement("div");
		host.style.cssText =
			"width: 100%; height: 100%; position: relative; overflow: hidden;";
		container.appendChild(host);

		this.shadowRoot = host.attachShadow({ mode: "open" });

		const wrapperStyle = document.createElement("style");
		wrapperStyle.textContent = `
            :host {
                display: block;
                width: 100%;
                height: 100%;
                position: relative;
            }
            .stage {
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                position: relative;
                box-sizing: border-box;
                transition: background-color 150ms ease;
            }
            .book-frame {
                position: relative;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
            }
            iframe {
                border: 0;
                display: block;
                background: transparent;
            }
            .spine-divider {
                position: absolute;
                top: 24px;
                bottom: 24px;
                left: 50%;
                width: 1px;
                transform: translateX(-50%);
                pointer-events: none;
                background: rgba(128, 128, 128, 0.22);
                box-shadow: 0 0 12px rgba(0, 0, 0, 0.08);
            }
        `;
		this.shadowRoot.appendChild(wrapperStyle);

		const stage = document.createElement("div");
		stage.className = "stage";
		this.stageEl = stage;

		const bookFrame = document.createElement("div");
		bookFrame.className = "book-frame";

		const iframe = document.createElement("iframe");
		iframe.setAttribute("title", "EPUB Chapter View");
		iframe.setAttribute("sandbox", "allow-same-origin");
		this.iframeEl = iframe;

		const divider = document.createElement("div");
		divider.className = "spine-divider";
		this.spineDividerEl = divider;

		bookFrame.appendChild(iframe);
		bookFrame.appendChild(divider);
		stage.appendChild(bookFrame);
		this.shadowRoot.appendChild(stage);

		if (typeof ResizeObserver !== "undefined") {
			let lastW = 0;
			let lastH = 0;
			this.resizeObserver = new ResizeObserver((entries) => {
				if (this.destroyed || this.isLoadingSection) return;
				const entry = entries[0];
				const newW = Math.round(entry?.contentRect.width ?? stage.clientWidth);
				const newH = Math.round(
					entry?.contentRect.height ?? stage.clientHeight,
				);
				const widthDelta = Math.abs(newW - lastW);
				const heightDelta = Math.abs(newH - lastH);

				// In paginated mode, ignore height-only shifts under 64px (dynamic mobile URL bar collapse/expand)
				if (this.settings.viewMode !== "scrolled") {
					if (widthDelta < 4 && heightDelta < 64) {
						return;
					}
				} else {
					if (widthDelta < 4) return;
				}

				const tResize = performance.now();
				console.log(
					`[PERF] 🔄 ResizeObserver fired! (W: ${lastW}->${newW}, H: ${lastH}->${newH})`,
				);
				lastW = newW;
				lastH = newH;
				this.relayoutCurrentDocument(true);
				console.log(
					`[PERF] 🔄 relayoutCurrentDocument took ${Math.round(performance.now() - tResize)}ms`,
				);
			});
			this.resizeObserver.observe(stage);
		}

		if (initialCfi) {
			const parsed = parseCfi(initialCfi);
			const targetIndex = parsed
				? Math.max(
						0,
						Math.min(this.manifest.spine.length - 1, parsed.spineIndex),
					)
				: 0;
			await this.loadSection(targetIndex, { type: "cfi", cfi: initialCfi });
		} else {
			await this.loadSection(0, { type: "start" });
		}
	}

	public async next(): Promise<void> {
		if (this.isLoadingSection || this.destroyed) return;

		if (this.settings.viewMode === "scrolled") {
			const doc = this.getContentDoc();
			const scroller = doc?.scrollingElement ?? doc?.documentElement;
			if (scroller) {
				const maxScroll = scroller.scrollHeight - scroller.clientHeight;
				if (scroller.scrollTop + 24 < maxScroll) {
					scroller.scrollBy({
						top: Math.floor(scroller.clientHeight * 0.85),
						behavior: "smooth",
					});
					setTimeout(() => this.emitRelocation(), 180);
					return;
				}
			}
			if (this.currentSectionIndex + 1 < this.manifest.spine.length) {
				await this.loadSection(this.currentSectionIndex + 1, { type: "start" });
			}
			return;
		}

		if (this.currentPageIndex + 1 < this.currentPageCount) {
			this.goToPageInCurrentSection(this.currentPageIndex + 1);
			return;
		}

		if (this.currentSectionIndex + 1 < this.manifest.spine.length) {
			await this.loadSection(this.currentSectionIndex + 1, { type: "start" });
		}
	}

	public async prev(): Promise<void> {
		if (this.isLoadingSection || this.destroyed) return;

		if (this.settings.viewMode === "scrolled") {
			const doc = this.getContentDoc();
			const scroller = doc?.scrollingElement ?? doc?.documentElement;
			if (scroller && scroller.scrollTop > 24) {
				scroller.scrollBy({
					top: -Math.floor(scroller.clientHeight * 0.85),
					behavior: "smooth",
				});
				setTimeout(() => this.emitRelocation(), 180);
				return;
			}
			if (this.currentSectionIndex > 0) {
				await this.loadSection(this.currentSectionIndex - 1, { type: "end" });
			}
			return;
		}

		if (this.currentPageIndex > 0) {
			this.goToPageInCurrentSection(this.currentPageIndex - 1);
			return;
		}

		if (this.currentSectionIndex > 0) {
			await this.loadSection(this.currentSectionIndex - 1, { type: "end" });
		}
	}

	public async goToHref(href: string): Promise<void> {
		const target = this.manifest.resolveHrefToSpine(href);
		if (!target) return;
		await this.loadSection(target.index, {
			type: "anchor",
			anchor: target.anchor,
		});
	}

	public async goToFraction(fraction: number): Promise<void> {
		const clamped = Math.max(0, Math.min(1, fraction));
		const spine = this.manifest.spine;
		if (spine.length === 0) return;

		const totalBytes = spine.reduce((acc, s) => acc + s.sizeBytes, 0);
		const targetByte = clamped * totalBytes;

		let accumulated = 0;
		for (let i = 0; i < spine.length; i++) {
			const sec = spine[i];
			if (!sec) continue;
			const nextAccum = accumulated + sec.sizeBytes;
			if (targetByte <= nextAccum || i === spine.length - 1) {
				const sectionFraction =
					sec.sizeBytes > 0 ? (targetByte - accumulated) / sec.sizeBytes : 0;
				await this.loadSection(i, {
					type: "fraction",
					fraction: Math.max(0, Math.min(1, sectionFraction)),
				});
				return;
			}
			accumulated = nextAccum;
		}
	}

	public async goToCfi(cfi: string): Promise<void> {
		const parsed = parseCfi(cfi);
		if (!parsed) return;
		const targetIndex = Math.max(
			0,
			Math.min(this.manifest.spine.length - 1, parsed.spineIndex),
		);
		await this.loadSection(targetIndex, { type: "cfi", cfi });
	}

	public async applySettings(settings: ReaderSettings): Promise<void> {
		const savedCfi = this.captureVisibleCfi();
		this.settings = settings;
		const doc = this.getContentDoc();
		const section = this.manifest.spine[this.currentSectionIndex];

		if (doc && section) {
			runDocumentPipeline(
				doc,
				{
					bookMeta: this.manifest.metadata,
					sectionHref: section.href,
					settings: this.settings,
				},
				this.transformers,
			);
			this.relayoutCurrentDocument(false, savedCfi);
		}
	}

	public destroy(): void {
		this.destroyed = true;
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		if (this.hostContainer) {
			this.hostContainer.innerHTML = "";
		}
	}

	private async loadSection(
		index: number,
		destination:
			| { readonly type: "start" }
			| { readonly type: "end" }
			| { readonly type: "anchor"; readonly anchor: string | null }
			| { readonly type: "fraction"; readonly fraction: number }
			| { readonly type: "cfi"; readonly cfi: string },
	): Promise<void> {
		const section = this.manifest.spine[index];
		if (!section || !this.iframeEl) return;

		this.isLoadingSection = true;
		this.currentSectionIndex = index;
		const tSec = performance.now();
		console.log(`[PERF] 🚀 loadSection #${index} (${section.href})`);

		try {
			const sourceDoc = await section.loadDocument();
			this.currentDocument = sourceDoc;
			runDocumentPipeline(
				sourceDoc,
				{
					bookMeta: this.manifest.metadata,
					sectionHref: section.href,
					settings: this.settings,
				},
				this.transformers,
			);

			await this.writeDocumentToIframe(sourceDoc);
			if (this.destroyed) return;

			this.bindIframeEvents(section);
			const tSettle = performance.now();
			await this.waitForImagesToSettle();
			console.log(
				`[PERF] ⏳ waitForImagesToSettle took ${Math.round(performance.now() - tSettle)}ms`,
			);
			if (this.destroyed) return;

			this.applyLayoutMetrics();
			console.log(
				`[PERF] 🏁 loadSection #${index} ready in ${Math.round(performance.now() - tSec)}ms (${this.currentPageCount} pages)`,
			);

			if (destination.type === "start") {
				this.goToPageInCurrentSection(0);
			} else if (destination.type === "end") {
				if (this.settings.viewMode === "scrolled") {
					const doc = this.getContentDoc();
					const scroller = doc?.scrollingElement ?? doc?.documentElement;
					if (scroller) {
						scroller.scrollTop = Math.max(
							0,
							scroller.scrollHeight - scroller.clientHeight,
						);
					}
					this.emitRelocation();
				} else {
					this.goToPageInCurrentSection(Math.max(0, this.currentPageCount - 1));
				}
			} else if (destination.type === "anchor") {
				this.scrollToAnchor(destination.anchor);
			} else if (destination.type === "fraction") {
				if (this.settings.viewMode === "scrolled") {
					const doc = this.getContentDoc();
					const scroller = doc?.scrollingElement ?? doc?.documentElement;
					if (scroller) {
						scroller.scrollTop =
							destination.fraction *
							Math.max(0, scroller.scrollHeight - scroller.clientHeight);
					}
					this.emitRelocation();
				} else {
					const targetPage = Math.min(
						this.currentPageCount - 1,
						Math.floor(destination.fraction * this.currentPageCount),
					);
					this.goToPageInCurrentSection(Math.max(0, targetPage));
				}
			} else if (destination.type === "cfi") {
				this.scrollToCfi(destination.cfi);
			}
		} finally {
			this.isLoadingSection = false;
		}
	}

	private writeDocumentToIframe(sourceDoc: Document): Promise<void> {
		return new Promise((resolve) => {
			const iframe = this.iframeEl;
			if (!iframe) {
				resolve();
				return;
			}
			const serializer = new XMLSerializer();
			const htmlContent = serializer.serializeToString(sourceDoc);
			let settled = false;
			const done = () => {
				if (!settled) {
					settled = true;
					resolve();
				}
			};
			iframe.onload = done;
			iframe.srcdoc = htmlContent;
			setTimeout(done, 50);
		});
	}

	private async waitForImagesToSettle(): Promise<void> {
		const doc = this.iframeEl?.contentDocument;
		if (!doc) return;
		const images = Array.from(doc.querySelectorAll("img"));
		if (images.length === 0) return;

		await Promise.all(
			images.map((img) => {
				if (img.complete) return Promise.resolve();
				return new Promise<void>((resolve) => {
					const done = () => resolve();
					img.addEventListener("load", done, { once: true });
					img.addEventListener("error", done, { once: true });
					setTimeout(done, 400);
				});
			}),
		);
	}

	private bindIframeEvents(section: BookManifest["spine"][number]): void {
		const doc = this.iframeEl?.contentDocument;
		if (!doc) return;

		let lastPointerType = "mouse";
		let lastBoundaryTransitionTime = 0;
		doc.addEventListener(
			"pointerdown",
			(e: PointerEvent) => {
				if (e.pointerType) {
					lastPointerType = e.pointerType;
				}
			},
			{ passive: true },
		);

		let touchStartY: number | null = null;
		let touchStartX: number | null = null;
		let wasAtBottomOnTouchStart = false;
		let wasAtTopOnTouchStart = false;

		doc.addEventListener(
			"touchstart",
			(e: TouchEvent) => {
				lastPointerType = "touch";
				const touch = e.touches[0];
				if (!touch) return;
				touchStartY = touch.clientY;
				touchStartX = touch.clientX;
				if (this.settings.viewMode === "scrolled") {
					const scroller = doc.scrollingElement ?? doc.documentElement;
					if (scroller) {
						wasAtBottomOnTouchStart =
							scroller.scrollTop + scroller.clientHeight >=
							scroller.scrollHeight - 16;
						wasAtTopOnTouchStart = scroller.scrollTop <= 16;
					}
				}
			},
			{ passive: true },
		);

		doc.addEventListener(
			"touchend",
			(e: TouchEvent) => {
				const touch = e.changedTouches[0];
				const startY = touchStartY;
				const startX = touchStartX;
				touchStartY = null;
				touchStartX = null;

				if (!touch || startY === null || startX === null) return;
				if (this.settings.viewMode !== "scrolled" || this.isLoadingSection) {
					return;
				}

				const dy = touch.clientY - startY;
				const dx = touch.clientX - startX;
				const now = performance.now();

				if (Math.abs(dy) > Math.abs(dx) * 1.2 && Math.abs(dy) > 36) {
					if (now - lastBoundaryTransitionTime < 400) return;
					const scroller = doc.scrollingElement ?? doc.documentElement;
					const isNowAtBottom = scroller
						? scroller.scrollTop + scroller.clientHeight >=
							scroller.scrollHeight - 16
						: false;
					const isNowAtTop = scroller ? scroller.scrollTop <= 16 : false;

					if (dy < -36 && (wasAtBottomOnTouchStart || isNowAtBottom)) {
						if (this.currentSectionIndex + 1 < this.manifest.spine.length) {
							lastBoundaryTransitionTime = now;
							void this.loadSection(this.currentSectionIndex + 1, {
								type: "start",
							});
						}
						return;
					}

					if (dy > 36 && (wasAtTopOnTouchStart || isNowAtTop)) {
						if (this.currentSectionIndex > 0) {
							lastBoundaryTransitionTime = now;
							void this.loadSection(this.currentSectionIndex - 1, {
								type: "end",
							});
						}
						return;
					}
				}
			},
			{ passive: true },
		);

		doc.addEventListener("keydown", (e: KeyboardEvent) => {
			if (this.settings.viewMode === "scrolled") {
				const scroller = doc.scrollingElement ?? doc.documentElement;
				if (scroller) {
					const isAtBottom =
						scroller.scrollTop + scroller.clientHeight >=
						scroller.scrollHeight - 16;
					const isAtTop = scroller.scrollTop <= 16;

					if (
						(e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ") &&
						isAtBottom
					) {
						if (this.currentSectionIndex + 1 < this.manifest.spine.length) {
							e.preventDefault();
							void this.loadSection(this.currentSectionIndex + 1, {
								type: "start",
							});
						}
						return;
					}

					if (
						(e.key === "ArrowUp" ||
							e.key === "PageUp" ||
							(e.key === " " && e.shiftKey)) &&
						isAtTop
					) {
						if (this.currentSectionIndex > 0) {
							e.preventDefault();
							void this.loadSection(this.currentSectionIndex - 1, {
								type: "end",
							});
						}
						return;
					}
				}
			}

			if (
				e.key === "ArrowRight" ||
				e.key === "PageDown" ||
				(e.key === " " && !e.shiftKey)
			) {
				e.preventDefault();
				this.onInput({ type: "next" });
			} else if (
				e.key === "ArrowLeft" ||
				e.key === "PageUp" ||
				(e.key === " " && e.shiftKey)
			) {
				e.preventDefault();
				this.onInput({ type: "prev" });
			}
		});

		let lastWheelTime = 0;
		doc.addEventListener(
			"wheel",
			(e: WheelEvent) => {
				if (this.settings.viewMode === "scrolled") {
					if (this.isLoadingSection) return;
					const scroller = doc.scrollingElement ?? doc.documentElement;
					if (scroller) {
						const isAtBottom =
							scroller.scrollTop + scroller.clientHeight >=
							scroller.scrollHeight - 16;
						const isAtTop = scroller.scrollTop <= 16;
						const now = performance.now();

						if (e.deltaY > 12 && isAtBottom) {
							if (now - lastBoundaryTransitionTime > 350) {
								if (this.currentSectionIndex + 1 < this.manifest.spine.length) {
									lastBoundaryTransitionTime = now;
									void this.loadSection(this.currentSectionIndex + 1, {
										type: "start",
									});
								}
							}
							return;
						}

						if (e.deltaY < -12 && isAtTop) {
							if (now - lastBoundaryTransitionTime > 350) {
								if (this.currentSectionIndex > 0) {
									lastBoundaryTransitionTime = now;
									void this.loadSection(this.currentSectionIndex - 1, {
										type: "end",
									});
								}
							}
							return;
						}
					}
					setTimeout(() => this.emitRelocation(), 100);
					return;
				}

				const now = performance.now();
				if (now - lastWheelTime < 220) return;
				const delta =
					Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
				if (Math.abs(delta) < 18) return;
				lastWheelTime = now;
				if (delta > 0) {
					this.onInput({ type: "next" });
				} else {
					this.onInput({ type: "prev" });
				}
			},
			{ passive: true },
		);

		let scrollRafId: number | null = null;
		doc.addEventListener(
			"scroll",
			() => {
				if (this.settings.viewMode === "scrolled" && !this.isLoadingSection) {
					if (scrollRafId !== null) return;
					scrollRafId = requestAnimationFrame(() => {
						scrollRafId = null;
						if (!this.destroyed && !this.isLoadingSection) {
							this.emitRelocation();
						}
					});
				}
			},
			{ passive: true },
		);

		doc.addEventListener("click", (e: MouseEvent) => {
			const target =
				e.target instanceof Element
					? e.target
					: (e.target as Node | null)?.parentElement;
			const anchor = target?.closest("a[href]");
			if (anchor) {
				const rawHref = anchor.getAttribute("href")?.trim() ?? "";
				if (!rawHref) return;
				if (rawHref.startsWith("http://") || rawHref.startsWith("https://")) {
					e.preventDefault();
					window.open(rawHref, "_blank", "noopener,noreferrer");
					return;
				}
				e.preventDefault();
				if (rawHref.startsWith("#")) {
					this.scrollToAnchor(rawHref.slice(1));
					return;
				}
				const resolvedHref = section.resolveHref(rawHref);
				void this.goToHref(resolvedHref);
				return;
			}

			const selection = doc.getSelection();
			if (selection && selection.toString().trim().length > 0) {
				return;
			}

			const rawPointerType =
				"pointerType" in e && typeof e.pointerType === "string"
					? e.pointerType
					: "";
			const pointerType = rawPointerType || lastPointerType;
			const isTouch = pointerType === "touch" || pointerType === "pen";

			if (!isTouch || this.settings.viewMode === "scrolled") {
				this.onInput({ type: "toggle-chrome" });
				return;
			}

			const viewWidth = Math.max(
				1,
				this.iframeEl?.clientWidth ?? window.innerWidth,
			);
			const x = e.clientX;
			console.log(
				`[INPUT] 👆 Click in iframe at x=${Math.round(x)} / ${Math.round(viewWidth)} (isTouch=${String(isTouch)})`,
			);
			if (x < viewWidth * 0.33) {
				this.onInput({ type: "prev" });
				return;
			}
			if (x > viewWidth * 0.67) {
				this.onInput({ type: "next" });
				return;
			}
			this.onInput({ type: "toggle-chrome" });
		});
	}

	private relayoutCurrentDocument(
		preservePosition: boolean,
		explicitCfi?: string,
	): void {
		const cfiToRestore =
			explicitCfi ?? (preservePosition ? this.captureVisibleCfi() : null);
		this.applyLayoutMetrics();
		if (cfiToRestore) {
			this.scrollToCfi(cfiToRestore);
		} else {
			this.goToPageInCurrentSection(
				Math.min(this.currentPageIndex, Math.max(0, this.currentPageCount - 1)),
			);
		}
	}

	private applyLayoutMetrics(): void {
		const stage = this.stageEl;
		const iframe = this.iframeEl;
		const doc = this.getContentDoc();
		if (!stage || !iframe || !doc) return;

		const stageRect = stage.getBoundingClientRect();
		const rawW = Math.max(320, stageRect.width);
		const rawH = Math.max(280, stageRect.height);

		const LAYOUT_STYLE_ID = "epub-viewer-paginator-layout";
		let layoutStyle = doc.getElementById(
			LAYOUT_STYLE_ID,
		) as HTMLStyleElement | null;
		if (!layoutStyle) {
			layoutStyle = doc.createElement("style");
			layoutStyle.id = LAYOUT_STYLE_ID;
			(doc.head ?? doc.documentElement).appendChild(layoutStyle);
		}

		if (this.settings.viewMode === "scrolled") {
			if (this.spineDividerEl) {
				this.spineDividerEl.style.display = "none";
			}
			iframe.style.width = `${String(Math.floor(rawW))}px`;
			iframe.style.height = `${String(Math.floor(rawH))}px`;

			layoutStyle.textContent = `
                html {
                    width: 100% !important;
                    height: 100% !important;
                    overflow-x: hidden !important;
                    overflow-y: auto !important;
                    column-width: auto !important;
                    column-count: auto !important;
                }
                body {
                    max-width: 46rem !important;
                    margin: 0 auto !important;
                    padding: 36px 28px 64px 28px !important;
                    box-sizing: border-box !important;
                }
            `;
			this.currentPageIndex = 0;
			this.currentPageCount = 1;
			this.pageStride = 1;
			return;
		}

		const isTwoColumn = this.settings.viewMode === "two-column" && rawW >= 640;
		const padX = isTwoColumn
			? Math.min(80, Math.floor(rawW * 0.06))
			: Math.min(96, Math.floor(rawW * 0.1));
		const padY = Math.min(72, Math.floor(rawH * 0.08));

		const maxFrameWidth = isTwoColumn ? 1360 : 820;
		const rawFrameWidth = Math.max(
			280,
			Math.min(maxFrameWidth, rawW - padX * 2),
		);
		const snappedWidth = Math.floor(rawFrameWidth / 2) * 2;
		const snappedHeight = Math.max(220, Math.floor(rawH - padY * 2));

		const gap = isTwoColumn ? 56 : 32;
		const colWidth = isTwoColumn ? (snappedWidth - gap) / 2 : snappedWidth;
		const stride = snappedWidth + gap;

		if (this.spineDividerEl) {
			this.spineDividerEl.style.display = isTwoColumn ? "block" : "none";
		}

		iframe.style.width = `${String(snappedWidth)}px`;
		iframe.style.height = `${String(snappedHeight)}px`;

		layoutStyle.textContent = `
            html {
                width: ${String(snappedWidth)}px !important;
                height: ${String(snappedHeight)}px !important;
                column-width: ${String(colWidth)}px !important;
                column-gap: ${String(gap)}px !important;
                column-fill: auto !important;
                overflow: hidden !important;
                margin: 0 !important;
                padding: 0 !important;
                box-sizing: border-box !important;
            }
            body {
                margin: 0 !important;
                padding: 0 !important;
                min-height: ${String(snappedHeight)}px !important;
                box-sizing: border-box !important;
            }
        `;

		this.pageStride = stride;
		const scrollWidth = doc.documentElement.scrollWidth;
		this.currentPageCount = Math.max(
			1,
			Math.round((scrollWidth + gap) / stride),
		);
	}

	private goToPageInCurrentSection(pageIndex: number): void {
		const doc = this.getContentDoc();
		if (!doc) return;

		const clamped = Math.max(0, Math.min(this.currentPageCount - 1, pageIndex));
		this.currentPageIndex = clamped;
		console.log(
			`[NAV] 📖 Navigated to Page ${clamped + 1} of ${this.currentPageCount}`,
		);

		if (this.settings.viewMode !== "scrolled") {
			doc.documentElement.scrollLeft = clamped * this.pageStride;
		}

		this.currentCfi = this.captureVisibleCfi();
		this.emitRelocation();
	}

	private scrollToAnchor(anchorId: string | null): void {
		const doc = this.getContentDoc();
		if (!doc || !anchorId) {
			this.goToPageInCurrentSection(0);
			return;
		}

		const targetEl =
			doc.getElementById(anchorId) ??
			doc.querySelector(`[name="${CSS.escape(anchorId)}"]`);
		if (!targetEl) {
			this.goToPageInCurrentSection(0);
			return;
		}

		this.scrollToElement(targetEl);
	}

	private scrollToCfi(cfi: string): void {
		const doc = this.getContentDoc();
		const parsed = parseCfi(cfi);
		if (!doc || !parsed) {
			this.goToPageInCurrentSection(0);
			return;
		}

		const targetEl = resolveCfiInDocument(doc, parsed);
		if (!targetEl) {
			this.goToPageInCurrentSection(0);
			return;
		}

		this.scrollToElement(targetEl);
	}

	private scrollToElement(targetEl: Element): void {
		const doc = this.getContentDoc();
		if (!doc) return;

		if (this.settings.viewMode === "scrolled") {
			targetEl.scrollIntoView({ block: "start" });
			this.currentCfi = buildCfiFromElement(
				this.currentSectionIndex,
				doc,
				targetEl,
			);
			this.emitRelocation();
			return;
		}

		// Measure element offset relative to scroll origin
		const currentScrollLeft = doc.documentElement.scrollLeft;
		const rect = targetEl.getBoundingClientRect();
		const absoluteLeft = currentScrollLeft + rect.left;
		const pageIndex = Math.max(
			0,
			Math.min(
				this.currentPageCount - 1,
				Math.floor(absoluteLeft / this.pageStride),
			),
		);
		this.goToPageInCurrentSection(pageIndex);
	}

	private captureVisibleCfi(): string {
		const tCfi = performance.now();
		const doc = this.getContentDoc();
		if (!doc?.body) {
			return `epubcfi(/6/${String((this.currentSectionIndex + 1) * 2)}!/4/2)`;
		}

		const viewportW = this.iframeEl?.clientWidth ?? 600;
		const viewportH = this.iframeEl?.clientHeight ?? 600;

		// Fast-path: probe viewport coordinates using elementFromPoint (0.05ms)
		if (typeof doc.elementFromPoint === "function") {
			const isScrolled = this.settings.viewMode === "scrolled";
			const probeX1 = isScrolled
				? Math.floor(viewportW / 2)
				: Math.max(32, Math.floor(viewportW * 0.15));
			const probeX2 = isScrolled
				? Math.floor(viewportW / 2)
				: Math.floor(viewportW * 0.5);

			const probes: Array<[number, number]> = [
				[probeX1, Math.min(100, Math.max(36, Math.floor(viewportH * 0.12)))],
				[probeX1, Math.floor(viewportH * 0.25)],
				[probeX1, Math.floor(viewportH * 0.5)],
				[probeX2, Math.floor(viewportH * 0.25)],
				[probeX2, Math.floor(viewportH * 0.5)],
			];

			for (const [px, py] of probes) {
				const hit = doc.elementFromPoint(px, py);
				if (hit && hit !== doc.body && hit !== doc.documentElement) {
					const candidate =
						hit.closest("p, h1, h2, h3, h4, h5, h6, li, div, img, span, a") ??
						hit;
					if (
						candidate &&
						candidate !== doc.body &&
						candidate !== doc.documentElement
					) {
						console.log(
							`[PERF] ⚡ captureVisibleCfi fast-path hit in ${Math.round(performance.now() - tCfi)}ms`,
						);
						return buildCfiFromElement(
							this.currentSectionIndex,
							doc,
							candidate,
						);
					}
				}
			}
		}

		// Fallback: check DOM elements
		const candidates = doc.body.querySelectorAll(
			"p, h1, h2, h3, h4, h5, h6, li, div, img",
		);

		for (let i = 0; i < candidates.length; i++) {
			const el = candidates[i];
			if (!el) continue;
			const rect = el.getBoundingClientRect();
			if (rect.width === 0 && rect.height === 0) continue;

			if (this.settings.viewMode === "scrolled") {
				if (rect.bottom > 12 && rect.top < viewportH) {
					console.log(
						`[PERF] 🔍 captureVisibleCfi fallback hit at element #${i}/${candidates.length} in ${Math.round(performance.now() - tCfi)}ms`,
					);
					return buildCfiFromElement(this.currentSectionIndex, doc, el);
				}
				if (rect.top >= viewportH) {
					break;
				}
			} else {
				if (
					rect.right > 8 &&
					rect.left < viewportW - 8 &&
					rect.bottom > 8 &&
					rect.top < viewportH
				) {
					console.log(
						`[PERF] 🔍 captureVisibleCfi fallback hit at element #${i}/${candidates.length} in ${Math.round(performance.now() - tCfi)}ms`,
					);
					return buildCfiFromElement(this.currentSectionIndex, doc, el);
				}
				if (rect.left > viewportW * 1.5) {
					break;
				}
			}
		}

		console.log(
			`[PERF] 🔍 captureVisibleCfi scanned ${candidates.length} elements in ${Math.round(performance.now() - tCfi)}ms (defaulted to body)`,
		);
		return buildCfiFromElement(this.currentSectionIndex, doc, doc.body);
	}

	private emitRelocation(): void {
		const spine = this.manifest.spine;
		const section = spine[this.currentSectionIndex];
		if (!section) return;

		let sectionProgress = 0;
		if (this.settings.viewMode === "scrolled") {
			const doc = this.getContentDoc();
			const scroller = doc?.scrollingElement ?? doc?.documentElement;
			if (scroller) {
				const maxScroll = Math.max(
					1,
					scroller.scrollHeight - scroller.clientHeight,
				);
				sectionProgress = Math.max(
					0,
					Math.min(1, scroller.scrollTop / maxScroll),
				);
			}
		} else {
			sectionProgress =
				this.currentPageCount > 1
					? this.currentPageIndex / (this.currentPageCount - 1)
					: 0;
		}

		const totalBytes = Math.max(
			1,
			spine.reduce((sum, s) => sum + s.sizeBytes, 0),
		);
		let bytesBefore = 0;
		for (let i = 0; i < this.currentSectionIndex; i++) {
			bytesBefore += spine[i]?.sizeBytes ?? 0;
		}
		const overallFraction = Math.max(
			0,
			Math.min(
				1,
				(bytesBefore + section.sizeBytes * sectionProgress) / totalBytes,
			),
		);

		const tocItem = findMatchingTocItem(this.manifest.toc, section.href);
		const label =
			tocItem?.label ??
			`Section ${String(this.currentSectionIndex + 1)} of ${String(spine.length)}`;

		this.onRelocate({
			cfi: this.currentCfi,
			fraction: overallFraction,
			sectionIndex: this.currentSectionIndex,
			sectionTotal: spine.length,
			pageIndex: this.currentPageIndex,
			pageCount: this.currentPageCount,
			tocItem,
			label,
		});
	}
}
