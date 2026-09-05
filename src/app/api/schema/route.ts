import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { acquireApiRequest, validatePrompt } from "@/lib/server/requestGuard";

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
  "type": "object",
  "properties": {
    "value": { "type": "<string|number|boolean>", "description": "<что здесь хранится>" },
    "box_2d": {
      "type": "array",
      "items": { "type": "number" },
      "minItems": 4,
      "maxItems": 4,
      "description": "Координаты на изображении: [ymin, xmin, ymax, xmax] в диапазоне 0-1000"
    },
    "page": {
      "type": "number",
      "description": "Номер страницы документа, где найдено значение (начиная с 1)"
    }
  },
  "required": ["value", "box_2d", "page"]
}

ПРАВИЛА:
1. УНИВЕРСАЛЬНОСТЬ ПОД ЛЮБОЙ ТИП ДОКУМЕНТА:
   - Договоры / Соглашения: извлекай стороны (parties), предмет (subject), срок действия (duration), обязательства (liabilities), реквизиты, подписи.
   - Банковские выписки: извлекай номер счета, начальный/конечный остаток, дату, таблицу транзакций (дата, контрагент, назначение, сумма).
   - Чеки / Накладные: извлекай таблицу позиций, цены, суммы, если они запрошены.
   - Специфический поиск по промпту: например, "Найди только пункт о расторжении и штрафах" — извлекай ТОЛЬКО пункт о расторжении и штрафах.

2. СТРОГОЕ СЛЕДОВАНИЕ ЗАПРОСУ ПОЛЬЗОВАТЕЛЯ (НИКАКИХ ЛИШНИХ НЕЗАПРОШЕННЫХ ДАННЫХ):
   - Если пользователь просит найти конкретную информацию (например: "только таблица позиций без шапки", "только стороны договора", "только итоговая сумма", "только номер полиса") — создавай схему ИСКЛЮЧИТЕЛЬНО для этих данных!
   - КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО самовольно добавлять блоки вроде header_information, store_name, metadata, если пользователь этого не просил или прямо попросил не добавлять.

3. СТРОГИЙ СТАНДАРТ: Твоя схема должна быть чистым подмножеством OpenAPI 3.0 / JSON Schema, совместимым с Google Gemini API.
4. Иерархия: группируй поля логически, для списков используй массив с items.
5. Названия полей: на английском языке в snake_case.
6. Описания: к каждому полю добавь содержательное description на языке запроса пользователя.
7. Ответ строго валидный JSON Schema (draft-07 compatible). Никакого Markdown-текста вокруг!
8. ПРАВИЛО ЧЕТКОЙ СТРУКТУРЫ ДЛЯ ДОКУМЕНТОВ И ПАКЕТОВ:
   - Корневой объект ВСЕГДА должен иметь type: "object".
   - Поля верхнего уровня документа должны быть ТОЛЬКО скалярами (LocatedValue: строка, число, дата). Например: store_name, date, total_amount, receipt_number.
   - Если в документе есть список позиций (товары, услуги, строки накладной), разрешен МАКСИМУМ ОДИН массив верхнего уровня, и он ВСЕГДА должен называться 'items'.
   - Вложенность глубже одного уровня КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНА (внутри элементов 'items' могут быть только LocatedValue, никаких вложенных подмассивов).`;

async function generateContentWithModelFallback(ai: any, requestConfig: any) {
    const candidateModels = Array.from(new Set([
        process.env.GEMINI_MODEL || "gemini-2.5-flash",
        "gemini-flash-latest",
        "gemini-flash-lite-latest",
    ]));

    let lastError: any = null;
    for (const model of candidateModels) {
        try {
            console.log(`[Schema Engine] Requesting model: ${model}...`);
            return await ai.models.generateContent({
                ...requestConfig,
                model,
                config: {
                    ...requestConfig.config,
                    httpOptions: {
                        ...requestConfig.config?.httpOptions,
                        timeout: 18_000,
                    },
                },
            });
        } catch (err: any) {
            lastError = err;
            const status = Number(err?.status ?? err?.error?.status ?? err?.error?.code ?? err?.code);
            const message = String(err?.message || "");
            const canFallback = [404, 429, 503].includes(status)
                || /model.*not found|resource_exhausted|temporarily unavailable|timeout/i.test(message);
            if (!canFallback) throw err;
            console.warn(`[Schema Fallback] Model ${model} temporarily unavailable (${message || status}).`);
        }
    }
    throw lastError;
}

export async function POST(req: NextRequest) {
    const guard = acquireApiRequest(req, "schema");
    if (guard.response) return guard.response;
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

        let formatInstructions = "";
        if (format === "table") {
            formatInstructions = `\nОЖИДАЕМЫЙ ФОРМАТ: Пользователь запросил только таблицу (Strict Data). Твоя JSON Schema ОДНОЗНАЧНО должна описывать структуру для извлечения массивов и четких ключей. Каждое leaf-поле — объект {value, box_2d, page}.`;
        } else if (format === "report") {
            formatInstructions = `\nОЖИДАЕМЫЙ ФОРМАТ: Пользователь запросил текстовый отчет (Report). Твоя JSON Schema должна содержать поле 'markdown_text' (простая строка).`;
        } else if (format === "hybrid") {
            formatInstructions = `\nОЖИДАЕМЫЙ ФОРМАТ: Гибрид (Summary + Data). JSON Schema должна содержать поле 'markdown_text', а также массивы/объекты для извлечения данных с координатами {value, box_2d, page}.`;
        } else {
            formatInstructions = `\nОЖИДАЕМЫЙ ФОРМАТ: Авто (Auto). Самостоятельно реши оптимальную структуру.`;
        }

        const ai = getAI();
        const schemaResponse = await generateContentWithModelFallback(ai, {
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: ARCHITECT_PROMPT + formatInstructions + "\n\nВАЖНО: схема описывает РОВНО ОДИН документ. Корневой объект — 'object'. Поля уровня документа — только скаляры. Если есть позиции/товары — максимум один массив с именем 'items'. Вложенность глубже одного уровня запрещена. Не создавай массивов верхнего уровня для нескольких документов — пакетную обработку выполняет вызывающий код.\n\nЗАПРОС ПОЛЬЗОВАТЕЛЯ:\n" + userQuery }
                    ]
                }
            ],
            config: {
                responseMimeType: "application/json",
            }
        });

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
