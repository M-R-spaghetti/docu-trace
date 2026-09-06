"use client";

import { useState } from "react";
import { ChevronDown, Crosshair, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function WorkspaceAssistant({ busy, onRefine }: {
    busy?: boolean;
    onRefine: (prompt: string) => Promise<void>;
}) {
    const [open, setOpen] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");
    const disabled = busy || pending;
    async function submit(value: string) {
        if (!value.trim() || disabled) return;
        setPending(true);
        setError("");
        try {
            await onRefine(value.trim());
            setPrompt("");
        } catch {
            setError("Не удалось обработать запрос. Текст сохранён — попробуйте ещё раз.");
        } finally {
            setPending(false);
        }
    }
    return <section className="shrink-0 border-t bg-card">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
            className="flex w-full items-center justify-between gap-3 p-4 text-sm font-medium hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring">
            <span className="flex items-center gap-2"><Sparkles size={16} />Помощник по документам</span>
            <ChevronDown size={16} className={open ? "rotate-180" : ""} />
        </button>
        {open && <div className="space-y-3 px-4 pb-4">
            <form onSubmit={event => { event.preventDefault(); void submit(prompt); }} className="space-y-2">
                <label htmlFor="workspace-ai-prompt" className="text-xs text-muted-foreground">Что нужно уточнить или исправить?</label>
                <textarea id="workspace-ai-prompt" value={prompt} onChange={event => setPrompt(event.target.value)}
                    disabled={disabled} rows={3} placeholder="Например: уточни название поставщика"
                    className="w-full resize-y rounded-lg border bg-background p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring" />
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <Button type="button" variant="ghost" disabled={disabled} onClick={() => void submit("Повторно найди все уже извлечённые значения на исходном документе и исправь их точные координаты box_2d. Сохрани структуру и значения данных без изменений.")}>
                        <Crosshair size={16} />Уточнить подсветку
                    </Button>
                    <Button type="submit" disabled={disabled || !prompt.trim()}>{disabled && <Loader2 className="animate-spin" size={16} />}{disabled ? "Обрабатываю…" : "Отправить"}</Button>
                </div>
            </form>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>}
    </section>;
}
