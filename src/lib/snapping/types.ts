import type { BoundingBox, GroundingStatus } from "@/lib/types";

export interface LineBand {
    top: number;
    bottom: number;
    center: number;
    baseline: number;
    density: number;
}

export interface ImageSnapResult {
    box_2d: BoundingBox;
    status: Exclude<GroundingStatus, "exact">;
    source: "projection" | "approximate" | "gemini_fallback";
    lineDistance: number;
    medianLineSpacing: number;
}
