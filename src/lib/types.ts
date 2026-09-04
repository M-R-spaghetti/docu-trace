// Bounding box from Gemini: [ymin, xmin, ymax, xmax] normalized 0-1000
export type BoundingBox = [number, number, number, number];

export interface LocatedValue<T = string> {
    value: T;
    box_2d: BoundingBox; // [ymin, xmin, ymax, xmax] 0-1000
    page: number;        // 1-indexed page number (always 1 for images)
    originalValue?: T;   // Preserves initial AI extraction when user edits the field
}

export type VerificationStatus = 'pending' | 'verified' | 'edited';

export interface VerificationItemState {
    status: VerificationStatus;
    editedValue?: string;
    columns?: Record<string, string>;
}

export type VerificationStateMap = Record<string, VerificationItemState>;

// The active highlight target — passed from DataTable to DocumentViewer
export interface ActiveHighlight {
    box_2d: BoundingBox;
    page: number;
    label?: string; // Optional label to show near the box
    rawValue?: string; // Extracted text value for vector text snapping via pdf.js
    fileId?: string; // File ID for batch mode
    fileName?: string; // File name for batch mode
    columnKey?: string; // Column/field name
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
