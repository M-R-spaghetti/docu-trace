import { describe, expect, it } from "vitest";
import { fuzzyScore, normalizeForField } from "./fuzzyMatcher";

describe("field-aware fuzzy matching", () => {
    it("allows OCR digit confusions for dates and amounts", () => {
        expect(fuzzyScore("18-O1-2O18", "18-01-2018", "date")).toBe(1);
        expect(fuzzyScore("15O,OO", "150.00", "amount")).toBe(1);
    });

    it("does not rewrite letters in ordinary text", () => {
        expect(normalizeForField("BOOK STORE", "text")).toBe("bookstore");
        expect(fuzzyScore("B00K", "BOOK", "text")).toBeLessThan(0.8);
    });
});
