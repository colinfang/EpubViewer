/**
 * EPUB Fixed-Layout (Pre-paginated) Spread Renderer.
 *
 * Adapted and ported to TypeScript for EpubViewer from upstream foliate-js:
 *   Repository: https://github.com/johnfactotum/foliate-js
 *   Reference: fixed-layout.js
 *   License: MIT © John Factotum
 */

import type { DocumentTransformer } from "../pipeline";
import { runDocumentPipeline } from "../pipeline";
import type {
	BookManifest,
	ReaderInputEvent,
	ReaderSettings,
	RelocationEvent,
	SpineSection,
	TocItem,
} from "../types";
import { parseCfi } from "./epubcfi";

export interface FixedLayoutOptions {
	readonly manifest: BookManifest;
	readonly initialSettings: ReaderSettings;
	readonly transformers?: ReadonlyArray<DocumentTransformer>;
	readonly onRelocate: (event: RelocationEvent) => void;
	readonly onInput: (event: ReaderInputEvent) => void;
}

interface PageSpreadGroup {
	readonly spreadIndex: number;
	readonly left: SpineSection | null;
	readonly right: SpineSection | null;
	readonly primarySection: SpineSection;
}

interface ViewportDimensions {
	readonly width: number;
	readonly height: number;
}

function parseViewportDimensions(doc: Document): ViewportDimensions {
	const viewportMeta = doc.querySelector('meta[name="viewport"]');
	const content = viewportMeta?.getAttribute("content") ?? "";
	const widthMatch = content.match(/width\s*=\s*([0-9.]+)/i);
	const heightMatch = content.match(/height\s*=\s*([0-9.]+)/i);

	if (widthMatch?.[1] && heightMatch?.[1]) {
		const w = Number.parseFloat(widthMatch[1]);
		const h = Number.parseFloat(heightMatch[1]);
		if (w > 0 && h > 0) {
			return { width: w, height: h };
		}
	}

	const bodyStyle = doc.body?.getAttribute("style") ?? "";
	const bodyW = bodyStyle.match(/width\s*:\s*([0-9.]+)px/i);
	const bodyH = bodyStyle.match(/height\s*:\s*([0-9.]+)px/i);
	if (bodyW?.[1] && bodyH?.[1]) {
		const w = Number.parseFloat(bodyW[1]);
		const h = Number.parseFloat(bodyH[1]);
		if (w > 0 && h > 0) {
			return { width: w, height: h };
		}
	}

	const svgEl = doc.querySelector("svg[viewBox]");
	const viewBox = svgEl
		?.getAttribute("viewBox")
		?.trim()
		.split(/[\s,]+/);
	if (viewBox && viewBox.length === 4) {
		const w = Number.parseFloat(viewBox[2] ?? "0");
		const h = Number.parseFloat(viewBox[3] ?? "0");
		if (w > 0 && h > 0) {
			return { width: w, height: h };
		}
	}

	return { width: 1000, height: 1400 };
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

export class FixedLayoutRenderer {
	private readonly manifest: BookManifest;
	private settings: ReaderSettings;
	private readonly transformers: ReadonlyArray<DocumentTransformer> | undefined;
	private readonly onRelocate: (event: RelocationEvent) => void;
	private readonly onInput: (event: ReaderInputEvent) => void;

	private hostContainer: HTMLElement | null = null;
	private shadowRoot: ShadowRoot | null = null;
	private stageEl: HTMLDivElement | null = null;
	private spreadWrapperEl: HTMLDivElement | null = null;
	private leftSlotEl: HTMLDivElement | null = null;
	private rightSlotEl: HTMLDivElement | null = null;
	private leftIframeEl: HTMLIFrameElement | null = null;
	private rightIframeEl: HTMLIFrameElement | null = null;
	private resizeObserver: ResizeObserver | null = null;

	private spreads: ReadonlyArray<PageSpreadGroup> = [];
	private currentSpreadIndex = 0;
	private currentLeftDims: ViewportDimensions = { width: 1447, height: 2143 };
	private currentRightDims: ViewportDimensions | null = null;
	private isLoading = false;
	private destroyed = false;

	public constructor(options: FixedLayoutOptions) {
		this.manifest = options.manifest;
		this.settings = options.initialSettings;
		this.transformers = options.transformers;
		this.onRelocate = options.onRelocate;
		this.onInput = options.onInput;
		this.rebuildSpreads();
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

		const style = document.createElement("style");
		style.textContent = `
            :host {
                display: block;
                width: 100%;
                height: 100%;
                position: relative;
            }
            .fxl-stage {
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                position: relative;
                box-sizing: border-box;
                padding: 16px;
            }
            .fxl-spread {
                display: flex;
                align-items: center;
                justify-content: center;
                position: relative;
                box-shadow: 0 12px 36px rgba(0, 0, 0, 0.22);
                border-radius: 4px;
                overflow: hidden;
                background: #ffffff;
            }
            .fxl-slot {
                position: relative;
                overflow: hidden;
                background: #ffffff;
            }
            .fxl-slot iframe {
                border: 0;
                display: block;
                transform-origin: top left;
                background: #ffffff;
            }
            .fxl-crease {
                position: absolute;
                top: 0;
                bottom: 0;
                left: 50%;
                width: 2px;
                transform: translateX(-50%);
                background: linear-gradient(
                    to right,
                    rgba(0, 0, 0, 0.18),
                    rgba(255, 255, 255, 0.15),
                    rgba(0, 0, 0, 0.18)
                );
                pointer-events: none;
                z-index: 5;
            }
        `;
		this.shadowRoot.appendChild(style);

		const stage = document.createElement("div");
		stage.className = "fxl-stage";
		this.stageEl = stage;

		const spreadWrapper = document.createElement("div");
		spreadWrapper.className = "fxl-spread";
		this.spreadWrapperEl = spreadWrapper;

		const leftSlot = document.createElement("div");
		leftSlot.className = "fxl-slot";
		const leftIframe = document.createElement("iframe");
		leftIframe.setAttribute("title", "EPUB Fixed Layout Left Page");
		leftIframe.setAttribute("sandbox", "allow-same-origin");
		leftSlot.appendChild(leftIframe);
		this.leftSlotEl = leftSlot;
		this.leftIframeEl = leftIframe;

		const rightSlot = document.createElement("div");
		rightSlot.className = "fxl-slot";
		const rightIframe = document.createElement("iframe");
		rightIframe.setAttribute("title", "EPUB Fixed Layout Right Page");
		rightIframe.setAttribute("sandbox", "allow-same-origin");
		rightSlot.appendChild(rightIframe);
		this.rightSlotEl = rightSlot;
		this.rightIframeEl = rightIframe;

		const crease = document.createElement("div");
		crease.className = "fxl-crease";

		spreadWrapper.appendChild(leftSlot);
		spreadWrapper.appendChild(rightSlot);
		spreadWrapper.appendChild(crease);
		stage.appendChild(spreadWrapper);
		this.shadowRoot.appendChild(stage);

		if (typeof ResizeObserver !== "undefined") {
			let lastW = 0;
			let lastH = 0;
			this.resizeObserver = new ResizeObserver((entries) => {
				if (this.destroyed || this.isLoading) return;
				const entry = entries[0];
				const newW = Math.round(entry?.contentRect.width ?? stage.clientWidth);
				const newH = Math.round(
					entry?.contentRect.height ?? stage.clientHeight,
				);
				if (Math.abs(newW - lastW) < 2 && Math.abs(newH - lastH) < 2) return;
				lastW = newW;
				lastH = newH;
				this.fitSpreadToStage();
			});
			this.resizeObserver.observe(stage);
		}

		if (initialCfi) {
			const parsed = parseCfi(initialCfi);
			const spreadIdx = parsed
				? this.findSpreadIndexForSpine(parsed.spineIndex)
				: 0;
			await this.renderSpread(spreadIdx);
		} else {
			await this.renderSpread(0);
		}
	}

	public async next(): Promise<void> {
		if (this.isLoading || this.destroyed) return;
		if (this.currentSpreadIndex + 1 < this.spreads.length) {
			await this.renderSpread(this.currentSpreadIndex + 1);
		}
	}

	public async prev(): Promise<void> {
		if (this.isLoading || this.destroyed) return;
		if (this.currentSpreadIndex > 0) {
			await this.renderSpread(this.currentSpreadIndex - 1);
		}
	}

	public async goToHref(href: string): Promise<void> {
		const target = this.manifest.resolveHrefToSpine(href);
		if (!target) return;
		const spreadIdx = this.findSpreadIndexForSpine(target.index);
		await this.renderSpread(spreadIdx);
	}

	public async goToFraction(fraction: number): Promise<void> {
		const clamped = Math.max(0, Math.min(1, fraction));
		if (this.spreads.length === 0) return;
		const targetSpread = Math.min(
			this.spreads.length - 1,
			Math.floor(clamped * this.spreads.length),
		);
		await this.renderSpread(Math.max(0, targetSpread));
	}

	public async goToCfi(cfi: string): Promise<void> {
		const parsed = parseCfi(cfi);
		if (!parsed) return;
		const spreadIdx = this.findSpreadIndexForSpine(parsed.spineIndex);
		await this.renderSpread(spreadIdx);
	}

	public async applySettings(settings: ReaderSettings): Promise<void> {
		const currentPrimarySection =
			this.spreads[this.currentSpreadIndex]?.primarySection.index ?? 0;
		const prevMode = this.settings.viewMode;
		this.settings = settings;

		if (prevMode !== settings.viewMode) {
			this.rebuildSpreads();
			const newSpreadIdx = this.findSpreadIndexForSpine(currentPrimarySection);
			await this.renderSpread(newSpreadIdx);
		} else {
			this.fitSpreadToStage();
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

	private rebuildSpreads(): void {
		const spine = this.manifest.spine;
		const useTwoColumns = this.settings.viewMode === "two-column";
		const groups: PageSpreadGroup[] = [];

		if (!useTwoColumns) {
			for (let i = 0; i < spine.length; i++) {
				const sec = spine[i];
				if (!sec) continue;
				groups.push({
					spreadIndex: groups.length,
					left: sec,
					right: null,
					primarySection: sec,
				});
			}
			this.spreads = groups;
			return;
		}

		let i = 0;
		while (i < spine.length) {
			const current = spine[i];
			if (!current) {
				i++;
				continue;
			}
			const next = spine[i + 1];

			if (current.pageSpread === "center") {
				groups.push({
					spreadIndex: groups.length,
					left: current,
					right: null,
					primarySection: current,
				});
				i += 1;
			} else if (current.pageSpread === "right") {
				// Solo right-hand page (such as cover page)
				groups.push({
					spreadIndex: groups.length,
					left: current,
					right: null,
					primarySection: current,
				});
				i += 1;
			} else if (
				current.pageSpread === "left" &&
				next &&
				(next.pageSpread === "right" || next.pageSpread === "none")
			) {
				groups.push({
					spreadIndex: groups.length,
					left: current,
					right: next,
					primarySection: current,
				});
				i += 2;
			} else if (i === 0) {
				// First page defaults to solo cover if unspecified
				groups.push({
					spreadIndex: groups.length,
					left: current,
					right: null,
					primarySection: current,
				});
				i += 1;
			} else if (next) {
				groups.push({
					spreadIndex: groups.length,
					left: current,
					right: next,
					primarySection: current,
				});
				i += 2;
			} else {
				groups.push({
					spreadIndex: groups.length,
					left: current,
					right: null,
					primarySection: current,
				});
				i += 1;
			}
		}

		this.spreads = groups;
	}

	private findSpreadIndexForSpine(spineIndex: number): number {
		for (let i = 0; i < this.spreads.length; i++) {
			const group = this.spreads[i];
			if (!group) continue;
			if (
				group.left?.index === spineIndex ||
				group.right?.index === spineIndex
			) {
				return i;
			}
		}
		return 0;
	}

	private async renderSpread(spreadIndex: number): Promise<void> {
		const group = this.spreads[spreadIndex];
		if (!group || !this.leftIframeEl || !this.rightIframeEl) return;

		this.isLoading = true;
		this.currentSpreadIndex = spreadIndex;

		try {
			if (group.left) {
				const leftDoc = await group.left.loadDocument();
				runDocumentPipeline(
					leftDoc,
					{
						bookMeta: this.manifest.metadata,
						sectionHref: group.left.href,
						settings: this.settings,
					},
					this.transformers,
				);
				this.currentLeftDims = parseViewportDimensions(leftDoc);
				await this.loadDocIntoIframe(
					this.leftIframeEl,
					leftDoc,
					group.left,
					"left",
				);
			}

			if (group.right && this.rightSlotEl) {
				this.rightSlotEl.style.display = "block";
				const rightDoc = await group.right.loadDocument();
				runDocumentPipeline(
					rightDoc,
					{
						bookMeta: this.manifest.metadata,
						sectionHref: group.right.href,
						settings: this.settings,
					},
					this.transformers,
				);
				this.currentRightDims = parseViewportDimensions(rightDoc);
				await this.loadDocIntoIframe(
					this.rightIframeEl,
					rightDoc,
					group.right,
					"right",
				);
			} else if (this.rightSlotEl) {
				this.rightSlotEl.style.display = "none";
				this.currentRightDims = null;
			}

			if (this.destroyed) return;
			this.fitSpreadToStage();
			this.emitRelocation(group);
		} finally {
			this.isLoading = false;
		}
	}

	private loadDocIntoIframe(
		iframe: HTMLIFrameElement,
		doc: Document,
		section: SpineSection,
		side: "left" | "right",
	): Promise<void> {
		return new Promise((resolve) => {
			const serializer = new XMLSerializer();
			const html = serializer.serializeToString(doc);
			let settled = false;
			const done = () => {
				if (!settled) {
					settled = true;
					this.bindIframeEvents(iframe, section, side);
					resolve();
				}
			};
			iframe.onload = done;
			iframe.srcdoc = html;
			setTimeout(done, 50);
		});
	}

	private bindIframeEvents(
		iframe: HTMLIFrameElement,
		section: SpineSection,
		side: "left" | "right",
	): void {
		const doc = iframe.contentDocument;
		if (!doc) return;

		let lastPointerType = "mouse";
		doc.addEventListener(
			"pointerdown",
			(e: PointerEvent) => {
				if (e.pointerType) {
					lastPointerType = e.pointerType;
				}
			},
			{ passive: true },
		);
		doc.addEventListener(
			"touchstart",
			() => {
				lastPointerType = "touch";
			},
			{ passive: true },
		);

		doc.addEventListener("keydown", (e: KeyboardEvent) => {
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

		doc.addEventListener("click", (e: MouseEvent) => {
			const target =
				e.target instanceof Element
					? e.target
					: (e.target as Node | null)?.parentElement;
			const anchor = target?.closest("a[href]");
			if (anchor) {
				const rawHref = anchor.getAttribute("href")?.trim() ?? "";
				if (rawHref && !rawHref.startsWith("#")) {
					e.preventDefault();
					const resolved = section.resolveHref(rawHref);
					void this.goToHref(resolved);
					return;
				}
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

			if (!isTouch) {
				this.onInput({ type: "toggle-chrome" });
				return;
			}

			const isTwoPageSpread =
				this.currentRightDims !== null &&
				this.rightSlotEl !== null &&
				this.rightSlotEl.style.display !== "none";

			const viewWidth = Math.max(
				1,
				iframe.clientWidth ||
					doc.documentElement.clientWidth ||
					window.innerWidth,
			);
			const x = e.clientX;

			if (isTwoPageSpread) {
				if (side === "left") {
					if (x < viewWidth * 0.7) {
						this.onInput({ type: "prev" });
						return;
					}
					this.onInput({ type: "toggle-chrome" });
					return;
				}
				// side === 'right'
				if (x > viewWidth * 0.3) {
					this.onInput({ type: "next" });
					return;
				}
				this.onInput({ type: "toggle-chrome" });
				return;
			}

			// Single page layout
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

	private fitSpreadToStage(): void {
		const stage = this.stageEl;
		const leftSlot = this.leftSlotEl;
		const rightSlot = this.rightSlotEl;
		const leftIframe = this.leftIframeEl;
		const rightIframe = this.rightIframeEl;
		if (!stage || !leftSlot || !leftIframe) return;

		const rect = stage.getBoundingClientRect();
		const availW = Math.max(240, rect.width - 32);
		const availH = Math.max(240, rect.height - 32);

		const leftW = this.currentLeftDims.width;
		const leftH = this.currentLeftDims.height;
		const rightDims = this.currentRightDims;

		const totalLogicalW = rightDims ? leftW + rightDims.width : leftW;
		const totalLogicalH = rightDims ? Math.max(leftH, rightDims.height) : leftH;

		const scale = Math.min(availW / totalLogicalW, availH / totalLogicalH);

		const scaledLeftW = Math.floor(leftW * scale);
		const scaledLeftH = Math.floor(leftH * scale);

		leftSlot.style.width = `${String(scaledLeftW)}px`;
		leftSlot.style.height = `${String(scaledLeftH)}px`;
		leftIframe.style.width = `${String(leftW)}px`;
		leftIframe.style.height = `${String(leftH)}px`;
		leftIframe.style.transform = `scale(${String(scale)})`;

		const crease = this.spreadWrapperEl?.querySelector(
			".fxl-crease",
		) as HTMLElement | null;

		if (rightDims && rightSlot && rightIframe) {
			const scaledRightW = Math.floor(rightDims.width * scale);
			const scaledRightH = Math.floor(rightDims.height * scale);
			rightSlot.style.display = "block";
			rightSlot.style.width = `${String(scaledRightW)}px`;
			rightSlot.style.height = `${String(scaledRightH)}px`;
			rightIframe.style.width = `${String(rightDims.width)}px`;
			rightIframe.style.height = `${String(rightDims.height)}px`;
			rightIframe.style.transform = `scale(${String(scale)})`;
			if (crease) crease.style.display = "block";
		} else {
			if (rightSlot) rightSlot.style.display = "none";
			if (crease) crease.style.display = "none";
		}
	}

	private emitRelocation(group: PageSpreadGroup): void {
		const primary = group.primarySection;
		const spine = this.manifest.spine;
		const spineStep = (primary.index + 1) * 2;
		const cfi = `epubcfi(/6/${String(spineStep)}!/4/2)`;

		const fraction =
			this.spreads.length > 1
				? this.currentSpreadIndex / (this.spreads.length - 1)
				: 0;

		const tocItem = findMatchingTocItem(this.manifest.toc, primary.href);
		const pageNumbers =
			group.left && group.right
				? `Pages ${String(group.left.index + 1)}–${String(group.right.index + 1)} of ${String(spine.length)}`
				: `Page ${String(primary.index + 1)} of ${String(spine.length)}`;

		this.onRelocate({
			cfi,
			fraction,
			sectionIndex: primary.index,
			sectionTotal: spine.length,
			pageIndex: this.currentSpreadIndex,
			pageCount: this.spreads.length,
			tocItem,
			label: tocItem?.label ?? pageNumbers,
		});
	}
}
