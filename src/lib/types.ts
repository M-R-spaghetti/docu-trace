// Bounding box from Gemini: [ymin, xmin, ymax, xmax] normalized 0-1000
export type BoundingBox = [number, number, number, number];

// The universal "located value" — every extracted field wraps its value with spatial coordinates
export interface LocatedValue<T = string> {
    value: T;
    box_2d: BoundingBox; // [ymin, xmin, ymax, xmax] 0-1000
    page: number;        // 1-indexed page number (always 1 for images)
}

// The active highlight target — passed from DataTable to DocumentViewer
export interface ActiveHighlight {
    box_2d: BoundingBox;
    page: number;
    label?: string; // Optional label to show near the box
}

// Legacy types kept for reference but no longer used in the new pipeline
export interface ExtractedField<T = string> {
    value: T;
    bbox: BoundingBox;
}

export interface LineItem {
    description: ExtractedField<string>;
    quantity: ExtractedField<string>;
    price: ExtractedField<string>;
}

export interface ExtractedData {
    companyName?: ExtractedField<string>;
    date?: ExtractedField<string>;
    totalAmount?: ExtractedField<string>;
    taxAmount?: ExtractedField<string>;
    lineItems?: LineItem[];
}
