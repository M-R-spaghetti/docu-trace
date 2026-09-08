import { GoogleGenAI } from "@google/genai";

export interface GenerateFallbackOptions {
    deadline: number;
    label: string;
    perCallTimeoutMs?: number;
    allowLite?: boolean;
}

export const createRequestDeadline = (budgetMs = 55_000) => Date.now() + budgetMs;
export const remainingRequestTime = (deadline: number) => Math.max(0, deadline - Date.now());

export function getGeminiApiKeys(): string[] {
    const raw = process.env.GEMINI_API_KEY || "";
    return Array.from(new Set(
        raw.split(/[,\s;]+/).map(k => k.trim()).filter(Boolean)
    ));
}

let activeKeyIndex = 0;

export async function generateContentWithFallback(
    ai: any,
    requestConfig: any,
    options: GenerateFallbackOptions,
) {
    const keys = getGeminiApiKeys();
    const isMock = ai && !(ai instanceof GoogleGenAI) && (!ai.apiKey && !ai._apiKey);

    let clients: any[] = [];
    if (isMock || keys.length === 0) {
        clients = [ai];
    } else {
        clients = keys.map(k => new GoogleGenAI({ apiKey: k }));
    }

    const primaryModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const models = Array.from(new Set([
        primaryModel,
        "gemini-2.5-flash",
        "gemini-flash-latest",
    ]));
    let lastError: any = null;

    const numClients = clients.length;
    for (let clientAttempt = 0; clientAttempt < numClients; clientAttempt++) {
        const clientIdx = (activeKeyIndex + clientAttempt) % numClients;
        const currentClient = clients[clientIdx];

        for (const model of models) {
            const remaining = remainingRequestTime(options.deadline);
            if (remaining < 1_000) {
                throw Object.assign(new Error("Document processing exceeded its total time budget."), { status: 504 });
            }
            const timeout = Math.max(500, Math.min(options.perCallTimeoutMs ?? 22_000, remaining - 250));
            try {
                const clientTag = numClients > 1 ? ` [Key ${clientIdx + 1}/${numClients}]` : "";
                console.log(`[${options.label}]${clientTag} Requesting model ${model}; ${remaining}ms budget remains.`);
                const result = await currentClient.models.generateContent({
                    ...requestConfig,
                    model,
                    config: {
                        ...requestConfig.config,
                        httpOptions: {
                            ...requestConfig.config?.httpOptions,
                            timeout,
                        },
                    },
                });
                // Remember working key index for subsequent calls
                activeKeyIndex = clientIdx;
                return result;
            } catch (error: any) {
                lastError = error;
                const status = Number(error?.status ?? error?.error?.status ?? error?.error?.code ?? error?.code);
                const message = String(error?.message || "");
                const isQuotaError = status === 429 || /resource_exhausted|quota/i.test(message);
                const canFallback = [404, 408, 429, 500, 502, 503, 504].includes(status)
                    || /model.*not found|resource_exhausted|temporarily unavailable|timeout|timed out|deadline_exceeded/i.test(message);

                if (!canFallback || remainingRequestTime(options.deadline) < 1_000) throw error;

                if (isQuotaError && numClients > 1 && clientAttempt < numClients - 1) {
                    console.warn(`[${options.label}] Key ${clientIdx + 1}/${numClients} hit quota (429); rotating to next key...`);
                    // Switch to next client key
                    break;
                }

                console.warn(`[${options.label}] Model ${model} unavailable (${message || status}); trying fallback.`);
            }
        }
    }
    throw lastError;
}
