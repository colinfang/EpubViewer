/**
 * EPUB Canonical Fragment Identifier (CFI) Generator and Resolver.
 *
 * Adapted and ported to TypeScript for EpubViewer from upstream foliate-js:
 *   Repository: https://github.com/johnfactotum/foliate-js
 *   Reference: epubcfi.js
 *   License: MIT © John Factotum
 */

export interface ParsedCfi {
	readonly spineIndex: number;
	readonly elementSteps: ReadonlyArray<number>;
	readonly textOffset: number | null;
	readonly elementId: string | null;
}

export function buildCfiFromElement(
	spineIndex: number,
	doc: Document,
	targetNode: Node | null,
	textOffset = 0,
): string {
	const spineStep = (spineIndex + 1) * 2;
	if (!targetNode || !doc.body) {
		return `epubcfi(/6/${String(spineStep)}!/4/2)`;
	}

	const steps: number[] = [];
	let current: Node | null =
		targetNode.nodeType === Node.TEXT_NODE
			? targetNode.parentElement
			: targetNode;

	let idSuffix = "";
	if (current instanceof Element && current.id) {
		idSuffix = `[${current.id}]`;
	}

	while (current && current !== doc.documentElement && current !== doc) {
		const parentEl: Element | null = current.parentElement;
		if (!parentEl) break;

		let elementPosition = 0;
		const children = parentEl.children;
		for (let i = 0; i < children.length; i++) {
			if (children[i] === current) {
				elementPosition = (i + 1) * 2;
				break;
			}
		}
		if (elementPosition === 0) {
			elementPosition = 2;
		}
		steps.unshift(elementPosition);
		current = parentEl;
	}

	if (steps.length === 0) {
		steps.push(4, 2);
	}

	const pathStr = steps.map((s) => `/${String(s)}`).join("");
	const offsetStr = textOffset > 0 ? `:${String(textOffset)}` : "";
	return `epubcfi(/6/${String(spineStep)}!${pathStr}${idSuffix}${offsetStr})`;
}

export function parseCfi(cfi: string): ParsedCfi | null {
	const trimmed = cfi.trim();
	if (!trimmed.startsWith("epubcfi(") || !trimmed.endsWith(")")) {
		return null;
	}
	const inner = trimmed.slice(8, -1);
	const bangIndex = inner.indexOf("!");
	if (bangIndex === -1) {
		const match = inner.match(/^\/6\/(\d+)/);
		if (!match?.[1]) return null;
		const spineStep = Number.parseInt(match[1], 10);
		return {
			spineIndex: Math.max(0, Math.floor(spineStep / 2) - 1),
			elementSteps: [],
			textOffset: null,
			elementId: null,
		};
	}

	const prefix = inner.slice(0, bangIndex);
	const rest = inner.slice(bangIndex + 1);
	const spineMatch = prefix.match(/\/6\/(\d+)/);
	if (!spineMatch?.[1]) return null;
	const spineStep = Number.parseInt(spineMatch[1], 10);
	const spineIndex = Math.max(0, Math.floor(spineStep / 2) - 1);

	let elementId: string | null = null;
	const idMatch = rest.match(/\[([^\]]+)\]/);
	if (idMatch?.[1]) {
		elementId = idMatch[1];
	}

	let textOffset: number | null = null;
	const offsetMatch = rest.match(/:(\d+)$/);
	if (offsetMatch?.[1]) {
		textOffset = Number.parseInt(offsetMatch[1], 10);
	}

	const cleanedPath = rest.replace(/\[[^\]]*\]/g, "").replace(/:\d+$/, "");
	const rawParts = cleanedPath.split("/").filter(Boolean);
	const elementSteps: number[] = [];
	for (const part of rawParts) {
		const num = Number.parseInt(part, 10);
		if (!Number.isNaN(num) && num >= 2) {
			elementSteps.push(num);
		}
	}

	return {
		spineIndex,
		elementSteps,
		textOffset,
		elementId,
	};
}

export function resolveCfiInDocument(
	doc: Document,
	parsed: ParsedCfi,
): Element | null {
	if (parsed.elementId) {
		const byId = doc.getElementById(parsed.elementId);
		if (byId) return byId;
	}

	let current: Element | null = doc.documentElement;
	for (const step of parsed.elementSteps) {
		if (!current) break;
		const childIndex = Math.floor(step / 2) - 1;
		const nextChild: Element | undefined = current.children[childIndex];
		if (nextChild) {
			current = nextChild;
		} else {
			break;
		}
	}

	return current ?? doc.body;
}
