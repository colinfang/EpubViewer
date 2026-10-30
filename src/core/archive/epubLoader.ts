import {
	type BookLayoutMode,
	type BookManifest,
	type BookMetadata,
	type BookPackageStats,
	type EmbeddedFontFormat,
	type EmbeddedFontInfo,
	err,
	ok,
	type PageSpreadPosition,
	type ParsedFontNames,
	type Result,
	type SpineSection,
	type TocItem,
} from "../types";
import {
	computeFileFingerprint,
	type LazyZipArchive,
	normalizeZipPath,
	openLazyZipArchive,
	resolveRelativeZipPath,
} from "./zipReader";

interface ManifestItem {
	readonly id: string;
	readonly href: string;
	readonly fullPath: string;
	readonly mediaType: string;
	readonly properties: ReadonlyArray<string>;
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
	".xhtml": "application/xhtml+xml",
	".html": "text/html",
	".htm": "text/html",
	".css": "text/css",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".otf": "font/otf",
	".ttf": "font/ttf",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".mp3": "audio/mpeg",
	".mp4": "video/mp4",
	".ncx": "application/x-dtbncx+xml",
	".xml": "application/xml",
};

function inferMimeType(path: string, declaredMime?: string): string {
	if (declaredMime && declaredMime !== "application/octet-stream") {
		return declaredMime;
	}
	const lower = path.toLowerCase();
	const dotIdx = lower.lastIndexOf(".");
	if (dotIdx >= 0) {
		const ext = lower.slice(dotIdx);
		const mapped = MIME_BY_EXTENSION[ext];
		if (mapped) return mapped;
	}
	return "application/octet-stream";
}

function getElementText(parent: ParentNode, localName: string): string {
	const elements = parent.querySelectorAll("*");
	for (let i = 0; i < elements.length; i++) {
		const el = elements[i];
		if (el && el.localName.toLowerCase() === localName.toLowerCase()) {
			const text = el.textContent?.trim();
			if (text) return text;
		}
	}
	return "";
}

function getMetaPropertyValue(
	metadataEl: Element | null,
	propertyName: string,
): string {
	if (!metadataEl) return "";
	const metas = metadataEl.querySelectorAll("meta");
	for (let i = 0; i < metas.length; i++) {
		const meta = metas[i];
		if (!meta) continue;
		const prop = meta.getAttribute("property")?.trim().toLowerCase();
		if (prop === propertyName.toLowerCase()) {
			return meta.textContent?.trim() ?? "";
		}
	}
	return "";
}

function isFixedLayoutMeta(metadataEl: Element | null): boolean {
	if (!metadataEl) return false;
	const layoutProp = getMetaPropertyValue(
		metadataEl,
		"rendition:layout",
	).toLowerCase();
	if (layoutProp === "pre-paginated") return true;

	const metas = metadataEl.querySelectorAll("meta");
	for (let i = 0; i < metas.length; i++) {
		const meta = metas[i];
		if (!meta) continue;
		const name = meta.getAttribute("name")?.trim().toLowerCase();
		const content = (meta.getAttribute("content") ?? meta.textContent)
			?.trim()
			.toLowerCase();
		if (name === "fixed-layout" && (content === "true" || content === "yes")) {
			return true;
		}
	}
	return false;
}

function parseNavTocElement(
	olElement: Element,
	navDocPath: string,
): ReadonlyArray<TocItem> {
	const items: TocItem[] = [];
	const children = olElement.children;
	for (let i = 0; i < children.length; i++) {
		const li = children[i];
		if (li?.localName.toLowerCase() !== "li") continue;

		let anchor: Element | null = null;
		let subOl: Element | null = null;
		for (let j = 0; j < li.children.length; j++) {
			const child = li.children[j];
			if (!child) continue;
			const tag = child.localName.toLowerCase();
			if ((tag === "a" || tag === "span") && !anchor) {
				anchor = child;
			} else if (tag === "ol" && !subOl) {
				subOl = child;
			}
		}

		const label = anchor?.textContent?.replace(/\s+/g, " ").trim() ?? "";
		const rawHref = anchor?.getAttribute("href")?.trim() ?? "";
		const hashIdx = rawHref.indexOf("#");
		const fragment = hashIdx >= 0 ? rawHref.slice(hashIdx) : "";
		const resolvedBase = rawHref
			? resolveRelativeZipPath(navDocPath, rawHref)
			: "";
		const fullHref = resolvedBase ? `${resolvedBase}${fragment}` : "";

		const subitems = subOl ? parseNavTocElement(subOl, navDocPath) : [];
		if (label || subitems.length > 0) {
			items.push({
				id: `nav-toc-${navDocPath}-${String(i)}-${fullHref}`,
				label: label || "Untitled Section",
				href: fullHref,
				subitems,
			});
		}
	}
	return items;
}

function parseEpub3NavDocument(
	navXml: string,
	navDocPath: string,
): ReadonlyArray<TocItem> {
	const parser = new DOMParser();
	const doc = parser.parseFromString(navXml, "application/xhtml+xml");
	const navs = doc.querySelectorAll("nav");
	let tocNav: Element | null = null;

	for (let i = 0; i < navs.length; i++) {
		const nav = navs[i];
		if (!nav) continue;
		const epubType =
			nav.getAttribute("epub:type") ??
			nav.getAttributeNS("http://www.idpf.org/2007/ops", "type") ??
			nav.getAttribute("role") ??
			"";
		if (epubType.toLowerCase().includes("toc")) {
			tocNav = nav;
			break;
		}
	}

	if (!tocNav && navs[0]) {
		tocNav = navs[0];
	}
	if (!tocNav) return [];

	const ol = tocNav.querySelector("ol");
	if (!ol) return [];
	return parseNavTocElement(ol, navDocPath);
}

function parseNcxNavPoints(
	parent: Element,
	ncxDocPath: string,
): ReadonlyArray<TocItem> {
	const items: TocItem[] = [];
	const children = parent.children;
	for (let i = 0; i < children.length; i++) {
		const node = children[i];
		if (node?.localName.toLowerCase() !== "navpoint") continue;

		const id = node.getAttribute("id") ?? `ncx-${String(i)}`;
		let label = "";
		let rawSrc = "";

		for (let j = 0; j < node.children.length; j++) {
			const child = node.children[j];
			if (!child) continue;
			const local = child.localName.toLowerCase();
			if (local === "navlabel") {
				label = child.textContent?.replace(/\s+/g, " ").trim() ?? "";
			} else if (local === "content") {
				rawSrc = child.getAttribute("src")?.trim() ?? "";
			}
		}

		const hashIdx = rawSrc.indexOf("#");
		const fragment = hashIdx >= 0 ? rawSrc.slice(hashIdx) : "";
		const resolvedBase = rawSrc
			? resolveRelativeZipPath(ncxDocPath, rawSrc)
			: "";
		const fullHref = resolvedBase ? `${resolvedBase}${fragment}` : "";
		const subitems = parseNcxNavPoints(node, ncxDocPath);

		if (label) {
			items.push({
				id,
				label,
				href: fullHref,
				subitems,
			});
		}
	}
	return items;
}

function parseEpub2NcxDocument(
	ncxXml: string,
	ncxDocPath: string,
): ReadonlyArray<TocItem> {
	const parser = new DOMParser();
	const doc = parser.parseFromString(ncxXml, "application/xml");
	const elements = doc.querySelectorAll("*");
	for (let i = 0; i < elements.length; i++) {
		const el = elements[i];
		if (el && el.localName.toLowerCase() === "navmap") {
			return parseNcxNavPoints(el, ncxDocPath);
		}
	}
	return [];
}

async function rewriteCssUrls(
	cssText: string,
	cssFilePath: string,
	getAssetBlobUrl: (zipPath: string) => Promise<string | null>,
): Promise<string> {
	const urlRegex = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
	const matches = Array.from(cssText.matchAll(urlRegex));
	if (matches.length === 0) return cssText;

	const replacements = new Map<string, string>();
	for (const match of matches) {
		const fullMatch = match[0];
		const rawUrl = match[2]?.trim() ?? "";
		if (
			!rawUrl ||
			rawUrl.startsWith("data:") ||
			rawUrl.startsWith("blob:") ||
			rawUrl.startsWith("http://") ||
			rawUrl.startsWith("https://") ||
			rawUrl.startsWith("#")
		) {
			continue;
		}
		const hashIdx = rawUrl.indexOf("#");
		const fragment = hashIdx >= 0 ? rawUrl.slice(hashIdx) : "";
		const targetZipPath = resolveRelativeZipPath(cssFilePath, rawUrl);
		const blobUrl = await getAssetBlobUrl(targetZipPath);
		if (blobUrl) {
			replacements.set(fullMatch, `url("${blobUrl}${fragment}")`);
		}
	}

	let result = cssText;
	for (const [original, replacement] of replacements.entries()) {
		result = result.split(original).join(replacement);
	}
	return result;
}

function createSafeObjectUrl(blob: Blob): string {
	if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
		return URL.createObjectURL(blob);
	}
	return `blob:epub-viewer/${crypto.randomUUID()}`;
}

function revokeSafeObjectUrl(url: string): void {
	if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
		URL.revokeObjectURL(url);
	}
}

function classifyFontFormat(
	path: string,
	mediaType: string,
): EmbeddedFontFormat {
	const lowerPath = path.toLowerCase();
	const lowerMime = mediaType.toLowerCase();
	if (lowerPath.endsWith(".woff2") || lowerMime.includes("woff2"))
		return "WOFF2";
	if (lowerPath.endsWith(".woff") || lowerMime.includes("woff")) return "WOFF";
	if (
		lowerPath.endsWith(".otf") ||
		lowerMime.includes("opentype") ||
		lowerMime === "font/otf"
	) {
		return "OpenType";
	}
	if (
		lowerPath.endsWith(".ttf") ||
		lowerMime.includes("truetype") ||
		lowerMime === "font/ttf"
	) {
		return "TrueType";
	}
	return "Generic Font";
}

function isFontResource(path: string, mediaType: string): boolean {
	const lowerPath = path.toLowerCase();
	const lowerMime = mediaType.toLowerCase();
	if (
		lowerMime.startsWith("font/") ||
		lowerMime.includes("font-sfnt") ||
		lowerMime.includes("font-opentype") ||
		lowerMime.includes("font-truetype") ||
		lowerMime.includes("font-woff") ||
		lowerMime.includes("x-font")
	) {
		return true;
	}
	return (
		lowerPath.endsWith(".otf") ||
		lowerPath.endsWith(".ttf") ||
		lowerPath.endsWith(".woff") ||
		lowerPath.endsWith(".woff2") ||
		lowerPath.endsWith(".eot")
	);
}

function parseSfntNameTable(bytes: Uint8Array): ParsedFontNames | null {
	if (bytes.length < 12) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const tag = view.getUint32(0, false);
	// 'OTTO' (CFF OpenType), 0x00010000 (TrueType), 'true', 'typ1'
	if (
		tag !== 0x4f54544f &&
		tag !== 0x00010000 &&
		tag !== 0x74727565 &&
		tag !== 0x74797031
	) {
		return null;
	}
	const numTables = view.getUint16(4, false);
	let nameOffset = 0;
	for (let i = 0; i < numTables; i++) {
		const recordOffset = 12 + i * 16;
		if (recordOffset + 16 > bytes.length) break;
		const tableTag = view.getUint32(recordOffset, false);
		// 'name' = 0x6e616d65
		if (tableTag === 0x6e616d65) {
			nameOffset = view.getUint32(recordOffset + 8, false);
			break;
		}
	}
	if (!nameOffset || nameOffset + 6 > bytes.length) return null;
	const count = view.getUint16(nameOffset + 2, false);
	const stringOffset = view.getUint16(nameOffset + 4, false);
	const storageOffset = nameOffset + stringOffset;

	let typographicFamily = "";
	let typographicSubfamily = "";
	let familyName = "";
	let fullName = "";
	let subfamily = "";

	for (let i = 0; i < count; i++) {
		const recOffset = nameOffset + 6 + i * 12;
		if (recOffset + 12 > bytes.length) break;
		const platformID = view.getUint16(recOffset, false);
		const nameID = view.getUint16(recOffset + 6, false);
		const length = view.getUint16(recOffset + 8, false);
		const strOffset = view.getUint16(recOffset + 10, false);
		const dataStart = storageOffset + strOffset;
		if (dataStart + length > bytes.length) continue;

		let str = "";
		if (platformID === 0 || platformID === 3) {
			const chars: string[] = [];
			for (let j = 0; j < length - 1; j += 2) {
				const code = view.getUint16(dataStart + j, false);
				if (code > 0) chars.push(String.fromCharCode(code));
			}
			str = chars.join("").trim();
		} else {
			const chars: string[] = [];
			for (let j = 0; j < length; j++) {
				const code = bytes[dataStart + j];
				if (code && code >= 32 && code <= 126) {
					chars.push(String.fromCharCode(code));
				}
			}
			str = chars.join("").trim();
		}

		if (str) {
			if (nameID === 16 && (!typographicFamily || platformID === 3)) {
				typographicFamily = str;
			} else if (nameID === 17 && (!typographicSubfamily || platformID === 3)) {
				typographicSubfamily = str;
			} else if (nameID === 4 && (!fullName || platformID === 3)) {
				fullName = str;
			} else if (nameID === 1 && (!familyName || platformID === 3)) {
				familyName = str;
			} else if (nameID === 2 && (!subfamily || platformID === 3)) {
				subfamily = str;
			}
		}
	}

	const finalFamily = typographicFamily || familyName;
	const finalSubfamily = typographicSubfamily || subfamily;

	return {
		familyName: finalFamily || undefined,
		fullName: fullName || undefined,
		subfamily: finalSubfamily || undefined,
	};
}

function parseViewportDimensionsFromContent(
	content: string,
): { readonly width: number; readonly height: number } | null {
	const widthMatch = content.match(/width\s*=\s*([0-9.]+)/i);
	const heightMatch = content.match(/height\s*=\s*([0-9.]+)/i);
	if (widthMatch?.[1] && heightMatch?.[1]) {
		const w = Number.parseFloat(widthMatch[1]);
		const h = Number.parseFloat(heightMatch[1]);
		if (w > 0 && h > 0) {
			return { width: w, height: h };
		}
	}
	return null;
}

async function mapConcurrent<T, R>(
	items: readonly T[],
	concurrency: number,
	worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (items.length === 0) return [];
	const results: R[] = new Array(items.length);
	let nextIndex = 0;
	const workerCount = Math.min(concurrency, items.length);
	const runners = Array.from({ length: workerCount }, async () => {
		while (nextIndex < items.length) {
			const currentIndex = nextIndex++;
			const item = items[currentIndex];
			if (item !== undefined) {
				results[currentIndex] = await worker(item, currentIndex);
			}
		}
	});
	await Promise.all(runners);
	return results;
}

export async function loadEpubFromFile(
	file: Blob & { readonly name?: string },
): Promise<Result<BookManifest, string>> {
	const tStart = performance.now();
	console.log(
		`[PERF] 📦 Opening EPUB (${(file.size / (1024 * 1024)).toFixed(1)} MB)...`,
	);

	let archiveSource: Blob & { readonly name?: string } = file;
	const IN_MEMORY_THRESHOLD = 64 * 1024 * 1024; // 64 MB
	if (file.size <= IN_MEMORY_THRESHOLD) {
		try {
			const tBuf = performance.now();
			const buffer = await file.arrayBuffer();
			const inMemoryBlob = new Blob([buffer], { type: "application/epub+zip" });
			if (file.name !== undefined) {
				archiveSource = Object.assign(inMemoryBlob, { name: file.name });
			} else {
				archiveSource = inMemoryBlob;
			}
			console.log(
				`[PERF] ⚡ In-memory archive read: ${Math.round(performance.now() - tBuf)}ms (${(file.size / (1024 * 1024)).toFixed(1)} MB)`,
			);
		} catch (bufferErr) {
			console.warn(
				"[PERF] Failed to read archive into memory buffer, falling back to slice reader:",
				bufferErr,
			);
			archiveSource = file;
		}
	}

	const zipResult = await openLazyZipArchive(archiveSource);
	if (!zipResult.ok) {
		return zipResult;
	}
	console.log(
		`[PERF] 📦 ZIP Central Directory parsed in ${Math.round(performance.now() - tStart)}ms`,
	);

	const zip: LazyZipArchive = zipResult.value;
	const createdBlobUrls = new Set<string>();
	const rawAssetCache = new Map<string, Promise<string | null>>();
	const processedCssCache = new Map<string, Promise<string | null>>();

	try {
		const tFp = performance.now();
		const { hash: fileHash, headBuffer } = await computeFileFingerprint(
			archiveSource,
			zip.tailBuffer,
		);
		zip.setHeadBuffer?.(headBuffer);
		const fileName = file.name ?? "book.epub";
		console.log(
			`[PERF] 🔑 SHA-256 fingerprint in ${Math.round(performance.now() - tFp)}ms`,
		);

		if (!zip.hasEntry("META-INF/container.xml")) {
			return err("Missing META-INF/container.xml in EPUB archive.");
		}

		const containerXml = await zip.loadText("META-INF/container.xml");
		const parser = new DOMParser();
		const containerDoc = parser.parseFromString(
			containerXml,
			"application/xml",
		);
		const rootfileEl = containerDoc.querySelector("rootfile");
		const opfPathRaw = rootfileEl?.getAttribute("full-path")?.trim();

		if (!opfPathRaw) {
			return err("Invalid META-INF/container.xml: missing rootfile full-path.");
		}

		const opfPath = normalizeZipPath(opfPathRaw);
		if (!zip.hasEntry(opfPath)) {
			return err(`OPF package document not found at ${opfPath}.`);
		}

		const opfXml = await zip.loadText(opfPath);
		const opfDoc = parser.parseFromString(opfXml, "application/xml");

		const metadataEl = opfDoc.querySelector("metadata");
		const manifestEl = opfDoc.querySelector("manifest");
		const spineEl = opfDoc.querySelector("spine");

		if (!manifestEl || !spineEl) {
			return err("Invalid OPF package document: missing manifest or spine.");
		}

		const manifestById = new Map<string, ManifestItem>();
		const manifestByPath = new Map<string, ManifestItem>();

		const itemElements = manifestEl.querySelectorAll("item");
		for (let i = 0; i < itemElements.length; i++) {
			const itemEl = itemElements[i];
			if (!itemEl) continue;
			const id = itemEl.getAttribute("id")?.trim() ?? "";
			const href = itemEl.getAttribute("href")?.trim() ?? "";
			const mediaType = itemEl.getAttribute("media-type")?.trim() ?? "";
			const propsAttr = itemEl.getAttribute("properties")?.trim() ?? "";
			if (!id || !href) continue;

			const fullPath = resolveRelativeZipPath(opfPath, href);
			const properties = propsAttr ? propsAttr.split(/\s+/) : [];
			const manifestItem: ManifestItem = {
				id,
				href,
				fullPath,
				mediaType: inferMimeType(fullPath, mediaType),
				properties,
			};
			manifestById.set(id, manifestItem);
			manifestByPath.set(fullPath, manifestItem);
		}

		const getAssetBlobUrl = (zipPath: string): Promise<string | null> => {
			const normalized = normalizeZipPath(zipPath);
			const existing = rawAssetCache.get(normalized);
			if (existing) return existing;

			const promise = (async (): Promise<string | null> => {
				if (!zip.hasEntry(normalized)) return null;
				const manifestItem = manifestByPath.get(normalized);
				const mime = inferMimeType(normalized, manifestItem?.mediaType);
				const blob = await zip.loadBlob(normalized, mime);
				const url = createSafeObjectUrl(blob);
				createdBlobUrls.add(url);
				return url;
			})();

			rawAssetCache.set(normalized, promise);
			return promise;
		};

		const getStylesheetBlobUrl = (
			cssZipPath: string,
		): Promise<string | null> => {
			const normalized = normalizeZipPath(cssZipPath);
			const existing = processedCssCache.get(normalized);
			if (existing) return existing;

			const promise = (async (): Promise<string | null> => {
				if (!zip.hasEntry(normalized)) return null;
				const rawCss = await zip.loadText(normalized);
				const rewrittenCss = await rewriteCssUrls(
					rawCss,
					normalized,
					getAssetBlobUrl,
				);
				const blob = new Blob([rewrittenCss], { type: "text/css" });
				const url = createSafeObjectUrl(blob);
				createdBlobUrls.add(url);
				return url;
			})();

			processedCssCache.set(normalized, promise);
			return promise;
		};

		// Metadata extraction
		const title =
			(metadataEl ? getElementText(metadataEl, "title") : "") ||
			fileName.replace(/\.epub$/i, "");
		const author =
			(metadataEl ? getElementText(metadataEl, "creator") : "") ||
			"Unknown Author";
		const publisher = metadataEl ? getElementText(metadataEl, "publisher") : "";
		const language =
			(metadataEl ? getElementText(metadataEl, "language") : "") || "en";
		const identifier =
			(metadataEl ? getElementText(metadataEl, "identifier") : "") || fileHash;
		const description = metadataEl
			? getElementText(metadataEl, "description")
			: "";

		let layout: BookLayoutMode = isFixedLayoutMeta(metadataEl)
			? "pre-paginated"
			: "reflowable";

		const spreadProp = getMetaPropertyValue(
			metadataEl,
			"rendition:spread",
		).toLowerCase();
		const spread: BookMetadata["spread"] =
			spreadProp === "none"
				? "none"
				: spreadProp === "both"
					? "both"
					: spreadProp === "landscape"
						? "landscape"
						: "auto";

		const ppd = spineEl
			.getAttribute("page-progression-direction")
			?.toLowerCase();
		const direction: "ltr" | "rtl" = ppd === "rtl" ? "rtl" : "ltr";

		const packageEl = opfDoc.querySelector("package") ?? opfDoc.documentElement;
		const epubVersion = packageEl?.getAttribute("version")?.trim() || "3.0";

		const orientationProp = getMetaPropertyValue(
			metadataEl,
			"rendition:orientation",
		).toLowerCase();
		const orientation: BookMetadata["orientation"] =
			orientationProp === "portrait"
				? "portrait"
				: orientationProp === "landscape"
					? "landscape"
					: "auto";

		// Cover discovery
		let coverItem: ManifestItem | undefined;
		for (const item of manifestById.values()) {
			if (item.properties.includes("cover-image")) {
				coverItem = item;
				break;
			}
		}
		if (!coverItem && metadataEl) {
			const coverMeta = metadataEl.querySelector('meta[name="cover"]');
			const coverId = coverMeta?.getAttribute("content")?.trim();
			if (coverId) {
				coverItem = manifestById.get(coverId);
			}
		}
		const coverBlobUrl = coverItem
			? await getAssetBlobUrl(coverItem.fullPath)
			: null;

		// Build Spine
		const itemrefs = spineEl.querySelectorAll("itemref");
		const spine: SpineSection[] = [];
		const spineIndexByPath = new Map<string, number>();

		for (let i = 0; i < itemrefs.length; i++) {
			const itemref = itemrefs[i];
			if (!itemref) continue;
			const idref = itemref.getAttribute("idref")?.trim() ?? "";
			const manifestItem = manifestById.get(idref);
			if (!manifestItem || !zip.hasEntry(manifestItem.fullPath)) continue;

			const linearAttr = itemref.getAttribute("linear")?.trim().toLowerCase();
			const linear = linearAttr !== "no";

			const propsAttr = itemref.getAttribute("properties")?.trim() ?? "";
			const itemProps = propsAttr ? propsAttr.split(/\s+/) : [];
			if (
				itemProps.includes("rendition:layout-pre-paginated") ||
				itemProps.includes("layout-pre-paginated")
			) {
				layout = "pre-paginated";
			}
			let pageSpread: PageSpreadPosition = "none";
			if (
				itemProps.includes("page-spread-left") ||
				itemProps.includes("rendition:page-spread-left")
			) {
				pageSpread = "left";
			} else if (
				itemProps.includes("page-spread-right") ||
				itemProps.includes("rendition:page-spread-right")
			) {
				pageSpread = "right";
			} else if (
				itemProps.includes("page-spread-center") ||
				itemProps.includes("rendition:page-spread-center")
			) {
				pageSpread = "center";
			}

			const sectionIndex = spine.length;
			const sectionPath = manifestItem.fullPath;
			spineIndexByPath.set(sectionPath, sectionIndex);

			const loadDocument = async (): Promise<Document> => {
				const tDoc = performance.now();
				const rawXhtml = await zip.loadText(sectionPath);
				const docParser = new DOMParser();
				let doc = docParser.parseFromString(rawXhtml, "application/xhtml+xml");
				const parseError = doc.querySelector("parsererror");
				if (parseError) {
					doc = docParser.parseFromString(rawXhtml, "text/html");
				}
				const tXml = performance.now();
				console.log(
					`[PERF] 📄 Chapter XML parsed (${sectionPath}): ${Math.round(tXml - tDoc)}ms`,
				);

				// Rewrite stylesheet links
				const links = Array.from(
					doc.querySelectorAll('link[rel="stylesheet"][href]'),
				);
				for (const link of links) {
					const href = link.getAttribute("href")?.trim();
					if (!href || href.startsWith("blob:") || href.startsWith("data:"))
						continue;
					const resolvedCssPath = resolveRelativeZipPath(sectionPath, href);
					const cssBlobUrl = await getStylesheetBlobUrl(resolvedCssPath);
					if (cssBlobUrl) {
						link.setAttribute("href", cssBlobUrl);
					}
				}

				// Rewrite inline <style> blocks containing url(...)
				const styleEls = Array.from(doc.querySelectorAll("style"));
				for (const styleEl of styleEls) {
					const cssContent = styleEl.textContent ?? "";
					if (cssContent.includes("url(")) {
						styleEl.textContent = await rewriteCssUrls(
							cssContent,
							sectionPath,
							getAssetBlobUrl,
						);
					}
				}

				// Rewrite media elements (<img>, <image>, <audio>, <video>, <source>) in parallel
				const tImg = performance.now();
				const srcElements = Array.from(
					doc.querySelectorAll("img[src], audio[src], video[src], source[src]"),
				);
				const mediaTasks = srcElements.map(async (el) => {
					const src = el.getAttribute("src")?.trim();
					if (
						!src ||
						src.startsWith("data:") ||
						src.startsWith("blob:") ||
						src.startsWith("http://") ||
						src.startsWith("https://")
					) {
						return;
					}
					const targetPath = resolveRelativeZipPath(sectionPath, src);
					const blobUrl = await getAssetBlobUrl(targetPath);
					if (blobUrl) {
						el.setAttribute("src", blobUrl);
					}
				});

				// Rewrite SVG <image href="..."> and <image xlink:href="...">
				const svgImages = Array.from(doc.querySelectorAll("image"));
				const svgTasks = svgImages.map(async (img) => {
					const href =
						img.getAttribute("href")?.trim() ??
						img.getAttribute("xlink:href")?.trim() ??
						img.getAttributeNS("http://www.w3.org/1999/xlink", "href")?.trim();
					if (
						!href ||
						href.startsWith("data:") ||
						href.startsWith("blob:") ||
						href.startsWith("http://") ||
						href.startsWith("https://")
					) {
						return;
					}
					const targetPath = resolveRelativeZipPath(sectionPath, href);
					const blobUrl = await getAssetBlobUrl(targetPath);
					if (blobUrl) {
						if (img.hasAttribute("href")) {
							img.setAttribute("href", blobUrl);
						}
						if (img.hasAttribute("xlink:href")) {
							img.setAttribute("xlink:href", blobUrl);
						}
					}
				});

				await Promise.all([...mediaTasks, ...svgTasks]);

				const totalImgs = srcElements.length + svgImages.length;
				if (totalImgs > 0) {
					console.log(
						`[PERF] 🖼️ Decompress ${totalImgs} images (parallel): ${Math.round(performance.now() - tImg)}ms`,
					);
				}
				console.log(
					`[PERF] 📄 Total loadDocument (${sectionPath}): ${Math.round(performance.now() - tDoc)}ms`,
				);

				return doc;
			};

			let sectionBlobUrl: string | null = null;
			const createUrl = async (): Promise<string> => {
				if (sectionBlobUrl) return sectionBlobUrl;
				const doc = await loadDocument();
				const serializer = new XMLSerializer();
				const serialized = serializer.serializeToString(doc);
				const blob = new Blob([serialized], { type: "application/xhtml+xml" });
				sectionBlobUrl = createSafeObjectUrl(blob);
				createdBlobUrls.add(sectionBlobUrl);
				return sectionBlobUrl;
			};

			const unload = (): void => {
				if (sectionBlobUrl) {
					revokeSafeObjectUrl(sectionBlobUrl);
					createdBlobUrls.delete(sectionBlobUrl);
					sectionBlobUrl = null;
				}
			};

			spine.push({
				index: sectionIndex,
				id: manifestItem.id,
				href: sectionPath,
				linear,
				pageSpread,
				sizeBytes: Math.max(1, zip.getSize(sectionPath)),
				loadDocument,
				createUrl,
				resolveHref: (relativeHref: string) => {
					const hashIdx = relativeHref.indexOf("#");
					const fragment = hashIdx >= 0 ? relativeHref.slice(hashIdx) : "";
					const resolved = resolveRelativeZipPath(sectionPath, relativeHref);
					return `${resolved}${fragment}`;
				},
				unload,
			});
		}

		if (spine.length === 0) {
			return err("EPUB spine contains no readable chapter sections.");
		}

		let viewportDimensions: {
			readonly width: number;
			readonly height: number;
		} | null = null;
		const opfViewport = getMetaPropertyValue(metadataEl, "rendition:viewport");
		if (opfViewport) {
			viewportDimensions = parseViewportDimensionsFromContent(opfViewport);
		}
		if (!viewportDimensions && layout === "pre-paginated" && spine[0]) {
			try {
				const firstSectionText = await zip.loadText(spine[0].href);
				viewportDimensions =
					parseViewportDimensionsFromContent(firstSectionText);
			} catch {
				// Ignore fallback error
			}
		}

		const rawFontEntries: {
			readonly path: string;
			readonly mediaType: string;
		}[] = [];
		const seenFontPaths = new Set<string>();

		for (const item of manifestById.values()) {
			if (isFontResource(item.fullPath, item.mediaType)) {
				const norm = normalizeZipPath(item.fullPath);
				if (!seenFontPaths.has(norm)) {
					seenFontPaths.add(norm);
					rawFontEntries.push({
						path: item.fullPath,
						mediaType: item.mediaType,
					});
				}
			}
		}

		for (const [entryPath] of zip.entries.entries()) {
			const norm = normalizeZipPath(entryPath);
			if (!seenFontPaths.has(norm) && isFontResource(entryPath, "")) {
				seenFontPaths.add(norm);
				rawFontEntries.push({
					path: entryPath,
					mediaType: inferMimeType(entryPath),
				});
			}
		}

		rawFontEntries.sort((a, b) =>
			a.path.localeCompare(b.path, undefined, {
				numeric: true,
				sensitivity: "base",
			}),
		);

		const processFont = async (
			item: {
				readonly path: string;
				readonly mediaType: string;
			},
			index: number,
		): Promise<EmbeddedFontInfo> => {
			const name = item.path.split("/").pop() ?? item.path;
			const zipEntry = zip.entries.get(normalizeZipPath(item.path));
			const sizeBytes = zipEntry?.uncompressedSize ?? 0;
			let fontMeta: ParsedFontNames | null = null;
			// Upfront SFNT name table parsing for the first 32 fonts (avoids flooding mobile IPC on books with hundreds of subset fonts)
			if (index < 32) {
				try {
					const fontBytes = await zip.loadBytes(item.path);
					fontMeta = parseSfntNameTable(fontBytes);
				} catch {
					// Fallback
				}
			}
			return {
				name,
				path: item.path,
				mediaType: item.mediaType,
				format: classifyFontFormat(item.path, item.mediaType),
				sizeBytes,
				...(fontMeta?.familyName ? { fontFamily: fontMeta.familyName } : {}),
				...(fontMeta?.fullName ? { fullName: fontMeta.fullName } : {}),
				...(fontMeta?.subfamily ? { subfamily: fontMeta.subfamily } : {}),
			};
		};

		const embeddedFontsList = await mapConcurrent(
			rawFontEntries,
			16,
			processFont,
		);

		const embeddedFonts: ReadonlyArray<EmbeddedFontInfo> =
			embeddedFontsList.sort((a, b) =>
				a.name.localeCompare(b.name, undefined, {
					numeric: true,
					sensitivity: "base",
				}),
			);

		let imageCount = 0;
		let cssCount = 0;
		for (const item of manifestById.values()) {
			const mime = item.mediaType.toLowerCase();
			const path = item.fullPath.toLowerCase();
			if (
				mime.startsWith("image/") ||
				/\.(jpe?g|png|gif|webp|svg)$/.test(path)
			) {
				imageCount++;
			} else if (mime === "text/css" || path.endsWith(".css")) {
				cssCount++;
			}
		}

		const stats: BookPackageStats = {
			spineCount: spine.length,
			imageCount,
			fontCount: embeddedFonts.length,
			cssCount,
			totalEntriesCount: zip.entries.size,
		};

		const metadata: BookMetadata = {
			identifier,
			title,
			author,
			publisher,
			language,
			description,
			layout,
			spread,
			orientation,
			direction,
			coverBlobUrl,
			epubVersion,
			viewportDimensions,
			embeddedFonts,
			stats,
		};

		// Parse Table of Contents (EPUB 3 nav first, fallback to EPUB 2 NCX, fallback to spine)
		let toc: ReadonlyArray<TocItem> = [];
		let navItem: ManifestItem | undefined;
		for (const item of manifestById.values()) {
			if (item.properties.includes("nav")) {
				navItem = item;
				break;
			}
		}
		if (navItem && zip.hasEntry(navItem.fullPath)) {
			const navXml = await zip.loadText(navItem.fullPath);
			toc = parseEpub3NavDocument(navXml, navItem.fullPath);
		}

		if (toc.length === 0) {
			const tocNcxId = spineEl.getAttribute("toc")?.trim();
			let ncxItem = tocNcxId ? manifestById.get(tocNcxId) : undefined;
			if (!ncxItem) {
				for (const item of manifestById.values()) {
					if (item.mediaType === "application/x-dtbncx+xml") {
						ncxItem = item;
						break;
					}
				}
			}
			if (ncxItem && zip.hasEntry(ncxItem.fullPath)) {
				const ncxXml = await zip.loadText(ncxItem.fullPath);
				toc = parseEpub2NcxDocument(ncxXml, ncxItem.fullPath);
			}
		}

		if (toc.length === 0) {
			toc = spine.map((sec, idx) => ({
				id: `spine-toc-${String(idx)}`,
				label: `Section ${String(idx + 1)}`,
				href: sec.href,
				subitems: [],
			}));
		}

		const resolveHrefToSpine = (
			rawHref: string,
		): { readonly index: number; readonly anchor: string | null } | null => {
			const trimmed = rawHref.trim();
			if (!trimmed) return null;
			const hashIdx = trimmed.indexOf("#");
			const pathPart = hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed;
			const anchor = hashIdx >= 0 ? trimmed.slice(hashIdx + 1) : null;
			const normalized = normalizeZipPath(pathPart);

			const directIdx = spineIndexByPath.get(normalized);
			if (directIdx !== undefined) {
				return { index: directIdx, anchor };
			}

			const resolvedFromOpf = resolveRelativeZipPath(opfPath, pathPart);
			const opfIdx = spineIndexByPath.get(resolvedFromOpf);
			if (opfIdx !== undefined) {
				return { index: opfIdx, anchor };
			}

			const lower = normalized.toLowerCase();
			for (const [spinePath, idx] of spineIndexByPath.entries()) {
				if (
					spinePath.toLowerCase() === lower ||
					spinePath.toLowerCase().endsWith(`/${lower}`)
				) {
					return { index: idx, anchor };
				}
			}
			return null;
		};

		const destroy = (): void => {
			for (const sec of spine) {
				sec.unload();
			}
			for (const url of createdBlobUrls) {
				revokeSafeObjectUrl(url);
			}
			createdBlobUrls.clear();
			rawAssetCache.clear();
			processedCssCache.clear();
		};

		console.log(
			`[PERF] 📖 Manifest ready (${spine.length} spine chapters, ${toc.length} TOC entries) in ${Math.round(performance.now() - tStart)}ms total`,
		);

		const loadFontDetails = async (
			path: string,
		): Promise<ParsedFontNames | null> => {
			try {
				const fontBytes = await zip.loadBytes(path);
				return parseSfntNameTable(fontBytes);
			} catch {
				return null;
			}
		};

		return ok({
			fileHash,
			fileName,
			fileSize: file.size,
			metadata,
			toc,
			spine,
			loadFontDetails,
			resolveHrefToSpine,
			destroy,
		});
	} catch (error) {
		for (const url of createdBlobUrls) {
			revokeSafeObjectUrl(url);
		}
		const message = error instanceof Error ? error.message : String(error);
		return err(`Failed to parse EPUB manifest: ${message}`);
	}
}
