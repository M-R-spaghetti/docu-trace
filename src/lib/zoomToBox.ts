/**
 * Calculates optimal scale and scroll positions to focus and center a normalized [ymin, xmin, ymax, xmax]
 * bounding box within a document viewport container.
 * 
 * Uses targetFill = 0.30 by default so the field takes ~30% of the screen,
 * preserving surrounding context (e.g. neighboring line items and receipt headers).
 */

export interface BoxViewOptions {
    containerWidth: number;
    containerHeight: number;
    pageWidth: number;
    pageHeight: number;
    box: [number, number, number, number]; // [ymin, xmin, ymax, xmax] in 0..1000
    targetFill?: number; // default 0.30 (30% of viewport)
    minScale?: number;   // default 1.0
    maxScale?: number;   // default 4.0
}

export interface BoxViewResult {
    scale: number;
    scrollLeft: number;
    scrollTop: number;
    boxRect: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}

export function computeBoxView({
    containerWidth,
    containerHeight,
    pageWidth,
    pageHeight,
    box,
    targetFill = 0.30,
    minScale = 1.0,
    maxScale = 4.0,
}: BoxViewOptions): BoxViewResult {
    if (
        containerWidth <= 0 ||
        containerHeight <= 0 ||
        pageWidth <= 0 ||
        pageHeight <= 0 ||
        !box ||
        box.length !== 4
    ) {
        return {
            scale: 1.0,
            scrollLeft: 0,
            scrollTop: 0,
            boxRect: { x: 0, y: 0, width: 0, height: 0 },
        };
    }

    const [ymin, xmin, ymax, xmax] = box;

    // Guard against inverted or zero boxes
    const validXmin = Math.max(0, Math.min(xmin, xmax));
    const validXmax = Math.min(1000, Math.max(xmin, xmax));
    const validYmin = Math.max(0, Math.min(ymin, ymax));
    const validYmax = Math.min(1000, Math.max(ymin, ymax));

    const boxWidthFrac = Math.max(0.01, (validXmax - validXmin) / 1000);
    const boxHeightFrac = Math.max(0.008, (validYmax - validYmin) / 1000);

    const boxWidthPx = boxWidthFrac * pageWidth;
    const boxHeightPx = boxHeightFrac * pageHeight;

    const centerFracX = (validXmin + validXmax) / 2000;
    const centerFracY = (validYmin + validYmax) / 2000;

    // Scale so that the bounding box occupies ~targetFill of the container
    const scaleX = (containerWidth * targetFill) / boxWidthPx;
    const scaleY = (containerHeight * targetFill) / boxHeightPx;

    const idealScale = Math.min(scaleX, scaleY);
    const scale = Math.max(minScale, Math.min(maxScale, idealScale));

    // Calculate scroll positions to center the target box in container viewport
    const scaledPageWidth = pageWidth * scale;
    const scaledPageHeight = pageHeight * scale;

    const scaledCenterX = centerFracX * scaledPageWidth;
    const scaledCenterY = centerFracY * scaledPageHeight;

    const maxScrollLeft = Math.max(0, scaledPageWidth - containerWidth);
    const maxScrollTop = Math.max(0, scaledPageHeight - containerHeight);

    const targetScrollLeft = scaledCenterX - containerWidth / 2;
    const targetScrollTop = scaledCenterY - containerHeight / 2;

    const scrollLeft = Math.max(0, Math.min(maxScrollLeft, targetScrollLeft));
    const scrollTop = Math.max(0, Math.min(maxScrollTop, targetScrollTop));

    return {
        scale: Number(scale.toFixed(2)),
        scrollLeft: Math.round(scrollLeft),
        scrollTop: Math.round(scrollTop),
        boxRect: {
            x: Math.round((validXmin / 1000) * pageWidth),
            y: Math.round((validYmin / 1000) * pageHeight),
            width: Math.round(boxWidthPx),
            height: Math.round(boxHeightPx),
        },
    };
}
