import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { acquireApiRequest, validatePrompt } from "@/lib/server/requestGuard";
import { buildArchitectPrompt } from "@/lib/server/prompts";
import { createRequestDeadline, generateContentWithFallback } from "@/lib/server/gemini";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

let _ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
    if (!_ai) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error(
                "GEMINI_API_KEY is missing from .env.local. " +
                "Please create a .env.local file with: GEMINI_API_KEY=your_key_here"
            );
        }
        _ai = new GoogleGenAI({ apiKey });
    }
    return _ai;
}

export async function POST(req: NextRequest) {
    const guard = acquireApiRequest(req, "schema");
    if (guard.response) return guard.response;
    const deadline = createRequestDeadline(25_000);
    try {
        let userQuery = "Extract all important information, invoice numbers, line items, and totals.";
        let format = "auto";

        const contentType = req.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
            const body = await req.json().catch(() => ({}));
            userQuery = validatePrompt(body.prompt) || userQuery;
            format = body.format || format;
        } else if (contentType.includes("multipart/form-data")) {
            const formData = await req.formData().catch(() => null);
            if (formData) {
                userQuery = validatePrompt(formData.get("prompt")) || userQuery;
                format = (formData.get("format") as string) || format;
            }
        }

        const ai = getAI();
        const schemaResponse = await generateContentWithFallback(ai, {
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: buildArchitectPrompt(userQuery, format) }
                    ]
                }
            ],
            config: {
                responseMimeType: "application/json",
            }
        }, { deadline, label: "Schema Engine", perCallTimeoutMs: 18_000 });

        let schemaText = schemaResponse.text || "{}";
        schemaText = schemaText.replace(/^\`\`\`json/m, "").replace(/^\`\`\`/m, "").trim();

        let schema = JSON.parse(schemaText);
        if (schema && typeof schema === 'object' && (schema.type === 'array' || (!schema.properties && schema.items))) {
            schema = {
                type: 'object',
                properties: {
                    items: schema
                },
                required: ['items']
            };
        }
        return NextResponse.json({ schema }, { status: 200 });
    } catch (error: any) {
        console.error("Schema Generation Error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to generate schema." },
            { status: typeof error?.status === "number" && error.status >= 400 && error.status <= 599 ? error.status : 500 }
        );
    } finally {
        guard.release();
    }
}
