import type { BookMetadata, ReaderSettings } from "../types";
import { themeTypographyTransformer } from "./transformers/themeTypography";

export interface DocumentTransformContext {
	readonly bookMeta: BookMetadata;
	readonly sectionHref: string;
	readonly settings: ReaderSettings;
}

export type DocumentTransformer = (
	doc: Document,
	ctx: DocumentTransformContext,
) => void;

export const DEFAULT_TRANSFORMERS: ReadonlyArray<DocumentTransformer> = [
	themeTypographyTransformer,
];

export function runDocumentPipeline(
	doc: Document,
	ctx: DocumentTransformContext,
	transformers: ReadonlyArray<DocumentTransformer> = DEFAULT_TRANSFORMERS,
): Document {
	for (const transformer of transformers) {
		transformer(doc, ctx);
	}
	return doc;
}
