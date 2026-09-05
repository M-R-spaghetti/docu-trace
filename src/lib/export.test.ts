import { describe, expect, it } from "vitest";
import { escapeCSVValue, escapeXml } from "./export";

describe("export escaping", () => {
    it.each(["=HYPERLINK(\"https://evil\")", "+cmd", "-2+3", "@SUM(A1:A2)", "\tformula", "\rformula"])(
        "neutralizes spreadsheet formula input %s",
        (value) => expect(escapeCSVValue(value)).toMatch(/^"?'/),
    );

    it("quotes delimiters and quotes", () => {
        expect(escapeCSVValue('a;"b"')).toBe('"a;""b"""');
    });

    it("removes forbidden XML controls and escapes all XML entities", () => {
        expect(escapeXml("\u0000<&>\"'")).toBe("&lt;&amp;&gt;&quot;&apos;");
    });
});
