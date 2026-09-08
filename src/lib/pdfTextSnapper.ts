import type { BoundingBox, GroundingFieldType } from "@/lib/types";
import { fuzzyScore, normalizeForField } from "@/lib/snapping/fuzzyMatcher";

export interface SnappedTextResult {
    box_2d: BoundingBox;
    matchedText: string;
    distance: number;
    isExact: boolean;
    score: number;
    contextScore: number;
    status: "exact";
}

export interface RawTextItem { str: string; transform: number[]; width: number; height: number }
export interface PdfSnapOptions { rawText?: string; lineContext?: string; fieldType?: GroundingFieldType; minimumScore?: number }

const pageTextCache = new Map<string, { items: RawTextItem[]; width: number; height: number }>();

export function normalizeFinancialText(text: string): string { return normalizeForField(text, "amount"); }

function itemToBoundingBox(tx: number, ty: number, width: number, height: number, pageWidth: number, pageHeight: number): BoundingBox {
    const effectiveHeight = Math.max(height, 8);
    return [
        Math.max(0, Math.min(1000, ((pageHeight - ty - effectiveHeight) / pageHeight) * 1000)),
        Math.max(0, Math.min(1000, (tx / pageWidth) * 1000)),
        Math.max(0, Math.min(1000, ((pageHeight - ty) / pageHeight) * 1000)),
        Math.max(0, Math.min(1000, ((tx + width) / pageWidth) * 1000)),
    ];
}

export async function getPageTextItems(pdfDoc: any, pageNumber: number): Promise<{ items: RawTextItem[]; width: number; height: number }> {
    const cacheKey = `${pdfDoc.fingerprint || "doc"}_${pageNumber}`;
    const cached = pageTextCache.get(cacheKey);
    if (cached) return cached;
    try {
        const page = await pdfDoc.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const textContent = await page.getTextContent();
        const result = { items: ((textContent.items || []) as RawTextItem[]).filter(item => item.str?.trim()), width: viewport.width, height: viewport.height };
        pageTextCache.set(cacheKey, result);
        return result;
    } catch (error) {
        console.warn(`[pdfTextSnapper] Failed to extract text for page ${pageNumber}:`, error);
        return { items: [], width: 0, height: 0 };
    }
}

function groupIntoLines(items: RawTextItem[]): RawTextItem[][] {
    const heights = items.map(item => Math.abs(item.height || item.transform[3] || 8)).sort((a, b) => a - b);
    const tolerance = Math.max(2, (heights[Math.floor(heights.length / 2)] || 8) * 0.45);
    const lines: RawTextItem[][] = [];
    for (const item of [...items].sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])) {
        const line = lines.find(candidate => Math.abs(candidate[0].transform[5] - item.transform[5]) <= tolerance);
        if (line) line.push(item); else lines.push([item]);
    }
    return lines.map(line => line.sort((a, b) => a.transform[4] - b.transform[4]));
}

/** Text is evidence; the model box is only the final tie-breaker. */
export function snapToPdfText(targetValue: string, modelBoxHint: BoundingBox, pageItems: RawTextItem[], pageWidth: number, pageHeight: number, options: PdfSnapOptions = {}): SnappedTextResult | null {
    if (!pageItems.length || pageWidth <= 0 || pageHeight <= 0) return null;
    const fieldType = options.fieldType || "text";
    const target = options.rawText || targetValue;
    const minimumScore = options.minimumScore ?? 0.8;
    if (!normalizeForField(target, fieldType)) return null;
    const hintX = (modelBoxHint[1] + modelBoxHint[3]) / 2;
    const hintY = (modelBoxHint[0] + modelBoxHint[2]) / 2;
    const candidates: SnappedTextResult[] = [];

    for (const line of groupIntoLines(pageItems)) {
        const lineText = line.map(item => item.str).join(" ");
        const contextScore = options.lineContext ? fuzzyScore(lineText, options.lineContext, fieldType) : 0;
        for (let start = 0; start < line.length; start++) {
            let combined = "";
            for (let end = start; end < Math.min(line.length, start + 10); end++) {
                combined += (combined ? " " : "") + line[end].str;
                const score = fuzzyScore(combined, target, fieldType);
                if (score < minimumScore) continue;
                const first = line[start];
                const last = line[end];
                const left = first.transform[4];
                const right = last.transform[4] + last.width;
                const height = Math.max(...line.slice(start, end + 1).map(item => item.height));
                const box = itemToBoundingBox(left, first.transform[5], right - left, height, pageWidth, pageHeight);
                candidates.push({ box_2d: box, matchedText: combined, distance: Math.hypot((box[1] + box[3]) / 2 - hintX, (box[0] + box[2]) / 2 - hintY), isExact: normalizeForField(combined, fieldType) === normalizeForField(target, fieldType), score, contextScore, status: "exact" });
            }
        }
    }
    if (!candidates.length) return null;
    const bestTextScore = Math.max(...candidates.map(candidate => candidate.score));
    let finalists = candidates.filter(candidate => candidate.score >= bestTextScore - 0.001);
    if (options.lineContext) {
        const bestContextScore = Math.max(...finalists.map(candidate => candidate.contextScore));
        finalists = finalists.filter(candidate => candidate.contextScore >= bestContextScore - 0.001);
    }
    finalists.sort((a, b) => a.distance - b.distance);
    return finalists[0];
}
