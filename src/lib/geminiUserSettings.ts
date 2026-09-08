"use client";

export const QUOTA_EVENT = "docutrace:gemini-quota";
export const CREDENTIALS_EVENT = "docutrace:gemini-credentials-updated";
const SESSION_KEY = "docutrace_gemini_settings";
const LOCAL_KEY = "docutrace_gemini_settings_persistent";

export interface GeminiUserSettings { apiKey: string; model: string; persistent: boolean }

export function getGeminiUserSettings(): GeminiUserSettings | null {
    if (typeof window === "undefined") return null;
    for (const [storage, key, persistent] of [[sessionStorage, SESSION_KEY, false], [localStorage, LOCAL_KEY, true]] as const) {
        try {
            const parsed = JSON.parse(storage.getItem(key) || "null");
            if (parsed?.apiKey && parsed?.model) return { apiKey: parsed.apiKey, model: parsed.model, persistent };
        } catch { /* ignore damaged browser state */ }
    }
    return null;
}

export function saveGeminiUserSettings(settings: GeminiUserSettings) {
    const payload = JSON.stringify({ apiKey: settings.apiKey.trim(), model: settings.model.trim() });
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LOCAL_KEY);
    (settings.persistent ? localStorage : sessionStorage).setItem(settings.persistent ? LOCAL_KEY : SESSION_KEY, payload);
    window.dispatchEvent(new CustomEvent(CREDENTIALS_EVENT));
}

export function clearGeminiUserSettings() {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LOCAL_KEY);
}

export function geminiRequestHeaders(): Record<string, string> {
    const settings = getGeminiUserSettings();
    return settings ? { "x-docutrace-gemini-key": settings.apiKey, "x-docutrace-gemini-model": settings.model } : {};
}

export async function geminiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    for (const [name, value] of Object.entries(geminiRequestHeaders())) headers.set(name, value);
    const response = await fetch(input, { ...init, headers });
    if (response.status === 429) {
        response.clone().json().then(body => {
            if (body?.code === "QUOTA_EXHAUSTED") window.dispatchEvent(new CustomEvent(QUOTA_EVENT, { detail: body }));
        }).catch(() => {});
    }
    return response;
}
