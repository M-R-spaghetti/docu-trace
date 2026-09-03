import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

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
  "value": <извлечённое значение — строка или число>,
  "box_2d": [ymin, xmin, ymax, xmax],
  "page": <номер страницы, начиная с 1>
}

Где box_2d — это координаты прямоугольника на документе, нормализованные от 0 до 1000 (0 = верхний/левый край, 1000 = нижний/правый край).
Порядок координат: [ymin, xmin, ymax, xmax] — ИМЕННО В ТАКОМ ПОРЯДКЕ (сначала Y, потом X).

ПРИМЕР ПРАВИЛЬНОЙ СХЕМЫ для запроса "извлеки список товаров и итог":
{
  "type": "object",
  "properties": {
    "invoice_total": {
      "type": "object",
      "description": "Итоговая сумма документа с координатами расположения на документе",
      "properties": {
        "value": { "type": "string", "description": "Числовое значение итоговой суммы" },
        "box_2d": { "type": "array", "items": { "type": "number" }, "description": "Координаты [ymin, xmin, ymax, xmax] от 0 до 1000" },
        "page": { "type": "integer", "description": "Номер страницы (начиная с 1)" }
      },
      "required": ["value", "box_2d", "page"]
    },
    "items": {
      "type": "array",
      "description": "Список товаров/услуг",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "object",
            "properties": {
              "value": { "type": "string", "description": "Наименование товара" },
              "box_2d": { "type": "array", "items": { "type": "number" }, "description": "Координаты [ymin, xmin, ymax, xmax] от 0 до 1000" },
              "page": { "type": "integer", "description": "Номер страницы" }
            },
            "required": ["value", "box_2d", "page"]
          },
          "price": {
            "type": "object",
            "properties": {
              "value": { "type": "string", "description": "Цена товара" },
              "box_2d": { "type": "array", "items": { "type": "number" }, "description": "Координаты [ymin, xmin, ymax, xmax] от 0 до 1000" },
              "page": { "type": "integer", "description": "Номер страницы" }
            },
            "required": ["value", "box_2d", "page"]
          }
        }
      }
    }
  }
}

ПРАВИЛА:
1. АДАПТИВНОСТЬ: Внимательно изучи запрос. Если пользователь хочет извлекать списки — используй массивы объектов. Если это общая аналитика — используй одиночные объекты.
2. КАЖДОЕ конечное поле оборачивается в {value, box_2d, page}. Без исключений.
3. ДОКУМЕНТИРОВАНИЕ: Каждое поле должно содержать подробный description.
4. Поле markdown_text (если нужен текстовый отчёт) — это ЕДИНСТВЕННОЕ исключение. Оно остаётся простой строкой без box_2d, потому что отчёт генерируется ИИ, а не извлекается из конкретного места.

Выдавай ТОЛЬКО валидный JSON Schema, без каких-либо вводных слов, маркдаун-тегов или объяснений. Твой ответ пойдет напрямую в парсер.`;

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

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get("file") as File | null;
        const userQuery = formData.get("prompt") as string | null || "Extract all important information from this document.";
        const format = formData.get("format") as string | null || "auto";

        if (!file) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

        const buffer = await file.arrayBuffer();
        const base64Data = Buffer.from(buffer).toString("base64");
        const mimeType = file.type;
        const ai = getAI();

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

        // Step 1: Generate JSON Schema
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
            config: {}
        });

        let schemaText = schemaResponse.text || "{}";
        schemaText = schemaText.replace(/^\`\`\`json/m, "").replace(/^\`\`\`/m, "").trim();

        let generatedSchema;
        try {
            generatedSchema = JSON.parse(schemaText);
        } catch (e) {
            console.error("Architect generated invalid JSON:", schemaText);
            throw new Error("Architect failed to generate a valid JSON schema.");
        }

        console.log("Generated Schema:", JSON.stringify(generatedSchema, null, 2));

        // Step 2: Extract Data with spatial coordinates
        console.log("Step 2: Extractor extracting data with bounding boxes...");
        const extractTask = EXTRACTOR_PROMPT + "\n\nСХЕМА:\n" + JSON.stringify(generatedSchema, null, 2);

        const extractionResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash",
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

        const extractionText = extractionResponse.text || "{}";
        let extractionResult;
        try {
            extractionResult = JSON.parse(extractionText);
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
        return NextResponse.json(
            { error: error.message || "Failed to process document." },
            { status: 500 }
        );
    }
}
