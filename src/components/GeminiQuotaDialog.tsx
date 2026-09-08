"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Eye, EyeOff, KeyRound, ShieldCheck, Sparkles, X } from "lucide-react";
import { clearGeminiUserSettings, getGeminiUserSettings, QUOTA_EVENT, saveGeminiUserSettings } from "@/lib/geminiUserSettings";

const DEFAULT_MODEL = "gemini-3.5-flash";

export function GeminiQuotaDialog() {
    const [open, setOpen] = useState(false);
    const [quotaMode, setQuotaMode] = useState(true);
    const [personalQuota, setPersonalQuota] = useState(false);
    const [apiKey, setApiKey] = useState("");
    const [model, setModel] = useState(DEFAULT_MODEL);
    const [persistent, setPersistent] = useState(false);
    const [showKey, setShowKey] = useState(false);
    const [error, setError] = useState("");
    const keyInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const show = (event: Event) => {
            const existing = getGeminiUserSettings();
            if (existing) { setApiKey(existing.apiKey); setModel(existing.model); setPersistent(existing.persistent); }
            const isQuota = Boolean((event as CustomEvent).detail?.quota);
            setQuotaMode(isQuota);
            setPersonalQuota(isQuota && Boolean(existing));
            setError(""); setOpen(true);
            requestAnimationFrame(() => keyInputRef.current?.focus());
        };
        const quota = () => show(new CustomEvent("open", { detail: { quota: true } }));
        window.addEventListener(QUOTA_EVENT, quota);
        window.addEventListener("docutrace:open-gemini-settings", show);
        return () => { window.removeEventListener(QUOTA_EVENT, quota); window.removeEventListener("docutrace:open-gemini-settings", show); };
    }, []);

    useEffect(() => {
        if (!open) return;
        const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
        window.addEventListener("keydown", escape);
        return () => window.removeEventListener("keydown", escape);
    }, [open]);

    if (!open) return null;
    const save = () => {
        const cleanKey = apiKey.trim();
        const cleanModel = model.trim();
        if (cleanKey.length < 20) { setError("Проверьте API-ключ: он выглядит слишком коротким."); return; }
        if (!/^gemini-[a-z0-9._-]+$/i.test(cleanModel)) { setError("Имя модели должно начинаться с gemini-."); return; }
        saveGeminiUserSettings({ apiKey: cleanKey, model: cleanModel, persistent });
        setOpen(false);
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
            <section role="dialog" aria-modal="true" aria-labelledby="gemini-dialog-title" className="w-full max-w-lg overflow-hidden rounded-2xl border border-border/70 bg-card text-card-foreground shadow-2xl">
                <div className="relative border-b border-border/60 bg-gradient-to-br from-amber-500/15 via-card to-emerald-500/10 p-6">
                    <button type="button" onClick={() => setOpen(false)} className="absolute right-4 top-4 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Закрыть"><X className="h-4 w-4" /></button>
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/25">
                        {quotaMode ? <AlertTriangle className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
                    </div>
                    <h2 id="gemini-dialog-title" className="text-xl font-bold">{quotaMode ? (personalQuota ? "Квота вашего ключа закончилась" : "Квота обработки закончилась") : "Свой Gemini API"}</h2>
                    <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                        {quotaMode
                            ? (personalQuota
                                ? "Gemini отклонил запрос из-за лимита личного ключа. Выберите другую доступную модель или подключите другой ключ."
                                : "Общая квота DocuTrace временно исчерпана. Подключите личный Gemini API-ключ и продолжайте работу без ожидания.")
                            : "Используйте собственный ключ и выбранную модель для обработки документов."}
                    </p>
                </div>
                <div className="space-y-5 p-6">
                    <label className="block space-y-2">
                        <span className="text-sm font-semibold">Gemini API-ключ</span>
                        <div className="relative">
                            <input ref={keyInputRef} type={showKey ? "text" : "password"} value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="AIza…" autoComplete="off" spellCheck={false} className="h-11 w-full rounded-xl border border-input bg-background px-3 pr-11 font-mono text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/25" />
                            <button type="button" onClick={() => setShowKey(value => !value)} className="absolute right-1.5 top-1.5 rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label={showKey ? "Скрыть ключ" : "Показать ключ"}>{showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                        </div>
                    </label>
                    <label className="block space-y-2">
                        <span className="text-sm font-semibold">Модель</span>
                        <input value={model} onChange={event => setModel(event.target.value)} list="gemini-models" className="h-11 w-full rounded-xl border border-input bg-background px-3 font-mono text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/25" />
                        <datalist id="gemini-models"><option value="gemini-3.5-flash" /><option value="gemini-3.5-flash-lite" /><option value="gemini-3.8-flash" /><option value="gemini-3-flash-preview" /><option value="gemini-2.5-flash" /><option value="gemini-flash-lite-latest" /></datalist>
                        <p className="text-xs text-muted-foreground">Flash — оптимальный баланс цены и точности. Можно указать другое доступное вам имя Gemini-модели.</p>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/60 bg-muted/30 p-3">
                        <input type="checkbox" checked={persistent} onChange={event => setPersistent(event.target.checked)} className="mt-0.5 h-4 w-4 accent-emerald-500" />
                        <span><span className="block text-sm font-medium">Запомнить на этом устройстве</span><span className="mt-0.5 block text-xs text-muted-foreground">Без этой опции ключ удалится после закрытия вкладки. Не включайте её на чужом компьютере.</span></span>
                    </label>
                    <div className="flex gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/8 p-3 text-xs leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /><span>Ключ не записывается в историю документов и базу сервера. Он передаётся через DocuTrace только в Gemini для ваших запросов.</span></div>
                    {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                        <button type="button" onClick={() => { clearGeminiUserSettings(); setApiKey(""); setPersistent(false); }} className="rounded-xl px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">Удалить сохранённый ключ</button>
                        <button type="button" onClick={save} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-500"><Sparkles className="h-4 w-4" />{quotaMode ? "Подключить ключ" : "Сохранить"}</button>
                    </div>
                    {quotaMode && <p className="text-center text-xs text-muted-foreground">Текущую операцию при необходимости запустите ещё раз. Пакетная обработка продолжит повторные попытки автоматически.</p>}
                </div>
            </section>
        </div>
    );
}
