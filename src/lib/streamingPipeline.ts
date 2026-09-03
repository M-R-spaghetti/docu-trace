import { slicePdfChunks, remapExtractedChunkPages, mergeExtractedData, PdfChunk } from "./pdfStitcher";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface StreamingProgress {
    currentChunk: number;
    totalChunks: number;
    processedPages: number;
    totalPages: number;
    percent: number;
    isQuotaWaiting: boolean;
    quotaWaitSeconds: number;
}

export interface RunStreamingPipelineOptions {
    file: File;
    prompt?: string;
    format?: string;
    schema?: any;
    chunkSize?: number;
    onChunkStart?: (chunk: PdfChunk, chunkIndex: number, totalChunks: number) => void;
    onChunkSuccess?: (chunkData: any, remappedData: any, aggregatedData: any, chunkIndex: number) => void;
    onProgress?: (progress: StreamingProgress) => void;
    onQuotaWait?: (seconds: number) => void;
    signal?: AbortSignal;
}

/**
 * Executes a progressive streaming extraction pipeline:
 * Slices the PDF into chunks, fetches schema once, and streams results page by page.
 */
export async function runStreamingPipeline(opts: RunStreamingPipelineOptions): Promise<any> {
    const bytes = await opts.file.arrayBuffer();
    const chunks = await slicePdfChunks(bytes, opts.chunkSize ?? 5);
    const totalChunks = chunks.length;

    const totalPages = chunks.reduce((acc, c) => acc + c.pageCount, 0);
    let aggregatedData: any = null;
    let processedPages = 0;

    const emitProgress = (
        currentChunk: number,
        isQuotaWaiting = false,
        quotaWaitSeconds = 0
    ) => {
        if (opts.onProgress) {
            const percent = totalChunks > 0 ? Math.round((processedPages / totalPages) * 100) : 0;
            opts.onProgress({
                currentChunk,
                totalChunks,
                processedPages,
                totalPages,
                percent,
                isQuotaWaiting,
                quotaWaitSeconds,
            });
        }
    };

    // 1. Generate Schema once upfront if not already provided
    let masterSchema = opts.schema;
    if (!masterSchema) {
        try {
            console.log("[StreamingPipeline] Generating master schema upfront...");
            const schemaRes = await fetch("/api/schema", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: opts.prompt || "Extract receipt or invoice data: store, date, items, subtotal, tax, total.",
                    format: opts.format || "table",
                }),
                signal: opts.signal,
            });
            if (schemaRes.ok) {
                const schemaJson = await schemaRes.json();
                masterSchema = schemaJson.schema;
            }
        } catch (e) {
            console.warn("[StreamingPipeline] Schema generation error, falling back to per-chunk schema:", e);
        }
    }

    emitProgress(0);

    // 2. Process chunks sequentially to respect rate limits
    for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
        if (opts.signal?.aborted) {
            throw new Error("Streaming extraction was cancelled by user.");
        }

        const chunk = chunks[chunkIdx];
        if (opts.onChunkStart) {
            opts.onChunkStart(chunk, chunkIdx + 1, totalChunks);
        }

        let chunkData: any = null;
        let attempts = 0;
        const maxAttempts = 6;

        while (attempts < maxAttempts && !chunkData) {
            attempts++;
            if (opts.signal?.aborted) throw new Error("Cancelled by user.");

            try {
                const fd = new FormData();
                fd.append("file", chunk.chunkFile);
                if (opts.prompt) fd.append("prompt", opts.prompt);
                if (opts.format) fd.append("format", opts.format);
                if (masterSchema) fd.append("schema", JSON.stringify(masterSchema));

                const res = await fetch("/api/extract", {
                    method: "POST",
                    body: fd,
                    signal: opts.signal,
                });

                if (!res.ok) {
                    const retryHeader = res.headers.get("retry-after");
                    let waitSec = retryHeader ? parseInt(retryHeader, 10) : 0;
                    if (isNaN(waitSec) || waitSec <= 0) {
                        waitSec = Math.min(2 ** attempts * 2, 45);
                    }

                    if (res.status === 429 || res.status === 503) {
                        console.warn(`[StreamingPipeline] Rate limit / high demand hit. Waiting ${waitSec}s before retry...`);
                        emitProgress(chunkIdx + 1, true, waitSec);
                        if (opts.onQuotaWait) opts.onQuotaWait(waitSec);

                        // Countdown sleep
                        for (let s = waitSec; s > 0; s--) {
                            if (opts.signal?.aborted) throw new Error("Cancelled by user.");
                            emitProgress(chunkIdx + 1, true, s);
                            if (opts.onQuotaWait) opts.onQuotaWait(s);
                            await sleep(1000);
                        }
                        emitProgress(chunkIdx + 1, false, 0);
                        continue;
                    }

                    const errJson = await res.json().catch(() => ({}));
                    throw new Error(errJson.error || `HTTP error ${res.status}`);
                }

                const result = await res.json();
                chunkData = result.data;
            } catch (err: any) {
                if (opts.signal?.aborted) throw err;
                if (attempts >= maxAttempts) {
                    console.error(`[StreamingPipeline] Chunk ${chunkIdx + 1} failed after ${maxAttempts} attempts:`, err);
                    throw err;
                }
                const backoff = 2000 * attempts;
                console.warn(`[StreamingPipeline] Retry attempt ${attempts} in ${backoff}ms...`);
                await sleep(backoff);
            }
        }

        if (chunkData) {
            // Remap relative page numbers to absolute pages in master PDF
            const remappedChunkData = remapExtractedChunkPages(chunkData, chunk.pageOffset);
            aggregatedData = mergeExtractedData(aggregatedData, remappedChunkData);
            processedPages += chunk.pageCount;

            emitProgress(chunkIdx + 1, false, 0);

            if (opts.onChunkSuccess) {
                opts.onChunkSuccess(chunkData, remappedChunkData, aggregatedData, chunkIdx + 1);
            }
        }
    }

    return aggregatedData;
}
