import { PDFDocument } from "pdf-lib";
import { optimizeImageFile } from "./media";

export interface PdfChunk {
    chunkFile: File;
    startPage: number; // 1-based
    endPage: number;   // 1-based
    pageOffset: number; // 0-based offset to add to relative pages (e.g. 0, 5, 10)
    pageCount: number;
}

/**
 * Converts an array of image files (or mixed PDFs) into a single, high-fidelity
 * multi-page PDF document in browser memory.
 */
export async function stitchImagesToPdf(
    files: File[],
    onProgress?: (percent: number) => void
): Promise<File> {
    const masterPdf = await PDFDocument.create();
    const totalFiles = files.length;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (onProgress) {
            onProgress(Math.round(((i + 1) / files.length) * 100));
        }

        // Yield to browser event loop so progress bar updates smoothly without blocking main thread
        await new Promise(r => setTimeout(r, 0));

        if (file.type === "application/pdf") {
            try {
                const srcBytes = await file.arrayBuffer();
                const srcDoc = await PDFDocument.load(srcBytes);
                const copiedPages = await masterPdf.copyPages(srcDoc, srcDoc.getPageIndices());
                copiedPages.forEach(p => masterPdf.addPage(p));
            } catch (err) {
                console.warn(`Failed to merge PDF ${file.name}:`, err);
            }
            continue;
        }

        if (file.type.startsWith("image/")) {
            try {
                // Downscale huge camera photos to keep memory reasonable (~1600px max edge)
                const optimized = await optimizeImageFile(file, 1600, 0.82);
                const bytes = await optimized.arrayBuffer();

                let embeddedImage;
                if (file.type === "image/png") {
                    try {
                        embeddedImage = await masterPdf.embedPng(bytes);
                    } catch {
                        // If PNG embed fails (e.g. unhandled color space), fallback to JPEG
                        embeddedImage = await masterPdf.embedJpg(bytes);
                    }
                } else {
                    embeddedImage = await masterPdf.embedJpg(bytes);
                }

                const page = masterPdf.addPage([embeddedImage.width, embeddedImage.height]);
                page.drawImage(embeddedImage, {
                    x: 0,
                    y: 0,
                    width: embeddedImage.width,
                    height: embeddedImage.height,
                });
            } catch (err) {
                console.warn(`Failed to embed image ${file.name} into PDF:`, err);
            }
        }
    }

    await new Promise(r => setTimeout(r, 10));
    const mergedBytes = await masterPdf.save();
    return new File([mergedBytes as any], `stitched_batch_${Date.now()}.pdf`, {
        type: "application/pdf",
    });
}

/**
 * Slices any PDF (uploaded or stitched) into consecutive lightweight chunks
 * of chunkSize pages (default: 5 pages).
 */
export async function slicePdfChunks(
    pdfBytes: ArrayBuffer,
    chunkSize = 5
): Promise<PdfChunk[]> {
    const srcDoc = await PDFDocument.load(pdfBytes);
    const totalPages = srcDoc.getPageCount();
    const chunks: PdfChunk[] = [];

    let currentStart = 0;
    while (currentStart < totalPages) {
        const count = Math.min(chunkSize, totalPages - currentStart);
        const pageIndices = Array.from({ length: count }, (_, i) => currentStart + i);

        const subDoc = await PDFDocument.create();
        const copiedPages = await subDoc.copyPages(srcDoc, pageIndices);
        copiedPages.forEach(p => subDoc.addPage(p));

        const subBytes = await subDoc.save();
        const startPageNum = currentStart + 1;
        const endPageNum = currentStart + count;

        const chunkFile = new File(
            [subBytes as any],
            `chunk_${startPageNum}_${endPageNum}.pdf`,
            { type: "application/pdf" }
        );

        chunks.push({
            chunkFile,
            startPage: startPageNum,
            endPage: endPageNum,
            pageOffset: currentStart,
            pageCount: count,
        });

        currentStart += count;
    }

    return chunks;
}

/**
 * Deep traversal to shift relative page numbers in extracted leaf objects:
 * leaf.page = leaf.page + pageOffset
 */
export function remapExtractedChunkPages(data: any, pageOffset: number): any {
    if (!data || pageOffset === 0) return data;

    if (Array.isArray(data)) {
        return data.map(item => remapExtractedChunkPages(item, pageOffset));
    }

    if (typeof data === "object") {
        // If this is a leaf node { value, box_2d, page }
        if ("box_2d" in data && "page" in data) {
            const rawPage = typeof data.page === "number" ? data.page : 1;
            return {
                ...data,
                page: rawPage + pageOffset,
            };
        }

        const remapped: Record<string, any> = {};
        for (const [k, v] of Object.entries(data)) {
            remapped[k] = remapExtractedChunkPages(v, pageOffset);
        }
        return remapped;
    }

    return data;
}

/**
 * Merges a newly arrived chunk of extracted data into the existing master dataset.
 * Appends array items and maintains document structure.
 */
export function mergeExtractedData(baseData: any, newChunkData: any): any {
    if (!baseData) return newChunkData;
    if (!newChunkData) return baseData;

    const merged = { ...baseData };

    for (const key of Object.keys(newChunkData)) {
        const newVal = newChunkData[key];
        const baseVal = baseData[key];

        if (Array.isArray(newVal) && Array.isArray(baseVal)) {
            // Append array items (e.g. items, lines, products)
            merged[key] = [...baseVal, ...newVal];
        } else if (Array.isArray(newVal) && !baseVal) {
            merged[key] = newVal;
        } else if (typeof newVal === "object" && newVal !== null && typeof baseVal === "object" && baseVal !== null) {
            if ("value" in newVal && "box_2d" in newVal) {
                // If it's a leaf node that already exists, preserve the first or latest
                merged[key] = baseVal;
            } else {
                merged[key] = mergeExtractedData(baseVal, newVal);
            }
        } else if (!baseVal) {
            merged[key] = newVal;
        }
    }

    return merged;
}

/**
 * Stitches a small subset of image files (e.g. 5 images) directly into a lightweight
 * PDF chunk on demand, without ever creating a giant multi-page PDF in browser memory.
 */
export async function createChunkFromImageFiles(
    files: File[],
    pageOffset: number,
    chunkIndex: number
): Promise<PdfChunk> {
    const doc = await PDFDocument.create();

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type === "application/pdf") {
            try {
                const srcBytes = await file.arrayBuffer();
                const srcDoc = await PDFDocument.load(srcBytes);
                const copied = await doc.copyPages(srcDoc, srcDoc.getPageIndices());
                copied.forEach(p => doc.addPage(p));
            } catch (err) {
                console.warn(`Failed to copy PDF ${file.name}:`, err);
            }
            continue;
        }

        try {
            const bytes = await file.arrayBuffer();
            let img;
            if (file.type === "image/png") {
                try {
                    img = await doc.embedPng(bytes);
                } catch {
                    img = await doc.embedJpg(bytes);
                }
            } else {
                img = await doc.embedJpg(bytes);
            }

            const page = doc.addPage([img.width, img.height]);
            page.drawImage(img, {
                x: 0,
                y: 0,
                width: img.width,
                height: img.height,
            });
        } catch (err) {
            console.warn(`Failed to embed image ${file.name} into chunk:`, err);
        }
    }

    const pdfBytes = await doc.save();
    const chunkFile = new File([pdfBytes as any], `chunk_${chunkIndex}.pdf`, {
        type: "application/pdf",
    });

    return {
        chunkFile,
        startPage: pageOffset + 1,
        endPage: pageOffset + files.length,
        pageOffset,
        pageCount: files.length,
    };
}
