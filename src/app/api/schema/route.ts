import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

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

const ARCHITECT_PROMPT = `Ты — Senior Data Architect и эксперт по структурированию данных в mission-critical системах.

Твоя задача: проанализировать текстовый запрос пользователя и создать строгую и оптимальную структуру данных (JSON Schema), которая будет использоваться для извлечения информации из документов.

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

ИСКЛЮЧЕНИЕ:
Если пользователь запросил текстовый отчет (Report или Summary), поле 'markdown_text' должно быть обычной строкой (type: "string").

ПРАВИЛА СОСТАВЛЕНИЯ СХЕМЫ:
1. Иерархия: группируй поля логически (например, 'header_fields' для метаданных документа, 'items' для списков/таблиц).
2. Массивы: для табличных данных используй тип "array" с "items", где каждая колонка — leaf-объект {value, box_2d, page}.
3. Названия полей: на английском языке в snake_case.
4. Описания: к каждому полю добавь содержательное description на русском или английском.
5. Ответ строго валидный JSON Schema (draft-07 compatible). Никакого Markdown-текста вокруг!`;

export async function POST(req: NextRequest) {
    try {
        let userQuery = "Extract all important information, invoice numbers, line items, and totals.";
        let format = "auto";

        const contentType = req.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
            const body = await req.json().catch(() => ({}));
            userQuery = body.prompt || userQuery;
            format = body.format || format;
        } else if (contentType.includes("multipart/form-data")) {
            const formData = await req.formData().catch(() => null);
            if (formData) {
                userQuery = (formData.get("prompt") as string) || userQuery;
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
        const schemaResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash",
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

        const schema = JSON.parse(schemaText);
        return NextResponse.json({ schema }, { status: 200 });
    } catch (error: any) {
        console.error("Schema Generation Error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to generate schema." },
            { status: 500 }
        );
    }
}
