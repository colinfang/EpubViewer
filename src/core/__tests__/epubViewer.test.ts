import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadEpubFromFile } from "../archive/epubLoader";
import { normalizeZipPath, resolveRelativeZipPath } from "../archive/zipReader";
import {
	buildCfiFromElement,
	parseCfi,
	resolveCfiInDocument,
} from "../engine/epubcfi";
import { runDocumentPipeline } from "../pipeline";
import { DEFAULT_READER_SETTINGS } from "../types";

describe("ZIP Path Resolution", () => {
	it("normalizes paths and resolves relative segments accurately", () => {
		expect(normalizeZipPath("/OEBPS/css/../fonts/f157.otf")).toBe(
			"OEBPS/fonts/f157.otf",
		);
		expect(
			resolveRelativeZipPath("OEBPS/css/FontSrc.css", "../fonts/f157.otf"),
		).toBe("OEBPS/fonts/f157.otf");
		expect(
			resolveRelativeZipPath(
				"Munc_9780399558245_epub3_opf_r1.opf",
				"OEBPS/Munc_9780399558245_epub3_c001_r1.xhtml",
			),
		).toBe("OEBPS/Munc_9780399558245_epub3_c001_r1.xhtml");
	});
});

describe("EPUB CFI Parser & Resolver", () => {
	it("builds, parses, and resolves a CFI round-trip in a chapter document", () => {
		const parser = new DOMParser();
		const doc = parser.parseFromString(
			'<html><head></head><body><div><p id="p1">First</p><p id="p2">Second</p></div></body></html>',
			"text/html",
		);
		const secondP = doc.getElementById("p2");
		expect(secondP).not.toBeNull();

		const cfi = buildCfiFromElement(2, doc, secondP);
		expect(cfi).toBe("epubcfi(/6/6!/4/2/4[p2])");

		const parsed = parseCfi(cfi);
		expect(parsed).not.toBeNull();
		expect(parsed?.spineIndex).toBe(2);
		expect(parsed?.elementId).toBe("p2");

		const resolved = parsed ? resolveCfiInDocument(doc, parsed) : null;
		expect(resolved).toBe(secondP);
	});
});

describe("DocumentTransformPipeline", () => {
	it("injects theme and typography CSS variables for reflowable books", () => {
		const parser = new DOMParser();
		const doc = parser.parseFromString(
			"<html><head><title>Ch 1</title></head><body><p>Hello</p></body></html>",
			"text/html",
		);

		runDocumentPipeline(doc, {
			bookMeta: {
				identifier: "id-1",
				title: "Sample",
				author: "Author",
				publisher: "",
				language: "en",
				description: "",
				layout: "reflowable",
				spread: "auto",
				orientation: "auto",
				direction: "ltr",
				coverBlobUrl: null,
				epubVersion: "3.0",
				viewportDimensions: null,
				embeddedFonts: [],
				stats: {
					spineCount: 1,
					imageCount: 0,
					fontCount: 0,
					cssCount: 0,
					totalEntriesCount: 1,
				},
			},
			sectionHref: "OEBPS/ch1.xhtml",
			settings: {
				...DEFAULT_READER_SETTINGS,
				theme: "sepia",
				fontFamily: "serif",
				fontSizePercent: 120,
				lineHeight: 1.8,
			},
		});

		const injected = doc.getElementById("epub-viewer-theme-typography");
		expect(injected).not.toBeNull();
		expect(injected?.textContent).toContain("--reader-bg: #f4ecd8;");
		expect(injected?.textContent).toContain("--reader-font-size: 120%;");
		expect(injected?.textContent).toContain("--reader-line-height: 1.8;");
	});

	it("does not inject font or size overrides for pre-paginated fixed-layout books", () => {
		const parser = new DOMParser();
		const doc = parser.parseFromString(
			"<html><head><title>Fixed Page</title></head><body><p>Illustration</p></body></html>",
			"text/html",
		);

		runDocumentPipeline(doc, {
			bookMeta: {
				identifier: "id-fixed",
				title: "Fixed Layout Comic",
				author: "Illustrator",
				publisher: "",
				language: "en",
				description: "",
				layout: "pre-paginated",
				spread: "auto",
				orientation: "auto",
				direction: "ltr",
				coverBlobUrl: null,
				epubVersion: "3.0",
				viewportDimensions: { width: 1000, height: 1500 },
				embeddedFonts: [],
				stats: {
					spineCount: 1,
					imageCount: 1,
					fontCount: 0,
					cssCount: 0,
					totalEntriesCount: 2,
				},
			},
			sectionHref: "OEBPS/page1.xhtml",
			settings: {
				...DEFAULT_READER_SETTINGS,
				fontFamily: "mono",
				fontSizePercent: 150,
				lineHeight: 2.0,
			},
		});

		const injected = doc.getElementById("epub-viewer-theme-typography");
		expect(injected).not.toBeNull();
		expect(injected?.textContent).not.toContain("font-family");
		expect(injected?.textContent).not.toContain("--reader-font-size");
		expect(injected?.textContent).toContain("overflow: hidden !important;");
	});
});

describe("Real EPUB Archive Loading (test_epub/)", () => {
	it('loads "First Flight 2023.epub" as a Fixed-Layout (pre-paginated) book with spreads', async () => {
		const filePath = path.resolve(
			process.cwd(),
			"test_epub/First Flight 2023.epub",
		);
		const buf = fs.readFileSync(filePath);
		const blob = Object.assign(
			new Blob([buf], { type: "application/epub+zip" }),
			{
				name: "First Flight 2023.epub",
			},
		);

		const res = await loadEpubFromFile(blob);
		if (!res.ok) {
			throw new Error(res.error);
		}

		const manifest = res.value;
		expect(manifest.metadata.title).toBe("The Timekeepers: First Flight");
		expect(manifest.metadata.author).toBe("SJ King");
		expect(manifest.metadata.layout).toBe("pre-paginated");
		expect(manifest.metadata.epubVersion).toBe("3.0");
		expect(manifest.metadata.viewportDimensions).toEqual({
			width: 1447,
			height: 2143,
		});
		expect(manifest.metadata.embeddedFonts.length).toBe(241);
		const f7Font = manifest.metadata.embeddedFonts.find(
			(f) => f.name === "f7.otf",
		);
		expect(f7Font?.fontFamily).toBe("Generic7");
		expect(manifest.metadata.stats.fontCount).toBe(241);
		expect(manifest.metadata.stats.spineCount).toBeGreaterThan(100);
		expect(manifest.spine.length).toBeGreaterThan(100);
		expect(manifest.spine[0]?.pageSpread).toBe("right");
		expect(manifest.spine[1]?.pageSpread).toBe("left");
		expect(manifest.spine[2]?.pageSpread).toBe("right");

		const pageDoc = await manifest.spine[3]?.loadDocument();
		expect(pageDoc).toBeDefined();
		const img = pageDoc?.querySelector("img");
		expect(img?.getAttribute("src")).toMatch(/^blob:/);

		// Verify on-demand font inspector resolution for fonts beyond the upfront cap
		expect(manifest.loadFontDetails).toBeDefined();
		const f100Font = manifest.metadata.embeddedFonts.find(
			(f) => f.name === "f100.otf",
		);
		expect(f100Font).toBeDefined();
		if (f100Font && manifest.loadFontDetails) {
			const details = await manifest.loadFontDetails(f100Font.path);
			expect(details?.familyName).toBe("Generic100");
		}

		manifest.destroy();
	});

	it('loads "Goes to School 2016.epub" as a Reflowable book with TOC and chapters', async () => {
		const filePath = path.resolve(
			process.cwd(),
			"test_epub/Goes to School 2016.epub",
		);
		const buf = fs.readFileSync(filePath);
		const blob = Object.assign(
			new Blob([buf], { type: "application/epub+zip" }),
			{
				name: "Goes to School 2016.epub",
			},
		);

		const res = await loadEpubFromFile(blob);
		if (!res.ok) {
			throw new Error(res.error);
		}

		const manifest = res.value;
		expect(manifest.metadata.title).toBe("Isadora Moon Goes to School");
		expect(manifest.metadata.author).toBe("Harriet Muncaster");
		expect(manifest.metadata.layout).toBe("reflowable");
		expect(manifest.metadata.epubVersion).toBe("3.0");
		expect(manifest.metadata.embeddedFonts.length).toBe(3);
		const fontNames = manifest.metadata.embeddedFonts.map((f) => f.name);
		expect(fontNames).toContain("Shift-Light.otf");
		expect(fontNames).toContain("Fort-Book.otf");
		expect(fontNames).toContain("Shift-BoldItalic.otf");
		const fortFont = manifest.metadata.embeddedFonts.find(
			(f) => f.name === "Fort-Book.otf",
		);
		expect(fortFont?.fontFamily).toBe("Fort");
		expect(fortFont?.subfamily).toBe("Book");
		expect(fortFont?.fullName).toBe("Fort-Book");
		expect(manifest.metadata.stats.fontCount).toBe(3);
		expect(manifest.metadata.stats.spineCount).toBeGreaterThan(10);
		expect(manifest.toc.length).toBeGreaterThan(5);
		expect(manifest.spine.length).toBeGreaterThan(10);

		const chapterDoc = await manifest.spine[7]?.loadDocument();
		expect(chapterDoc).toBeDefined();
		const stylesheet = chapterDoc?.querySelector('link[rel="stylesheet"]');
		expect(stylesheet?.getAttribute("href")).toMatch(/^blob:/);

		manifest.destroy();
	});

	it("mounts engine directly at saved CFI without defaulting to section 0", async () => {
		const filePath = path.resolve(
			process.cwd(),
			"test_epub/Goes to School 2016.epub",
		);
		const buf = fs.readFileSync(filePath);
		const blob = Object.assign(
			new Blob([buf], { type: "application/epub+zip" }),
			{
				name: "Goes to School 2016.epub",
			},
		);

		const res = await loadEpubFromFile(blob);
		if (!res.ok) throw new Error(res.error);
		const manifest = res.value;

		const targetCfi = "epubcfi(/6/16!/4/2)"; // Spine index 7
		let relocatedCfi = "";
		let relocatedSection = -1;

		const { createReaderEngine } = await import("../engine/readerEngine");
		const engine = createReaderEngine({
			manifest,
			initialSettings: DEFAULT_READER_SETTINGS,
		});

		engine.onRelocate((evt) => {
			relocatedCfi = evt.cfi;
			relocatedSection = evt.sectionIndex;
		});

		const container = document.createElement("div");
		document.body.appendChild(container);
		await engine.mount(container, targetCfi);

		expect(relocatedSection).toBe(7);
		expect(relocatedCfi).toContain("/6/16!");

		engine.destroy();
		manifest.destroy();
		container.remove();
	});
});

describe("Touch Tap to Flip vs. Mouse Click Navigation", () => {
	function createMockManifest(
		layout: "reflowable" | "pre-paginated",
	): import("../types").BookManifest {
		const parser = new DOMParser();
		const doc = parser.parseFromString(
			"<!DOCTYPE html><html><head><title>Test</title></head><body><p>Mock Chapter</p></body></html>",
			"application/xhtml+xml",
		);

		const spine: import("../types").SpineSection[] = [
			{
				index: 0,
				id: "sec-0",
				href: "OEBPS/ch1.xhtml",
				linear: true,
				pageSpread: "left",
				sizeBytes: 1000,
				loadDocument: async () => doc.cloneNode(true) as Document,
				createUrl: async () => "blob:mock-url-0",
				resolveHref: (h) => h,
				unload: () => {},
			},
			{
				index: 1,
				id: "sec-1",
				href: "OEBPS/ch2.xhtml",
				linear: true,
				pageSpread: "right",
				sizeBytes: 1000,
				loadDocument: async () => doc.cloneNode(true) as Document,
				createUrl: async () => "blob:mock-url-1",
				resolveHref: (h) => h,
				unload: () => {},
			},
		];

		return {
			fileHash: "mock-hash",
			fileName: "mock.epub",
			fileSize: 2000,
			metadata: {
				identifier: "mock-id",
				title: "Mock Book",
				author: "Mock Author",
				publisher: "",
				language: "en",
				description: "",
				layout,
				spread: "auto",
				orientation: "auto",
				direction: "ltr",
				coverBlobUrl: null,
				epubVersion: "3.0",
				viewportDimensions: { width: 800, height: 1200 },
				embeddedFonts: [],
				stats: {
					spineCount: 2,
					imageCount: 0,
					fontCount: 0,
					cssCount: 0,
					totalEntriesCount: 2,
				},
			},
			toc: [],
			spine,
			resolveHrefToSpine: () => null,
			destroy: () => {},
		};
	}

	it("Reflowable: touch flips prev/next on sides, toggles chrome in center, while mouse never flips", async () => {
		const { ReflowablePaginator } = await import("../engine/paginator");
		const manifest = createMockManifest("reflowable");
		const inputEvents: import("../types").ReaderInputEvent[] = [];

		const container = document.createElement("div");
		document.body.appendChild(container);

		const paginator = new ReflowablePaginator({
			manifest,
			initialSettings: {
				...DEFAULT_READER_SETTINGS,
				viewMode: "single-column",
			},
			onRelocate: () => {},
			onInput: (evt) => inputEvents.push(evt),
		});

		await paginator.mount(container);

		const shadowRoot = container.firstElementChild?.shadowRoot;
		const iframe = shadowRoot?.querySelector("iframe") as HTMLIFrameElement;
		expect(iframe).toBeDefined();
		const doc = iframe.contentDocument;
		expect(doc).not.toBeNull();
		if (!doc) return;

		Object.defineProperty(iframe, "clientWidth", {
			value: 600,
			configurable: true,
		});

		const targetNode = doc.body ?? doc;

		// 1. Mouse click on the left side (x = 50) -> MUST toggle chrome, NOT flip prev
		inputEvents.length = 0;
		targetNode.dispatchEvent(
			new PointerEvent("pointerdown", {
				bubbles: true,
				pointerType: "mouse",
			}),
		);
		targetNode.dispatchEvent(
			new PointerEvent("click", {
				bubbles: true,
				pointerType: "mouse",
				clientX: 50,
			}),
		);
		expect(inputEvents).toEqual([{ type: "toggle-chrome" }]);

		// 2. Mouse click on the right side (x = 550) -> MUST toggle chrome, NOT flip next
		inputEvents.length = 0;
		targetNode.dispatchEvent(
			new PointerEvent("pointerdown", {
				bubbles: true,
				pointerType: "mouse",
			}),
		);
		targetNode.dispatchEvent(
			new PointerEvent("click", {
				bubbles: true,
				pointerType: "mouse",
				clientX: 550,
			}),
		);
		expect(inputEvents).toEqual([{ type: "toggle-chrome" }]);

		// 3. Touch tap on the left zone (x = 50 < 600 * 0.33) -> MUST flip prev
		inputEvents.length = 0;
		targetNode.dispatchEvent(
			new PointerEvent("pointerdown", {
				bubbles: true,
				pointerType: "touch",
			}),
		);
		targetNode.dispatchEvent(
			new PointerEvent("click", {
				bubbles: true,
				pointerType: "touch",
				clientX: 50,
			}),
		);
		expect(inputEvents).toEqual([{ type: "prev" }]);

		// 4. Touch tap on the right zone (x = 550 > 600 * 0.67) -> MUST flip next
		inputEvents.length = 0;
		targetNode.dispatchEvent(
			new PointerEvent("pointerdown", {
				bubbles: true,
				pointerType: "touch",
			}),
		);
		targetNode.dispatchEvent(
			new PointerEvent("click", {
				bubbles: true,
				pointerType: "touch",
				clientX: 550,
			}),
		);
		expect(inputEvents).toEqual([{ type: "next" }]);

		// 5. Touch tap in the center zone (x = 300) -> MUST toggle chrome
		inputEvents.length = 0;
		targetNode.dispatchEvent(
			new PointerEvent("pointerdown", {
				bubbles: true,
				pointerType: "touch",
			}),
		);
		targetNode.dispatchEvent(
			new PointerEvent("click", {
				bubbles: true,
				pointerType: "touch",
				clientX: 300,
			}),
		);
		expect(inputEvents).toEqual([{ type: "toggle-chrome" }]);

		paginator.destroy();
		container.remove();
	});

	it("Reflowable: touch tap in continuous scroll mode always toggles chrome without flipping", async () => {
		const { ReflowablePaginator } = await import("../engine/paginator");
		const manifest = createMockManifest("reflowable");
		const inputEvents: import("../types").ReaderInputEvent[] = [];

		const container = document.createElement("div");
		document.body.appendChild(container);

		const paginator = new ReflowablePaginator({
			manifest,
			initialSettings: {
				...DEFAULT_READER_SETTINGS,
				viewMode: "scrolled",
			},
			onRelocate: () => {},
			onInput: (evt) => inputEvents.push(evt),
		});

		await paginator.mount(container);

		const shadowRoot = container.firstElementChild?.shadowRoot;
		const iframe = shadowRoot?.querySelector("iframe") as HTMLIFrameElement;
		const doc = iframe?.contentDocument;
		expect(doc).not.toBeNull();
		if (!doc) return;

		Object.defineProperty(iframe, "clientWidth", {
			value: 600,
			configurable: true,
		});

		const targetNode = doc.body ?? doc;

		// Touch tap on side in scrolled mode -> toggles chrome
		inputEvents.length = 0;
		targetNode.dispatchEvent(
			new PointerEvent("click", {
				bubbles: true,
				pointerType: "touch",
				clientX: 50,
			}),
		);
		expect(inputEvents).toEqual([{ type: "toggle-chrome" }]);

		paginator.destroy();
		container.remove();
	});

	it("Fixed Layout: touch tap flips prev on left page and next on right page, while mouse only toggles chrome", async () => {
		const { FixedLayoutRenderer } = await import("../engine/fixedLayout");
		const manifest = createMockManifest("pre-paginated");
		const inputEvents: import("../types").ReaderInputEvent[] = [];

		const container = document.createElement("div");
		document.body.appendChild(container);

		const renderer = new FixedLayoutRenderer({
			manifest,
			initialSettings: {
				...DEFAULT_READER_SETTINGS,
				viewMode: "two-column",
			},
			onRelocate: () => {},
			onInput: (evt) => inputEvents.push(evt),
		});

		await renderer.mount(container);

		const shadowRoot = container.firstElementChild?.shadowRoot;
		const iframes = shadowRoot?.querySelectorAll("iframe");
		expect(iframes?.length).toBe(2);

		const leftIframe = iframes?.[0];
		const rightIframe = iframes?.[1];
		expect(leftIframe?.contentDocument).not.toBeNull();
		expect(rightIframe?.contentDocument).not.toBeNull();

		if (!leftIframe?.contentDocument || !rightIframe?.contentDocument) return;

		Object.defineProperty(leftIframe, "clientWidth", {
			value: 400,
			configurable: true,
		});
		Object.defineProperty(rightIframe, "clientWidth", {
			value: 400,
			configurable: true,
		});

		const leftTarget =
			leftIframe.contentDocument.body ?? leftIframe.contentDocument;
		const rightTarget =
			rightIframe.contentDocument.body ?? rightIframe.contentDocument;

		// 1. Mouse click on left iframe -> toggle chrome
		inputEvents.length = 0;
		leftTarget.dispatchEvent(
			new PointerEvent("click", {
				bubbles: true,
				pointerType: "mouse",
				clientX: 100,
			}),
		);
		expect(inputEvents).toEqual([{ type: "toggle-chrome" }]);

		// 2. Touch tap on left iframe outer area (x = 100 < 400 * 0.7) -> prev
		inputEvents.length = 0;
		leftTarget.dispatchEvent(
			new PointerEvent("click", {
				bubbles: true,
				pointerType: "touch",
				clientX: 100,
			}),
		);
		expect(inputEvents).toEqual([{ type: "prev" }]);

		// 3. Touch tap on left iframe near crease (x = 350 >= 400 * 0.7) -> toggle-chrome
		inputEvents.length = 0;
		leftTarget.dispatchEvent(
			new PointerEvent("click", {
				bubbles: true,
				pointerType: "touch",
				clientX: 350,
			}),
		);
		expect(inputEvents).toEqual([{ type: "toggle-chrome" }]);

		// 4. Touch tap on right iframe outer area (x = 300 > 400 * 0.3) -> next
		inputEvents.length = 0;
		rightTarget.dispatchEvent(
			new PointerEvent("click", {
				bubbles: true,
				pointerType: "touch",
				clientX: 300,
			}),
		);
		expect(inputEvents).toEqual([{ type: "next" }]);

		// 5. Touch tap on right iframe near crease (x = 50 <= 400 * 0.3) -> toggle-chrome
		inputEvents.length = 0;
		rightTarget.dispatchEvent(
			new PointerEvent("click", {
				bubbles: true,
				pointerType: "touch",
				clientX: 50,
			}),
		);
		expect(inputEvents).toEqual([{ type: "toggle-chrome" }]);

		renderer.destroy();
		container.remove();
	});
});
