import { describe, expect, it } from "vitest";
import { addGroundingEvidence } from "./groundingSchema";

describe("addGroundingEvidence", () => {
    it("augments nested LocatedValue leaves without changing ordinary objects", () => {
        const result = addGroundingEvidence({
            type: "object",
            properties: { date: { type: "object", properties: { value: { type: "string" }, box_2d: { type: "array" }, page: { type: "number" } }, required: ["value"] } },
        }) as any;
        expect(result.properties.date.required).toEqual(expect.arrayContaining(["raw_text", "line_context", "field_type"]));
        expect(result.properties.date.properties.field_type.enum).toContain("date");
        expect(result.properties.raw_text).toBeUndefined();
    });
});
