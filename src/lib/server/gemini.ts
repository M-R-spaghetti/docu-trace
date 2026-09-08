import { GoogleGenAI } from "@google/genai";

export interface GenerateFallbackOptions {
    deadline: number;
    label: string;
    perCallTimeoutMs?: number;
    allowLite?: boolean;
    model?: string;
    useProvidedClient?: boolean;
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
    if (options.useProvidedClient || isMock || keys.length === 0) {
        clients = [ai];
    } else {
        clients = keys.map(k => new GoogleGenAI({ apiKey: k }));
    }

    const primaryModel = options.model || process.env.GEMINI_MODEL || "gemini-3.5-flash";
    // Keep the normal path to one model call. A single proven fallback is used
    // only for errors where changing model can actually help.
    const models = (options.useProvidedClient && options.model) ? [options.model] : Array.from(new Set([
        primaryModel,
        "gemini-2.5-flash",
    ]));
    let lastError: any = null;

    const numClients = clients.length;
    for (const model of models) {
        let modelUnavailable = false;
        for (let clientAttempt = 0; clientAttempt < numClients; clientAttempt++) {
            const clientIdx = (activeKeyIndex + clientAttempt) % numClients;
            const currentClient = clients[clientIdx];

            const remaining = remainingRequestTime(options.deadline);
            if (remaining < 1_000) {
                throw Object.assign(new Error("Document processing exceeded its total time budget."), { status: 504 });
            }
            const timeout = Math.max(500, Math.min(options.perCallTimeoutMs ?? 150_000, remaining - 500));
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
                const isModelNotFound = status === 404 || /model.*not found/i.test(message);
                const isTimeout = [408, 504].includes(status)
                    || /timeout|timed out|deadline_exceeded/i.test(message);
                const canFallback = [404, 429, 500, 502, 503].includes(status)
                    || /model.*not found|resource_exhausted|temporarily unavailable/i.test(message);

                // A timeout means the model needed more time. Starting another
                // model at this point only creates another paid invocation and
                // usually runs into the same request deadline.
                if (isTimeout || !canFallback || remainingRequestTime(options.deadline) < 1_000) throw error;

                if (isModelNotFound) {
                    console.warn(`[${options.label}] Model ${model} not supported (404); skipping to next model candidate...`);
                    modelUnavailable = true;
                    break;
                }

                if (isQuotaError && numClients > 1) {
                    console.warn(`[${options.label}] Key ${clientIdx + 1}/${numClients} hit quota on ${model}; rotating to next key...`);
                    continue;
                }

                console.warn(`[${options.label}] Model ${model} unavailable on Key ${clientIdx + 1} (${message || status}); trying next candidate...`);
            }
        }
        if (!modelUnavailable) {
            console.warn(`[${options.label}] All keys exhausted for model ${model}; falling back to next candidate model...`);
        }
    }
    throw lastError;
}
