import { describe, expect, it } from "vitest";
import { compileBatchExportData, escapeCSVValue, escapeXml } from "./export";
import type { DocRow } from "./batchTypes";

describe("export escaping", () => {
    it.each(["=HYPERLINK(\"https://evil\")", "+cmd", "-2+3", "@SUM(A1:A2)", "\tformula", "\rformula"])(
        "neutralizes spreadsheet formula input %s",
        (value) => expect(escapeCSVValue(value)).toMatch(/^"?'/),
    );

    it("quotes delimiters and quotes", () => {
        expect(escapeCSVValue('a;"b"')).toBe('"a;""b"""');
    });

    it("keeps ordinary negative numbers numeric", () => {
        expect(escapeCSVValue("-150.00")).toBe("-150.00");
        expect(escapeCSVValue("-150,00")).toBe('"-150,00"');
        expect(escapeCSVValue("-150,00")).not.toContain("'");
    });

    it("removes forbidden XML controls and escapes all XML entities", () => {
        expect(escapeXml("\u0000<&>\"'")).toBe("&lt;&amp;&gt;&quot;&apos;");
    });
});

describe("batch audit export", () => {
    it("exports the strongest audit and human-review states", () => {
        const file = new File(["receipt"], "receipt.jpg", { type: "image/jpeg" });
        const doc: DocRow = {
            fileId: "receipt-1",
            fileName: "receipt.jpg",
            file,
            status: "done",
            data: {
                items: [{
                    name: { value: "Coffee", box_2d: [1, 2, 3, 4] },
                    price: { value: "-150.00", originalValue: "150.00", box_2d: [5, 6, 7, 8] },
                }],
            },
            reviews: {
                "items[0].name": { auto: "warn", reasons: ["unclear"], human: "confirmed", reviewedAt: 100 },
                "items[0].price": { auto: "error", reasons: ["invalid total"], human: "corrected", reviewedAt: 200 },
            },
        };

        const { headers, dataRows } = compileBatchExportData([doc]);
        const row = dataRows[0];
        expect(row[headers.indexOf("Audit: Auto-Check")]).toBe("Ошибка");
        expect(row[headers.indexOf("Audit: Human Review")]).toBe("Исправлено");
        expect(row[headers.indexOf("Audit: Reasons")]).toContain("invalid total");
        expect(row[headers.indexOf("Audit: Original Values")]).toContain("price: 150.00");
    });
});
