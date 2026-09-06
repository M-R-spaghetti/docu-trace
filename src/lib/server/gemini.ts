export interface GenerateFallbackOptions {
    deadline: number;
    label: string;
    perCallTimeoutMs?: number;
}

export const createRequestDeadline = (budgetMs = 55_000) => Date.now() + budgetMs;
export const remainingRequestTime = (deadline: number) => Math.max(0, deadline - Date.now());

export async function generateContentWithFallback(
    ai: any,
    requestConfig: any,
    options: GenerateFallbackOptions,
) {
    const models = Array.from(new Set([
        process.env.GEMINI_MODEL || "gemini-2.5-flash",
        "gemini-flash-latest",
        "gemini-flash-lite-latest",
    ]));
    let lastError: any = null;

    for (const model of models) {
        const remaining = remainingRequestTime(options.deadline);
        if (remaining < 1_000) {
            throw Object.assign(new Error("Document processing exceeded its total time budget."), { status: 504 });
        }
        const timeout = Math.max(500, Math.min(options.perCallTimeoutMs ?? 22_000, remaining - 250));
        try {
            console.log(`[${options.label}] Requesting model ${model}; ${remaining}ms budget remains.`);
            return await ai.models.generateContent({
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
        } catch (error: any) {
            lastError = error;
            const status = Number(error?.status ?? error?.error?.status ?? error?.error?.code ?? error?.code);
            const message = String(error?.message || "");
            const canFallback = [404, 429, 503].includes(status)
                || /model.*not found|resource_exhausted|temporarily unavailable|timeout/i.test(message);
            if (!canFallback || remainingRequestTime(options.deadline) < 1_000) throw error;
            console.warn(`[${options.label}] Model ${model} unavailable (${message || status}); trying fallback.`);
        }
    }
    throw lastError;
}
