import { describe, expect, it } from "vitest";
import { compileMasterRows, type BatchJob } from "./orchestrator";

describe("compileMasterRows", () => {
    it("counts document totals without adding quantities or unit amounts", () => {
        const file = new File(["receipt"], "receipt.jpg", { type: "image/jpeg" });
        const job: BatchJob = {
            id: "receipt-1",
            filename: file.name,
            file,
            size: file.size,
            status: "done",
            data: {
                quantity: { value: 2 },
                amount_per_unit: { value: 50 },
                grand_total: { value: "100.00 USD" },
                items: [{ product: { value: "Coffee" }, price: { value: 50 } }],
            },
        };

        expect(compileMasterRows([job]).totalAmount).toBe(100);
    });
});
