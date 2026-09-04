import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

// Max duration for Vercel Serverless execution (up to 60s for Pro/Enterprise)
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const ALLOWED_MIME_TYPES = new Set([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp"
]);

// Configurable max payload limit in megabytes (defaults to Vercel's 4.5MB ceiling)
const MAX_PAYLOAD_BYTES = (Number(process.env.MAX_FILE_SIZE_MB) || 4.5) * 1024 * 1024;

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

const ARCHITECT_PROMPT = `Ты — Senior Data Architect и эксперт по интеллектуальному анализу документов ЛЮБЫХ типов (договоры, финансовые отчеты, банковские выписки, накладные, счета, чеки, техническая документация, медицинские карты, анкеты, паспорта).

Твоя задача: проанализировать текстовый запрос пользователя и создать строгую, лаконичную и релевантную структуру данных (JSON Schema) для извлечения информации.

КРИТИЧЕСКОЕ ПРАВИЛО КОРНЯ СХЕМЫ (ROOT OBJECT):
Корень схемы (root schema) ВСЕГДА ОБЯЗАН иметь "type": "object" со свойством "properties".
КОРЕНЬ НИКОГДА НЕ ДОЛЖЕН БЫТЬ "type": "array".
Если пользователь запрашивает список, таблицу, позиции, чеки, транзакции или массив записей, этот массив ДОЛЖЕН быть свойством корневого объекта (например, "items", "transactions", "records" и т.д.):
{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": { ... }
      }
    }
  },
  "required": ["items"]
}

КРИТИЧЕСКОЕ ПРАВИЛО ФОРМАТА ПОЛЕЙ:
Каждое конечное (leaf) поле, в которое будет записано извлечённое значение, ОБЯЗАНО быть объектом со следующей структурой:
{
  "value": <извлечённое значение — строка или число>,
  "box_2d": [ymin, xmin, ymax, xmax],
  "page": <номер страницы, начиная с 1>
}

Где box_2d — это координаты прямоугольника на документе, нормализованные от 0 до 1000 (0 = верхний/левый край, 1000 = нижний/правый край).
Порядок координат: [ymin, xmin, ymax, xmax] — ИМЕННО В ТАКОМ ПОРЯДКЕ (сначала Y, потом X).

ПРАВИЛА:
1. УНИВЕРСАЛЬНОСТЬ ПОД ЛЮБОЙ ТИП ДОКУМЕНТА:
   - Договоры / Соглашения: извлекай стороны (parties), предмет (subject), срок действия (duration), обязательства (liabilities), реквизиты, подписи.
   - Банковские выписки: извлекай номер счета, начальный/конечный остаток, дату, таблицу транзакций (дата, контрагент, назначение, сумма).
   - Чеки / Накладные: извлекай таблицу позиций, цены, суммы, если они запрошены.
   - Специфический поиск по промпту: например, "Найди только пункт о расторжении и штрафах" — извлекай ТОЛЬКО пункт о расторжении и штрафах.

2. СТРОГОЕ СЛЕДОВАНИЕ ЗАПРОСУ ПОЛЬЗОВАТЕЛЯ (НИКАКИХ ЛИШНИХ НЕЗАПРОШЕННЫХ ДАННЫХ):
   - Если пользователь просит найти конкретную информацию (например: "только таблица позиций без шапки", "только стороны договора", "только итоговая сумма", "только номер полиса") — создавай схему ИСКЛЮЧИТЕЛЬНО для этих данных!
   - КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО самовольно добавлять блоки вроде header_information, store_name, metadata, если пользователь этого не просил или прямо попросил не добавлять.

3. СТРОГИЙ СТАНДАРТ: Твоя схема должна быть чистым подмножеством OpenAPI 3.0 / JSON Schema, совместимым с Google Gemini API. Используй стандартные поля: "type", "properties", "items", "required", "description". НЕ используй $schema, $id, additionalProperties, title, pattern, anyOf, oneOf.
4. КАЖДОЕ конечное (leaf) поле оборачивается в {value, box_2d, page}. Без исключений.
5. ДОКУМЕНТИРОВАНИЕ: Каждое поле должно содержать подробный description на языке запроса пользователя.
6. Поле markdown_text (если запрошен текстовый отчёт) — это ЕДИНСТВЕННОЕ исключение. Оно остаётся простой строкой без box_2d.

Выдавай ТОЛЬКО валидный JSON Schema, без каких-либо вводных слов, маркдаун-тегов или объяснений. Твой ответ пойдет напрямую в парсер.`;

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

3. ПРОСТРАНСТВЕННЫЕ КООРДИНАТЫ (box_2d): Для каждого извлечённого значения ты ОБЯЗАН вернуть точные координаты прямоугольника, ограничивающего это значение на документе.
   - Формат: [ymin, xmin, ymax, xmax]
   - Диапазон: от 0 до 1000 (0 = верхний/левый край документа, 1000 = нижний/правый край)
   - Координаты должны ТОЧНО окружать именно то значение, которое ты извлекаешь, а не весь абзац или строку
   - Рамка должна быть максимально плотной (tight bounding box) вокруг текста/элемента

4. НОМЕР СТРАНИЦЫ (page): Для каждого значения укажи номер страницы документа, на которой оно находится. Нумерация начинается с 1. Для изображений (одна страница) — всегда page: 1.

5. ФОРМАТ ОТВЕТА: Каждое конечное поле — это объект:
   { "value": "<извлечённое значение>", "box_2d": [ymin, xmin, ymax, xmax], "page": 1 }

Фокусируйся на описаниях полей (descriptions) в JSON-структуре, чтобы точно понимать намерения создателя схемы.
Если ты понял задачу, приступай к аудиту и верни данные в безупречном JSON формате согласно схеме.`;

async function generateContentWithModelFallback(ai: any, requestConfig: any) {
    const candidateModels = [
        process.env.GEMINI_MODEL || "gemini-2.5-flash",
        "gemini-flash-latest",
        "gemini-3.1-flash-lite",
        "gemini-3.5-flash-lite",
    ];

    let lastError: any = null;
    for (const model of candidateModels) {
        try {
            console.log(`[Model Engine] Requesting model: ${model}...`);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Timeout after 30s for model ${model}`)), 30000)
            );
            const contentPromise = ai.models.generateContent({
                ...requestConfig,
                model,
            });
            return await Promise.race([contentPromise, timeoutPromise]);
        } catch (err: any) {
            lastError = err;
            const status = err?.status || err?.code;
            console.warn(`[Model Fallback] Model ${model} failed (${err?.message || status}), retrying next candidate...`);
            continue;
        }
    }
    throw lastError;
}

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get("file") as File | null;
        const userQuery = formData.get("prompt") as string | null || "Extract all important information from this document.";
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
        const ai = getAI();

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
            let formatInstructions = "";
            if (format === "table") {
                formatInstructions = `\nОЖИДАЕМЫЙ ФОРМАТ: Пользователь запросил только таблицу (Strict Data). Твоя JSON Schema ОДНОЗНАЧНО должна описывать структуру для извлечения массивов и четких ключей. Каждое leaf-поле — объект {value, box_2d, page}.`;
            } else if (format === "report") {
                formatInstructions = `\nОЖИДАЕМЫЙ ФОРМАТ: Пользователь запросил текстовый отчет (Report). Твоя JSON Schema должна содержать поле 'markdown_text' (простая строка) для структурированного ответа в формате Markdown. Это единственное поле, которое НЕ оборачивается в {value, box_2d, page}.`;
            } else if (format === "hybrid") {
                formatInstructions = `\nОЖИДАЕМЫЙ ФОРМАТ: Гибрид (Summary + Data). JSON Schema должна содержать поле 'markdown_text' (простая строка) для саммари, а также массивы/объекты для извлечения данных с координатами {value, box_2d, page}.`;
            } else {
                formatInstructions = `\nОЖИДАЕМЫЙ ФОРМАТ: Авто (Auto). Самостоятельно реши, что лучше: 'markdown_text' с отчетом, табличные массивы с координатами {value, box_2d, page}, или и то и другое.`;
            }

            console.log("Step 1: Architect generating schema for query:", userQuery, "format:", format);

            // Step 1: Generate JSON Schema with strict JSON mode and model fallback
            const schemaResponse = await generateContentWithModelFallback(ai, {
                contents: [
                    {
                        role: "user",
                        parts: [
                            { text: ARCHITECT_PROMPT + formatInstructions + "\n\nЗАПРОС ПОЛЬЗОВАТЕЛЯ:\n" + userQuery }
                        ]
                    }
                ],
                config: {
                    responseMimeType: "application/json",
                }
            });

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

        console.log("Schema used for extraction:", JSON.stringify(generatedSchema, null, 2));

        // Step 2: Extract Data with spatial coordinates and enforced schema
        console.log("Step 2: Extractor extracting data with bounding boxes...");
        const extractTask = EXTRACTOR_PROMPT + "\n\nСХЕМА:\n" + JSON.stringify(generatedSchema, null, 2);

        // Sanitize generated schema into strict OpenAPI 3.0 subset for Gemini responseSchema
        const sanitizedSchema = sanitizeForGeminiSchema(generatedSchema);

        let extractionText = "{}";
        try {
            const extractionResponse = await generateContentWithModelFallback(ai, {
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
            });
            extractionText = extractionResponse.text || "{}";
        } catch (schemaErr: any) {
            console.warn(
                "Enforced responseSchema call failed, falling back to prompt-guided JSON mode:",
                schemaErr?.message || schemaErr
            );
            // Resilient fallback without responseSchema
            const fallbackResponse = await generateContentWithModelFallback(ai, {
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
            });
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

        let status = 500;
        let retryAfter: number | null = null;
        const message = error.message || "Failed to process document.";

        // Attempt to extract status code (e.g. 429, 503)
        if (typeof error.status === 'number') {
            status = error.status;
        } else if (error.error && typeof error.error.code === 'number') {
            status = error.error.code;
        }

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
            { error: message, retryAfter: retryAfter || undefined },
            { status, headers }
        );
    }
}
