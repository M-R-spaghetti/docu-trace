import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { ALLOWED_MIME_TYPES } from "@/lib/media";
import { getUploadLimits } from "@/lib/uploadLimits";
import { acquireApiRequest, safeHttpStatus } from "@/lib/server/requestGuard";
import { createRequestDeadline, generateContentWithFallback } from "@/lib/server/gemini";
import { getUserGemini, isQuotaError } from "@/lib/server/userGemini";

export const maxDuration = 30;
export const dynamic = "force-dynamic";
const MAX_FIELDS = 20;

const responseSchema = {
    type: "object",
    properties: {
        fields: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    box_2d: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
                    page: { type: "number" },
                },
                required: ["id", "box_2d", "page"],
            },
        },
    },
    required: ["fields"],
};

function validBox(value: unknown): boolean {
    return Array.isArray(value) && value.length === 4 && value.every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1000);
}

export async function POST(req: NextRequest) {
    const guard = acquireApiRequest(req, "grounding");
    if (guard.response) return guard.response;
    try {
        if (!req.headers.get("content-type")?.includes("multipart/form-data")) {
            return NextResponse.json({ error: "Expected multipart form data." }, { status: 415 });
        }
        const form = await req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) return NextResponse.json({ error: "Document file is required." }, { status: 400 });
        if (!ALLOWED_MIME_TYPES.has(file.type) || file.size > getUploadLimits().maxPreparedRequestBytes) {
            return NextResponse.json({ error: "Unsupported or oversized document." }, { status: 413 });
        }
        let fields: any[];
        try { fields = JSON.parse(String(form.get("fields") || "[]")); } catch { fields = []; }
        if (!Array.isArray(fields) || fields.length < 1 || fields.length > MAX_FIELDS) {
            return NextResponse.json({ error: `Provide 1–${MAX_FIELDS} approximate fields.` }, { status: 400 });
        }
        const safeFields = fields.map((field, index) => ({
            id: String(field?.id || index).slice(0, 80),
            raw_text: String(field?.raw_text || "").slice(0, 500),
            line_context: String(field?.line_context || "").slice(0, 1000),
            field_type: String(field?.field_type || "text").slice(0, 20),
            box_2d: validBox(field?.box_2d) ? field.box_2d : [0, 0, 1000, 1000],
            page: Number(field?.page) || 1,
        }));
        const data = Buffer.from(await file.arrayBuffer()).toString("base64");
        const userGemini = getUserGemini(req);
        const apiKey = process.env.GEMINI_API_KEY?.split(/[,\s;]+/).find(Boolean);
        if (!userGemini && !apiKey) throw Object.assign(new Error("GEMINI_API_KEY is not configured."), { status: 503 });
        const ai = userGemini?.ai || new GoogleGenAI({ apiKey: apiKey! });
        const prompt = `Ты выполняешь только визуальную локализацию уже известных цитат. Не извлекай и не исправляй значения.
Для каждого поля найди на документе raw_text, используя line_context для выбора среди повторов. Верни тот же id, page и плотную рамку символов [ymin,xmin,ymax,xmax] 0..1000.
Исходный box_2d — лишь приблизительная подсказка и не может победить текстовое совпадение.
Поля:\n${JSON.stringify(safeFields)}`;
        const result = await generateContentWithFallback(ai, {
            contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data, mimeType: file.type } }] }],
            config: { responseMimeType: "application/json", responseSchema },
        }, { deadline: createRequestDeadline(25_000), label: "Grounding Fallback", perCallTimeoutMs: 20_000, allowLite: false, model: userGemini?.model, useProvidedClient: Boolean(userGemini) });
        const parsed = JSON.parse(result.text || "{}");
        parsed.fields = Array.isArray(parsed.fields) ? parsed.fields.filter((field: any) => validBox(field?.box_2d)) : [];
        return NextResponse.json(parsed);
    } catch (error) {
        const quotaExhausted = isQuotaError(error);
        return NextResponse.json({
            error: quotaExhausted ? "Квота Gemini API закончилась. Подключите свой API-ключ." : error instanceof Error ? error.message : "Grounding failed.",
            code: quotaExhausted ? "QUOTA_EXHAUSTED" : (error as { code?: string })?.code,
            canUseOwnKey: quotaExhausted || undefined,
        }, { status: quotaExhausted ? 429 : safeHttpStatus(error) });
    } finally {
        guard.release();
    }
}
