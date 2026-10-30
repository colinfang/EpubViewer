import { err, ok, type Result } from "../types";

export interface ZipEntryInfo {
	readonly filename: string;
	readonly compressionMethod: number;
	readonly compressedSize: number;
	readonly uncompressedSize: number;
	readonly localHeaderOffset: number;
}

export interface LazyZipArchive {
	readonly entries: ReadonlyMap<string, ZipEntryInfo>;
	readonly tailBuffer?: ArrayBuffer;
	setHeadBuffer?(buf: ArrayBuffer): void;
	hasEntry(path: string): boolean;
	getSize(path: string): number;
	loadBytes(path: string): Promise<Uint8Array>;
	loadText(path: string): Promise<string>;
	loadBlob(path: string, mimeType?: string): Promise<Blob>;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;

export function normalizeZipPath(rawPath: string): string {
	const cleaned = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
	const parts = cleaned.split("/");
	const resolved: string[] = [];
	for (const part of parts) {
		if (!part || part === ".") continue;
		if (part === "..") {
			resolved.pop();
		} else {
			resolved.push(part);
		}
	}
	return resolved.join("/");
}

export function resolveRelativeZipPath(
	baseFilePath: string,
	relativeHref: string,
): string {
	const hashIndex = relativeHref.indexOf("#");
	const pathPart =
		hashIndex >= 0 ? relativeHref.slice(0, hashIndex) : relativeHref;
	const decodedPath = decodeURIComponent(pathPart.trim());
	if (!decodedPath) {
		return normalizeZipPath(baseFilePath);
	}
	if (decodedPath.startsWith("/")) {
		return normalizeZipPath(decodedPath);
	}
	const lastSlash = baseFilePath.lastIndexOf("/");
	const baseDir = lastSlash >= 0 ? baseFilePath.slice(0, lastSlash + 1) : "";
	return normalizeZipPath(baseDir + decodedPath);
}

async function readBlobSliceBuffer(
	blob: Blob,
	start: number,
	end: number,
): Promise<ArrayBuffer> {
	const sliced = blob.slice(start, end);
	if (typeof sliced.arrayBuffer === "function") {
		return sliced.arrayBuffer();
	}
	if (typeof FileReader !== "undefined") {
		return new Promise<ArrayBuffer>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				if (reader.result instanceof ArrayBuffer) {
					resolve(reader.result);
				} else {
					reject(new Error("FileReader did not return an ArrayBuffer"));
				}
			};
			reader.onerror = () =>
				reject(reader.error ?? new Error("FileReader error"));
			reader.readAsArrayBuffer(sliced);
		});
	}
	return new Response(sliced).arrayBuffer();
}

async function getCompressedStream(
	blob: Blob,
	start: number,
	end: number,
): Promise<ReadableStream<BufferSource>> {
	const sliced = blob.slice(start, end);
	if (typeof sliced.stream === "function") {
		return sliced.stream() as unknown as ReadableStream<BufferSource>;
	}
	const buf = await readBlobSliceBuffer(blob, start, end);
	const resp = new Response(buf);
	return resp.body as unknown as ReadableStream<BufferSource>;
}

export async function openLazyZipArchive(
	blob: Blob,
): Promise<Result<LazyZipArchive, string>> {
	try {
		const fileSize = blob.size;
		if (fileSize < 22) {
			return err("File is too small to be a valid EPUB/ZIP archive.");
		}

		const t0 = performance.now();
		// Read up to 256KB from tail. Central Directory is usually < 64KB and located right before EOCD.
		const maxTailLength = Math.min(fileSize, 256 * 1024);
		const tailOffset = fileSize - maxTailLength;
		const tailBuffer = await readBlobSliceBuffer(blob, tailOffset, fileSize);
		const tTail = performance.now();
		const tailView = new DataView(tailBuffer);

		let eocdPos = -1;
		for (let i = tailBuffer.byteLength - 22; i >= 0; i--) {
			if (tailView.getUint32(i, true) === EOCD_SIGNATURE) {
				eocdPos = i;
				break;
			}
		}

		if (eocdPos === -1) {
			return err(
				"Invalid EPUB archive: ZIP End of Central Directory not found.",
			);
		}

		const totalEntries = tailView.getUint16(eocdPos + 10, true);
		const cdSize = tailView.getUint32(eocdPos + 12, true);
		const cdOffset = tailView.getUint32(eocdPos + 16, true);

		if (cdOffset + cdSize > fileSize) {
			return err(
				"Invalid EPUB archive: Central Directory exceeds file bounds.",
			);
		}

		let cdBuffer: ArrayBuffer;
		let cdReused = false;
		if (cdOffset >= tailOffset && cdOffset + cdSize <= fileSize) {
			const relStart = cdOffset - tailOffset;
			cdBuffer = tailBuffer.slice(relStart, relStart + cdSize);
			cdReused = true;
		} else {
			cdBuffer = await readBlobSliceBuffer(
				blob,
				cdOffset,
				cdOffset + cdSize,
			);
		}
		const tCd = performance.now();
		console.log(
			`[PERF] 📦 Central Directory read: tail=${Math.round(tTail - t0)}ms, cd=${Math.round(tCd - tTail)}ms (entries=${totalEntries}, reused=${String(cdReused)})`,
		);
		const cdView = new DataView(cdBuffer);
		const cdBytes = new Uint8Array(cdBuffer);
		const textDecoder = new TextDecoder("utf-8");

		const entries = new Map<string, ZipEntryInfo>();
		let ptr = 0;

		for (let i = 0; i < totalEntries && ptr + 46 <= cdBuffer.byteLength; i++) {
			const sig = cdView.getUint32(ptr, true);
			if (sig !== CENTRAL_DIR_SIGNATURE) {
				break;
			}

			const compressionMethod = cdView.getUint16(ptr + 10, true);
			const compressedSize = cdView.getUint32(ptr + 20, true);
			const uncompressedSize = cdView.getUint32(ptr + 24, true);
			const fileNameLength = cdView.getUint16(ptr + 28, true);
			const extraFieldLength = cdView.getUint16(ptr + 30, true);
			const fileCommentLength = cdView.getUint16(ptr + 32, true);
			const localHeaderOffset = cdView.getUint32(ptr + 42, true);

			const nameBytes = cdBytes.subarray(ptr + 46, ptr + 46 + fileNameLength);
			const rawFilename = textDecoder.decode(nameBytes);
			const filename = normalizeZipPath(rawFilename);

			if (filename && !rawFilename.endsWith("/")) {
				entries.set(filename, {
					filename,
					compressionMethod,
					compressedSize,
					uncompressedSize,
					localHeaderOffset,
				});
			}

			ptr += 46 + fileNameLength + extraFieldLength + fileCommentLength;
		}

		const findEntry = (path: string): ZipEntryInfo | undefined => {
			const normalized = normalizeZipPath(path);
			const exact = entries.get(normalized);
			if (exact) return exact;
			const decoded = normalizeZipPath(decodeURIComponent(normalized));
			const byDecoded = entries.get(decoded);
			if (byDecoded) return byDecoded;
			const lower = decoded.toLowerCase();
			for (const [key, val] of entries.entries()) {
				if (key.toLowerCase() === lower) {
					return val;
				}
			}
			return undefined;
		};

		let headBuffer: ArrayBuffer | null = null;
		const setHeadBuffer = (buf: ArrayBuffer) => {
			headBuffer = buf;
		};

		const readSlice = async (
			start: number,
			end: number,
		): Promise<ArrayBuffer> => {
			if (headBuffer && start >= 0 && end <= headBuffer.byteLength) {
				return headBuffer.slice(start, end);
			}
			if (start >= tailOffset && end <= fileSize) {
				return tailBuffer.slice(start - tailOffset, end - tailOffset);
			}
			return readBlobSliceBuffer(blob, start, end);
		};

		const getCompressedStreamInternal = async (
			dataStart: number,
			dataEnd: number,
		): Promise<ReadableStream<BufferSource>> => {
			if (headBuffer && dataStart >= 0 && dataEnd <= headBuffer.byteLength) {
				const buf = headBuffer.slice(dataStart, dataEnd);
				const resp = new Response(buf);
				return resp.body as unknown as ReadableStream<BufferSource>;
			}
			if (dataStart >= tailOffset && dataEnd <= fileSize) {
				const buf = tailBuffer.slice(dataStart - tailOffset, dataEnd - tailOffset);
				const resp = new Response(buf);
				return resp.body as unknown as ReadableStream<BufferSource>;
			}
			return getCompressedStream(blob, dataStart, dataEnd);
		};

		const getEntryDataBounds = async (
			entry: ZipEntryInfo,
		): Promise<{ readonly dataStart: number; readonly dataEnd: number }> => {
			const localHeaderBuf = await readSlice(
				entry.localHeaderOffset,
				entry.localHeaderOffset + 30,
			);
			const lhView = new DataView(localHeaderBuf);
			if (lhView.getUint32(0, true) !== LOCAL_FILE_HEADER_SIGNATURE) {
				throw new Error(
					`Invalid local file header for entry: ${entry.filename}`,
				);
			}

			const nameLen = lhView.getUint16(26, true);
			const extraLen = lhView.getUint16(28, true);
			const dataStart = entry.localHeaderOffset + 30 + nameLen + extraLen;
			const dataEnd = dataStart + entry.compressedSize;
			return { dataStart, dataEnd };
		};

		const getDecompressedStream = async (
			dataStart: number,
			dataEnd: number,
		): Promise<ReadableStream<Uint8Array>> => {
			const raw = await getCompressedStreamInternal(dataStart, dataEnd);
			return raw.pipeThrough(
				new DecompressionStream("deflate-raw"),
			) as unknown as ReadableStream<Uint8Array>;
		};

		const loadBytes = async (path: string): Promise<Uint8Array> => {
			const entry = findEntry(path);
			if (!entry) {
				throw new Error(`Archive entry not found: ${path}`);
			}
			// Single-slice fast path for entries <= 512KB (merges local header read and data read into 1 slice)
			if (entry.compressedSize <= 512 * 1024) {
				const fetchLen = Math.min(
					fileSize - entry.localHeaderOffset,
					30 + 512 + entry.compressedSize,
				);
				const buf = await readSlice(
					entry.localHeaderOffset,
					entry.localHeaderOffset + fetchLen,
				);
				const view = new DataView(buf);
				if (view.getUint32(0, true) === LOCAL_FILE_HEADER_SIGNATURE) {
					const nameLen = view.getUint16(26, true);
					const extraLen = view.getUint16(28, true);
					const dataStart = 30 + nameLen + extraLen;
					const dataEnd = dataStart + entry.compressedSize;
					if (dataEnd <= buf.byteLength) {
						const payload = new Uint8Array(buf.slice(dataStart, dataEnd));
						if (entry.compressionMethod === 0) {
							return payload;
						}
						if (entry.compressionMethod === 8) {
							const stream = new Response(payload).body!.pipeThrough(
								new DecompressionStream("deflate-raw"),
							);
							return new Uint8Array(await new Response(stream).arrayBuffer());
						}
					}
				}
			}

			const { dataStart, dataEnd } = await getEntryDataBounds(entry);
			if (entry.compressionMethod === 0) {
				return new Uint8Array(await readSlice(dataStart, dataEnd));
			}
			if (entry.compressionMethod === 8) {
				const stream = await getDecompressedStream(dataStart, dataEnd);
				return new Uint8Array(await new Response(stream).arrayBuffer());
			}
			throw new Error(
				`Unsupported ZIP compression method ${String(entry.compressionMethod)} in ${entry.filename}`,
			);
		};

		const loadText = async (path: string): Promise<string> => {
			const bytes = await loadBytes(path);
			return textDecoder.decode(bytes);
		};

		const loadBlob = async (
			path: string,
			mimeType = "application/octet-stream",
		): Promise<Blob> => {
			const entry = findEntry(path);
			if (!entry) {
				throw new Error(`Archive entry not found: ${path}`);
			}
			const { dataStart, dataEnd } = await getEntryDataBounds(entry);
			if (entry.compressionMethod === 0) {
				return blob.slice(dataStart, dataEnd, mimeType);
			}
			if (entry.compressionMethod === 8) {
				const stream = await getDecompressedStream(dataStart, dataEnd);
				return new Response(stream, {
					headers: { "Content-Type": mimeType },
				}).blob();
			}
			throw new Error(
				`Unsupported ZIP compression method ${String(entry.compressionMethod)} in ${entry.filename}`,
			);
		};

		return ok({
			entries,
			tailBuffer,
			setHeadBuffer,
			hasEntry: (path: string) => findEntry(path) !== undefined,
			getSize: (path: string) => findEntry(path)?.uncompressedSize ?? 0,
			loadBytes,
			loadText,
			loadBlob,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return err(`Failed to open EPUB archive: ${message}`);
	}
}

export interface FingerprintResult {
	readonly hash: string;
	readonly headBuffer: ArrayBuffer;
}

export async function computeFileFingerprint(
	file: Blob,
	cachedTail?: ArrayBuffer,
): Promise<FingerprintResult> {
	const sliceSize = 65536;
	const headBuffer = await readBlobSliceBuffer(
		file,
		0,
		Math.min(file.size, 262144),
	);
	const head = new Uint8Array(
		headBuffer.slice(0, Math.min(headBuffer.byteLength, sliceSize)),
	);

	let tail: Uint8Array;
	if (cachedTail && cachedTail.byteLength >= Math.min(file.size, sliceSize)) {
		const tailLen = Math.min(file.size, sliceSize);
		const start = cachedTail.byteLength - tailLen;
		tail = new Uint8Array(cachedTail.slice(start));
	} else {
		const tailStart = Math.max(0, file.size - sliceSize);
		tail = new Uint8Array(
			await readBlobSliceBuffer(file, tailStart, file.size),
		);
	}

	const sizeBytes = new Uint8Array(8);
	const view = new DataView(sizeBytes.buffer);
	view.setBigUint64(0, BigInt(file.size), true);

	const combined = new Uint8Array(
		head.byteLength + tail.byteLength + sizeBytes.byteLength,
	);
	combined.set(head, 0);
	combined.set(tail, head.byteLength);
	combined.set(sizeBytes, head.byteLength + tail.byteLength);

	const hashBuffer = await crypto.subtle.digest("SHA-256", combined);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hash = hashArray
		.slice(0, 16)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

	return { hash, headBuffer };
}
