import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { acquireApiRequest, safeHttpStatus, validatePrompt } from "@/lib/server/requestGuard";
import { ALLOWED_MIME_TYPES } from "@/lib/media";
import { getUploadLimits } from "@/lib/uploadLimits";
import { buildArchitectPrompt } from "@/lib/server/prompts";
import { addGroundingEvidence } from "@/lib/server/groundingSchema";
import { createRequestDeadline, generateContentWithFallback } from "@/lib/server/gemini";
import { getUserGemini, isQuotaError } from "@/lib/server/userGemini";

// Fluid Compute leaves enough room for long multimodal extraction responses.
export const maxDuration = 180;
export const dynamic = "force-dynamic";

// Keep the default below common serverless request-body limits. Self-hosted deployments may override it.
const MAX_PAYLOAD_BYTES = getUploadLimits().maxPreparedRequestBytes;

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

/**
 * Sanitizes an arbitrary JSON schema into a strict OpenAPI 3.0 schema
 * compatible with Gemini's responseSchema parameter.
 * Removes forbidden keywords ($schema, additionalProperties, pattern, etc.)
 * and ensures required properties exist.
 */
function sanitizeForGeminiSchema(schema: any, isRoot = true): any {
    if (!schema || typeof schema !== 'object') return schema;

    // Guard: if root schema is an array, wrap it into an object with "items" property
    if (isRoot && (schema.type === 'array' || (!schema.properties && schema.items))) {
        schema = {
            type: 'object',
            properties: {
                items: schema
            },
            required: ['items']
        };
    }

    if (Array.isArray(schema)) {
        return schema.map(s => sanitizeForGeminiSchema(s, false));
    }

    const clean: Record<string, any> = {};

    // 1. Determine & normalize type
    let type = schema.type;
    if (schema.properties && !type) {
        type = 'object';
    } else if (schema.items && !type) {
        type = 'array';
    }

    if (typeof type === 'string') {
        clean.type = type.toLowerCase();
    }

    // 2. Allowed metadata
    if (schema.description && typeof schema.description === 'string') {
        clean.description = schema.description;
    }
    if (schema.nullable === true) {
        clean.nullable = true;
    }
    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        clean.enum = schema.enum.map(String);
    }

    // 3. Properties for objects
    if (schema.properties && typeof schema.properties === 'object') {
        clean.properties = {};
        const validPropKeys = new Set<string>();
        for (const [propKey, propVal] of Object.entries(schema.properties)) {
            if (propVal && typeof propVal === 'object') {
                clean.properties[propKey] = sanitizeForGeminiSchema(propVal, false);
                validPropKeys.add(propKey);
            }
        }

        // 4. Required fields (must only reference existing properties)
        if (Array.isArray(schema.required) && schema.required.length > 0) {
            const validRequired = schema.required.filter(
                (r: any) => typeof r === 'string' && validPropKeys.has(r)
            );
            if (validRequired.length > 0) {
                clean.required = validRequired;
            }
        }
    }

    // 5. Items for arrays
    if (schema.items && typeof schema.items === 'object') {
        clean.items = sanitizeForGeminiSchema(schema.items, false);
    }

    return clean;
}

const EXTRACTOR_PROMPT = `Ты — элитный Forensic Data Auditor с возможностями пространственного зрения (spatial vision). Ты работаешь над проектом стоимостью в миллионы долларов, где от твоей точности зависят критические бизнес-решения.

Твоя задача: извлечь данные из предоставленного документа строго в соответствии с переданной JSON-структурой. Для КАЖДОГО поля ты ОБЯЗАН указать точные пространственные координаты на документе.

КРИТИЧЕСКИЕ ИНСТРУКЦИИ:

1. ЗАБЫТЬ ПРО ЛЕНЬ: Если схема требует извлечения списка, и в документе 100 элементов — извлеки все 100. Никаких сокращений.

2. НУЛЕВАЯ ТОЛЕРАНТНОСТЬ К ГАЛЛЮЦИНАЦИЯМ: Извлекай ТОЛЬКО факты, явно присутствующие в документе. Если информация отсутствует — верни null для всего объекта {value, box_2d, page}.

3. ПРОСТРАНСТВЕННЫЕ КООРДИНАТЫ (box_2d) — СТРОГИЕ ПРАВИЛА ГЕОМЕТРИИ:
   - Формат: [ymin, xmin, ymax, xmax] в масштабе 0..1000 относительно ПОЛНОГО исходного изображения.
   - СТРОЧНАЯ ИЗОЛЯЦИЯ: Рамка обязана охватывать ТОЛЬКО конкретную горизонтальную строку текста, на которой визуально напечатаны символы извлекаемого значения.
     КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО смещать рамку вверх или вниз на соседние строки (заголовки, разделители, имя оператора/кассира, колонтитулы, подписи).
     Горизонтальная средняя ось (ymin + ymax) / 2 обязана проходить ровно по середине высоты символов значения.
   - МНОГОСТРОЧНЫЕ ПОЗИЦИИ В ЧЕКАХ (КРИТИЧЕСКИ ВАЖНО):
     В кассовых чеках позиция товара часто занимает ДВЕ или ТРИ строки:
       * Строка 1: Наименование товара (например: "...CARD/GD INDAH")
       * Строка 2: Количество, цена за единицу и общая сумма (например: "1   10.00   10.00")
     КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО ставить рамку цены, количества или суммы на строку с наименованием товара!
     Для цены (price/unit_price/total) рамка ОБЯЗАНА охватывать ТОЛЬКО сами цифровые символы (например, "10.00") на той строке, где они физически напечатаны.
     Внутри рамки box_2d для числовых полей должны находиться строго цифры (0-9, ., ,), а не буквы названия товара!
   - ПЛОТНЫЙ КРОП: ymin — это верхний край букв/цифр, ymax — нижний базовый край (baseline). Не включай межстрочный интервал и пустое пространство.
   - ИЗОЛЯЦИЯ ОТ РАЗДЕЛИТЕЛЕЙ: Если значение расположено рядом с чертой (пунктир, подчеркивание, линия таблицы ---, ===), рамка должна окружать символы текста и НЕ захватывать саму черту разделителя.
   - ГОРИЗОНТАЛЬНЫЕ ГРАНИЦЫ: xmin — левый край первого символа, xmax — правый край последнего символа. Не захватывай статические метки (например: слова "Дата:", "Сумма:", "Total:"), если схема требует само значение.
   - КОНТЕКСТНАЯ ПРИВЯЗКА: При поиске коротких полей (дата, время, сумма, артикул, ИНН) ориентируйся на соседние символы в той же горизонтальной строке (например, дата рядом со временем, цена рядом с наименованием).

4. НОМЕР СТРАНИЦЫ (page): Для каждого значения укажи номер страницы документа, на которой оно находится. Нумерация начинается с 1. Для изображений (одна страница) — всегда page: 1.

5. ФОРМАТ ОТВЕТА: Каждое конечное поле — это объект:
   { "value": "<нормализованное значение>", "box_2d": [ymin, xmin, ymax, xmax], "page": 1,
     "raw_text": "<дословные символы документа>",
     "line_context": "<та же строка и 5–10 соседних слов>",
     "field_type": "date|amount|quantity|text|id" }

raw_text запрещено нормализовать или исправлять. line_context должен быть дословным и находиться на той же строке.

Фокусируйся на описаниях полей (descriptions) в JSON-структуре, чтобы точно понимать намерения создателя схемы.
Если ты понял задачу, приступай к аудиту и верни данные в безупречном JSON формате согласно схеме.`;

export async function POST(req: NextRequest) {
    const guard = acquireApiRequest(req, "extract");
    if (guard.response) return guard.response;
    // Leave a small margin for parsing and returning the response before the
    // platform terminates the function.
    const deadline = createRequestDeadline(170_000);
    try {
        const formData = await req.formData();
        const file = formData.get("file") as File | null;
        const userQuery = validatePrompt(formData.get("prompt")) || "Extract all important information from this document.";
        const format = formData.get("format") as string | null || "auto";

        if (!file) {
            return NextResponse.json({ error: "No document file provided." }, { status: 400 });
        }

        // Validate MIME type
        const mimeType = file.type || "application/octet-stream";
        const isAllowedMime = ALLOWED_MIME_TYPES.has(mimeType) ||
            (mimeType === "application/octet-stream" && file.name.toLowerCase().endsWith(".pdf"));

        if (!isAllowedMime) {
            return NextResponse.json(
                { error: `Unsupported document format (${mimeType}). Please upload a PDF or image (PNG, JPEG, WebP).` },
                { status: 415 }
            );
        }

        // Validate File Size against Serverless ceiling
        if (file.size > MAX_PAYLOAD_BYTES) {
            const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
            const limitMB = (MAX_PAYLOAD_BYTES / (1024 * 1024)).toFixed(1);
            return NextResponse.json(
                { error: `Document size (${sizeMB}MB) exceeds the maximum allowed payload limit of ${limitMB}MB. Please compress the file before uploading.` },
                { status: 413 }
            );
        }

        const buffer = await file.arrayBuffer();
        const base64Data = Buffer.from(buffer).toString("base64");
        const userGemini = getUserGemini(req);
        const ai = userGemini?.ai || getAI();
        const userOptions = userGemini ? { model: userGemini.model, useProvidedClient: true } : {};

        const providedSchemaRaw = formData.get("schema") as string | null;
        let generatedSchema: any = null;

        if (providedSchemaRaw) {
            try {
                generatedSchema = typeof providedSchemaRaw === 'string' ? JSON.parse(providedSchemaRaw) : providedSchemaRaw;
                console.log("Step 1 skipped: Reusing pre-compiled batch schema.");
            } catch (err) {
                console.warn("Failed to parse provided schema, falling back to Architect:", err);
                generatedSchema = null;
            }
        }

        if (!generatedSchema) {
            console.log("Step 1: Architect generating schema for query:", userQuery, "format:", format);

            // Step 1: Generate JSON Schema with strict JSON mode and model fallback
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
            }, { deadline, label: "Schema Engine", perCallTimeoutMs: 90_000, ...userOptions });

            let schemaText = schemaResponse.text || "{}";
            schemaText = schemaText.replace(/^\`\`\`json/m, "").replace(/^\`\`\`/m, "").trim();

            try {
                generatedSchema = JSON.parse(schemaText);
                if (generatedSchema && typeof generatedSchema === 'object' && (generatedSchema.type === 'array' || (!generatedSchema.properties && generatedSchema.items))) {
                    generatedSchema = {
                        type: 'object',
                        properties: {
                            items: generatedSchema
                        },
                        required: ['items']
                    };
                }
            } catch (e) {
                console.error("Architect generated invalid JSON:", schemaText);
                throw new Error("Architect failed to generate a valid JSON schema.");
            }
        }

        generatedSchema = addGroundingEvidence(generatedSchema);
        console.log("Schema used for extraction:", JSON.stringify(generatedSchema, null, 2));

        // Step 2: Extract Data with spatial coordinates and enforced schema
        console.log("Step 2: Extractor extracting data with bounding boxes...");
        const extractTask = EXTRACTOR_PROMPT + "\n\nСХЕМА:\n" + JSON.stringify(generatedSchema, null, 2);

        // Sanitize generated schema into strict OpenAPI 3.0 subset for Gemini responseSchema
        const sanitizedSchema = sanitizeForGeminiSchema(generatedSchema);

        let extractionText = "{}";
        try {
            const extractionResponse = await generateContentWithFallback(ai, {
                contents: [
                    {
                        role: "user",
                        parts: [
                            { text: extractTask },
                            {
                                inlineData: {
                                    data: base64Data,
                                    mimeType: mimeType,
                                }
                            }
                        ]
                    }
                ],
                config: {
                    responseMimeType: "application/json",
                    responseSchema: sanitizedSchema,
                }
            }, { deadline, label: "Extraction Engine", ...userOptions });
            extractionText = extractionResponse.text || "{}";
        } catch (schemaErr: any) {
            const status = Number(schemaErr?.status ?? schemaErr?.error?.status ?? schemaErr?.error?.code);
            const message = String(schemaErr?.message || "");
            const isSchemaCompatibilityError = status === 400 || status === 422
                || /response.?schema|invalid.*schema|schema.*invalid/i.test(message);
            // A second request is useful only when Gemini rejected the response
            // schema. Retrying timeouts and upstream outages doubles cost without
            // giving the next call enough time to finish.
            if (!isSchemaCompatibilityError) throw schemaErr;
            console.warn(
                "Enforced responseSchema call failed, falling back to prompt-guided JSON mode:",
                schemaErr?.message || schemaErr
            );
            // Resilient fallback without responseSchema
            const fallbackResponse = await generateContentWithFallback(ai, {
                contents: [
                    {
                        role: "user",
                        parts: [
                            { text: extractTask },
                            {
                                inlineData: {
                                    data: base64Data,
                                    mimeType: mimeType,
                                }
                            }
                        ]
                    }
                ],
                config: {
                    responseMimeType: "application/json",
                }
            }, { deadline, label: "Extraction Recovery", ...userOptions });
            extractionText = fallbackResponse.text || "{}";
        }

        let extractionResult;
        try {
            extractionResult = JSON.parse(extractionText);
            if (Array.isArray(extractionResult)) {
                extractionResult = { items: extractionResult };
            } else if (extractionResult && typeof extractionResult === 'object') {
                const keys = Object.keys(extractionResult);
                if (keys.length > 0 && keys.every(k => !isNaN(Number(k)))) {
                    extractionResult = { items: Object.values(extractionResult) };
                }
            }
        } catch (e) {
            console.error("Extractor generated invalid JSON:", extractionText);
            throw new Error("Extractor failed to generate valid JSON data.");
        }

        return NextResponse.json({
            schema: generatedSchema,
            data: extractionResult
        }, { status: 200 });
    } catch (error: any) {
        console.error("Extraction Pipeline Error:", error);

        const quotaExhausted = isQuotaError(error);
        const status = quotaExhausted ? 429 : safeHttpStatus(error);
        let retryAfter: number | null = null;
        const message = quotaExhausted
            ? "Квота Gemini API закончилась. Подключите свой API-ключ, чтобы продолжить обработку."
            : error.message || "Failed to process document.";

        // Try to extract retryDelay from Google RPC details or message
        const details = error?.error?.details || error?.details;
        if (Array.isArray(details)) {
            const retryInfo = details.find((d: any) => d['@type']?.includes('RetryInfo') || d.retryDelay);
            if (retryInfo?.retryDelay) {
                const parsedSeconds = parseInt(String(retryInfo.retryDelay).replace(/[^\d]/g, ''), 10);
                if (!isNaN(parsedSeconds) && parsedSeconds > 0) {
                    retryAfter = parsedSeconds;
                }
            }
        }

        if (!retryAfter && typeof message === 'string') {
            const match = message.match(/retry in ([\d\.]+)s/i);
            if (match && match[1]) {
                retryAfter = Math.ceil(parseFloat(match[1]));
            }
        }

        const headers: Record<string, string> = {};
        if (retryAfter) {
            headers["Retry-After"] = String(retryAfter);
        }

        return NextResponse.json(
            { error: message, code: quotaExhausted ? "QUOTA_EXHAUSTED" : error?.code, canUseOwnKey: quotaExhausted || undefined, retryAfter: retryAfter || undefined },
            { status, headers }
        );
    } finally {
        guard.release();
    }
}
