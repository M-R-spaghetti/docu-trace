import { describe, expect, it } from "vitest";
import { snapToPdfText, type RawTextItem } from "./pdfTextSnapper";

const item = (str: string, x: number, y: number): RawTextItem => ({ str, transform: [1, 0, 0, 10, x, y], width: str.length * 6, height: 10 });

describe("snapToPdfText", () => {
    it("uses line context before a misleading nearby prior", () => {
        const items = [item("Subtotal", 10, 90), item("10.00", 90, 90), item("Milk", 10, 50), item("10.00", 90, 50)];
        const result = snapToPdfText("10", [0, 600, 150, 950], items, 140, 100, { rawText: "10.00", lineContext: "Milk 10.00", fieldType: "amount" });
        expect(result?.matchedText).toBe("10.00");
        expect(result?.box_2d[0]).toBeGreaterThan(300);
    });

    it("accepts text-confirmed matches even when the model prior is far away", () => {
        const result = snapToPdfText("29.12.2017", [900, 0, 980, 100], [item("29-12-2017", 50, 90)], 200, 100, { fieldType: "date" });
        expect(result?.status).toBe("exact");
    });
});
