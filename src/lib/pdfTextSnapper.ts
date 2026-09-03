import { BoundingBox } from "@/lib/types";

export interface SnappedTextResult {
    box_2d: BoundingBox;
    matchedText: string;
    distance: number;
    isExact: boolean;
}

interface RawTextItem {
    str: string;
    transform: number[]; // [scaleX, skewY, skewX, scaleY, tx, ty]
    width: number;
    height: number;
}

// In-memory cache for page text contents: Map<`${pdfId}_${pageNum}`, { items: RawTextItem[], width: number, height: number }>
const pageTextCache = new Map<string, { items: RawTextItem[]; width: number; height: number }>();

/**
 * Normalizes text for resilient financial document matching:
 * Handles different decimal separators (1250,00 vs 1250.00),
 * removes non-breaking spaces, currency symbols, and excess whitespace.
 */
export function normalizeFinancialText(text: string): string {
    if (!text) return "";
    return text
        .toLowerCase()
        .replace(/[\u00A0\u1680\u180e\u2000-\u200a\u202f\u205f\u3000\s]+/g, "") // remove all whitespace
        .replace(/[,]/g, ".") // unify commas to dots
        .replace(/[₴$€£¥₽]/g, "") // strip currency symbols
        .replace(/^(грн|uah|usd|eur|rub)\.?/gi, "")
        .replace(/(грн|uah|usd|eur|rub)\.?$/gi, "")
        .trim();
}

/**
 * Converts a pdf.js text item coordinates into normalized [0..1000] BoundingBox.
 * PDF coordinates have origin (0,0) at bottom-left; we convert to top-left origin.
 */
function itemToBoundingBox(
    tx: number,
    ty: number,
    width: number,
    height: number,
    pageWidth: number,
    pageHeight: number
): BoundingBox {
    // In PDF space, ty is text baseline from bottom.
    // Ensure height is positive and at least a reasonable baseline offset
    const effectiveHeight = Math.max(height, 8);
    const yTop = pageHeight - ty - effectiveHeight;
    const yBottom = pageHeight - ty;

    const ymin = Math.max(0, Math.min(1000, (yTop / pageHeight) * 1000));
    const xmin = Math.max(0, Math.min(1000, (tx / pageWidth) * 1000));
    const ymax = Math.max(0, Math.min(1000, (yBottom / pageHeight) * 1000));
    const xmax = Math.max(0, Math.min(1000, ((tx + width) / pageWidth) * 1000));

    return [ymin, xmin, ymax, xmax];
}

/**
 * Extracts and caches vector text items from a pdf.js page proxy.
 */
export async function getPageTextItems(
    pdfDoc: any,
    pageNumber: number
): Promise<{ items: RawTextItem[]; width: number; height: number }> {
    const cacheKey = `${pdfDoc.fingerprint || 'doc'}_${pageNumber}`;
    const cached = pageTextCache.get(cacheKey);
    if (cached) return cached;

    try {
        const page = await pdfDoc.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.0 });
        const textContent = await page.getTextContent();

        const rawItems = (textContent.items || []) as RawTextItem[];
        const result = {
            items: rawItems.filter(item => item.str && item.str.trim().length > 0),
            width: viewport.width,
            height: viewport.height,
        };

        pageTextCache.set(cacheKey, result);
        return result;
    } catch (err) {
        console.warn(`[pdfTextSnapper] Failed to extract text for page ${pageNumber}:`, err);
        return { items: [], width: 0, height: 0 };
    }
}

/**
 * Snaps a model's approximate bounding box to exact vector text glyphs in the PDF.
 *
 * 1. Searches page text for occurrences of targetValue.
 * 2. If multiple candidates exist, disambiguates by choosing the candidate
 *    whose center is closest to modelBoxHint.
 * 3. Returns exact vector bounding box [ymin, xmin, ymax, xmax] (0-1000).
 */
export function snapToPdfText(
    targetValue: string,
    modelBoxHint: BoundingBox,
    pageItems: RawTextItem[],
    pageWidth: number,
    pageHeight: number
): SnappedTextResult | null {
    if (!targetValue || !pageItems || pageItems.length === 0 || pageWidth <= 0 || pageHeight <= 0) {
        return null;
    }

    const normalizedTarget = normalizeFinancialText(targetValue);
    if (!normalizedTarget || normalizedTarget.length < 2) {
        return null;
    }

    const [hintYmin, hintXmin, hintYmax, hintXmax] = modelBoxHint;
    const hintCenterX = (hintXmin + hintXmax) / 2;
    const hintCenterY = (hintYmin + hintYmax) / 2;

    const candidates: SnappedTextResult[] = [];

    // --- Pass 1: Single item matches ---
    for (const item of pageItems) {
        const normalizedItem = normalizeFinancialText(item.str);
        if (!normalizedItem) continue;

        const isExact = normalizedItem === normalizedTarget;
        const isSub = normalizedItem.includes(normalizedTarget) || normalizedTarget.includes(normalizedItem);

        if (isExact || (isSub && normalizedItem.length >= 3)) {
            const tx = item.transform[4];
            const ty = item.transform[5];
            const box = itemToBoundingBox(tx, ty, item.width, item.height, pageWidth, pageHeight);

            const boxCenterX = (box[1] + box[3]) / 2;
            const boxCenterY = (box[0] + box[2]) / 2;
            const distance = Math.hypot(boxCenterX - hintCenterX, boxCenterY - hintCenterY);

            candidates.push({
                box_2d: box,
                matchedText: item.str,
                distance,
                isExact
            });
        }
    }

    // --- Pass 2: Multi-item spans on the same baseline ---
    // Often pdf.js splits numbers: ["1 ", "250", ",00"]
    if (candidates.length === 0 || !candidates.some(c => c.isExact)) {
        // Group items that share approximately the same Y baseline (within 4 PDF points)
        const lineGroups: RawTextItem[][] = [];
        const sortedItems = [...pageItems].sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);

        let currentGroup: RawTextItem[] = [];
        let currentY = -9999;

        for (const item of sortedItems) {
            const y = item.transform[5];
            if (Math.abs(y - currentY) <= 4) {
                currentGroup.push(item);
            } else {
                if (currentGroup.length > 0) lineGroups.push(currentGroup);
                currentGroup = [item];
                currentY = y;
            }
        }
        if (currentGroup.length > 0) lineGroups.push(currentGroup);

        // Check sliding window across each line
        for (const line of lineGroups) {
            line.sort((a, b) => a.transform[4] - b.transform[4]); // sort left to right

            for (let i = 0; i < line.length; i++) {
                let combinedStr = "";
                let combinedWidth = 0;
                const startTx = line[i].transform[4];
                const lineTy = line[i].transform[5];
                let maxHeight = line[i].height;

                for (let j = i; j < Math.min(line.length, i + 6); j++) {
                    combinedStr += line[j].str;
                    combinedWidth = (line[j].transform[4] + line[j].width) - startTx;
                    maxHeight = Math.max(maxHeight, line[j].height);

                    const normCombined = normalizeFinancialText(combinedStr);
                    if (normCombined === normalizedTarget || (normCombined.includes(normalizedTarget) && normCombined.length <= normalizedTarget.length + 4)) {
                        const box = itemToBoundingBox(startTx, lineTy, combinedWidth, maxHeight, pageWidth, pageHeight);
                        const boxCenterX = (box[1] + box[3]) / 2;
                        const boxCenterY = (box[0] + box[2]) / 2;
                        const distance = Math.hypot(boxCenterX - hintCenterX, boxCenterY - hintCenterY);

                        candidates.push({
                            box_2d: box,
                            matchedText: combinedStr,
                            distance,
                            isExact: normCombined === normalizedTarget
                        });
                        break;
                    }
                }
            }
        }
    }

    if (candidates.length === 0) {
        return null;
    }

    // Sort by: exact matches first, then smallest distance to model hint
    candidates.sort((a, b) => {
        if (a.isExact && !b.isExact) return -1;
        if (!a.isExact && b.isExact) return 1;
        return a.distance - b.distance;
    });

    // If the closest match is unreasonably far (> 350 units in 0-1000 space),
    // it is likely a false positive elsewhere on the document; fallback to model hint.
    if (candidates[0].distance > 350) {
        return null;
    }

    return candidates[0];
}
