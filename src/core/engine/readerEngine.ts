import type { DocumentTransformer } from "../pipeline";
import {
	assertNever,
	type BookManifest,
	type ReaderEngine,
	type ReaderInputEvent,
	type ReaderSettings,
	type RelocationEvent,
} from "../types";
import { FixedLayoutRenderer } from "./fixedLayout";
import { ReflowablePaginator } from "./paginator";

export interface CreateReaderEngineOptions {
	readonly manifest: BookManifest;
	readonly initialSettings: ReaderSettings;
	readonly transformers?: ReadonlyArray<DocumentTransformer>;
}

export function createReaderEngine(
	options: CreateReaderEngineOptions,
): ReaderEngine {
	const relocateListeners = new Set<(event: RelocationEvent) => void>();
	const inputListeners = new Set<(event: ReaderInputEvent) => void>();

	const handleRelocate = (event: RelocationEvent): void => {
		for (const listener of relocateListeners) {
			listener(event);
		}
	};

	const handleInput = (event: ReaderInputEvent): void => {
		for (const listener of inputListeners) {
			listener(event);
		}
	};

	const layoutMode = options.manifest.metadata.layout;

	const delegate = (() => {
		switch (layoutMode) {
			case "reflowable":
				return new ReflowablePaginator({
					manifest: options.manifest,
					initialSettings: options.initialSettings,
					...(options.transformers
						? { transformers: options.transformers }
						: {}),
					onRelocate: handleRelocate,
					onInput: handleInput,
				});
			case "pre-paginated":
				return new FixedLayoutRenderer({
					manifest: options.manifest,
					initialSettings: options.initialSettings,
					...(options.transformers
						? { transformers: options.transformers }
						: {}),
					onRelocate: handleRelocate,
					onInput: handleInput,
				});
			default:
				return assertNever(layoutMode);
		}
	})();

	return {
		mount: (container: HTMLElement, initialCfi?: string) =>
			delegate.mount(container, initialCfi),
		next: () => delegate.next(),
		prev: () => delegate.prev(),
		goToHref: (href: string) => delegate.goToHref(href),
		goToFraction: (fraction: number) => delegate.goToFraction(fraction),
		goToCfi: (cfi: string) => delegate.goToCfi(cfi),
		applySettings: (settings: ReaderSettings) =>
			delegate.applySettings(settings),
		onRelocate(listener: (event: RelocationEvent) => void): () => void {
			relocateListeners.add(listener);
			return () => {
				relocateListeners.delete(listener);
			};
		},
		onInput(listener: (event: ReaderInputEvent) => void): () => void {
			inputListeners.add(listener);
			return () => {
				inputListeners.delete(listener);
			};
		},
		destroy(): void {
			relocateListeners.clear();
			inputListeners.clear();
			delegate.destroy();
		},
	};
}
