import type { BoundingBox } from "@/lib/types";
import { adaptiveThreshold } from "./adaptiveThreshold";
import { findInkSpans, findLineBands, medianLineSpacing, verticalProjection } from "./projectionProfile";
import type { ImageSnapResult } from "./types";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const normalizeBox = (top: number, left: number, bottom: number, right: number, width: number, height: number): BoundingBox => [
    clamp(top / height * 1000, 0, 1000), clamp(left / width * 1000, 0, 1000),
    clamp(bottom / height * 1000, 0, 1000), clamp(right / width * 1000, 0, 1000),
];

/** Refines a Gemini prior to an ink line. Images can never return `exact` without OCR text. */
export function snapImageData(image: Pick<ImageData, "data" | "width" | "height">, modelBox: BoundingBox): ImageSnapResult {
    const { width, height } = image;
    const hintTop = modelBox[0] / 1000 * height;
    const hintLeft = modelBox[1] / 1000 * width;
    const hintBottom = modelBox[2] / 1000 * height;
    const hintRight = modelBox[3] / 1000 * width;
    const hintCenterY = (hintTop + hintBottom) / 2;
    const ink = adaptiveThreshold(image, { windowSize: Math.max(15, Math.round(height / 45)), threshold: 0.15 });
    const bands = findLineBands(ink, width, height);
    const spacing = medianLineSpacing(bands, Math.max(12, hintBottom - hintTop) * 1.8);
    const nearest = bands.reduce<typeof bands[number] | undefined>((best, band) => !best || Math.abs(band.center - hintCenterY) < Math.abs(best.center - hintCenterY) ? band : best, undefined);
    const distance = nearest ? Math.abs(nearest.center - hintCenterY) : Number.POSITIVE_INFINITY;

    // A prior in the whitespace between two rows is not evidence for either row.
    // Use less than half the median line spacing to avoid snapping to a neighbour.
    if (!nearest || distance > spacing * 0.4) {
        const center = nearest && distance <= spacing * 2.5 ? nearest.center : hintCenterY;
        const half = nearest ? Math.max(4, (nearest.bottom - nearest.top) * 0.8) : Math.max(8, (hintBottom - hintTop) / 2);
        return { box_2d: normalizeBox(center - half, 0, center + half, width, width, height), status: "approximate", source: "approximate", lineDistance: distance, medianLineSpacing: spacing };
    }

    const profile = verticalProjection(ink, width, height, nearest.top, nearest.bottom);
    const spans = findInkSpans(profile, 0.08, Math.max(2, Math.round(spacing * 0.12)));
    const horizontalPadding = Math.max(3, spacing * 0.2);
    const overlapping = spans.filter(span => span.right >= hintLeft - horizontalPadding && span.left <= hintRight + horizontalPadding);
    const left = overlapping.length ? Math.min(...overlapping.map(span => span.left)) : hintLeft;
    const right = overlapping.length ? Math.max(...overlapping.map(span => span.right)) : hintRight;
    const verticalPadding = Math.max(1, (nearest.bottom - nearest.top) * 0.08);
    return {
        box_2d: normalizeBox(nearest.top - verticalPadding, left - horizontalPadding, nearest.bottom + verticalPadding, right + horizontalPadding, width, height),
        status: "refined", source: "projection", lineDistance: distance, medianLineSpacing: spacing,
    };
}

export function imageDataFromElement(image: HTMLImageElement, maxSide = 1800): ImageData {
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    const scale = Math.min(1, maxSide / Math.max(naturalWidth, naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(naturalHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D is unavailable");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return context.getImageData(0, 0, canvas.width, canvas.height);
}

export function groundingCacheKey(file: File, field: { page?: number; columnKey?: string; rawText?: string; rawValue?: string; box_2d: BoundingBox }): string {
    return [file.name, file.size, file.lastModified, field.page || 1, field.columnKey || "field", field.rawText || field.rawValue || "", field.box_2d.join(",")].join("::");
}
