import { GoogleGenAI } from "@google/genai";
import type { NextRequest } from "next/server";

const KEY_HEADER = "x-docutrace-gemini-key";
const MODEL_HEADER = "x-docutrace-gemini-model";

export function getUserGemini(req: NextRequest): { ai: GoogleGenAI; model: string; isUserProvided: true } | null {
    const apiKey = req.headers.get(KEY_HEADER)?.trim() || "";
    const model = req.headers.get(MODEL_HEADER)?.trim() || "";
    if (!apiKey && !model) return null;
    if (apiKey.length < 20 || apiKey.length > 200 || !/^[A-Za-z0-9_-]+$/.test(apiKey)) {
        throw Object.assign(new Error("Пользовательский Gemini API-ключ имеет неверный формат."), { status: 400, code: "INVALID_USER_KEY" });
    }
    if (!/^gemini-[a-z0-9._-]{2,70}$/i.test(model)) {
        throw Object.assign(new Error("Укажите корректное имя модели Gemini."), { status: 400, code: "INVALID_USER_MODEL" });
    }
    return { ai: new GoogleGenAI({ apiKey }), model, isUserProvided: true };
}

export function isQuotaError(error: unknown): boolean {
    const value = error as { status?: unknown; code?: unknown; message?: unknown; error?: { status?: unknown; code?: unknown } };
    const status = Number(value?.status ?? value?.error?.status ?? value?.error?.code ?? value?.code);
    return status === 429 || /resource_exhausted|quota exceeded|quota exhausted/i.test(String(value?.message || ""));
}
