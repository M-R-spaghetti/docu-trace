import { CellReview, AutoCheck, HumanReview } from "./review";

export type { CellReview, AutoCheck, HumanReview };

export interface DocRow {
    fileId: string;                  // Consistent deterministic unique identifier
    fileName: string;
    file: File;
    data: Record<string, any>;       // { price: { value, box_2d, page: 1 }, items: [...] }
    status: "queued" | "extracting" | "done" | "failed" | "timeout";
    error?: string;
    reviews: Record<string, CellReview>;
    editedValues?: Record<string, string>;
}

export interface BatchProgressInfo {
    total: number;
    completed: number;
    failed: number;
    active: number;
    percent: number;
}

export type { FlatRow, FlatRowCell } from "./flatten";
