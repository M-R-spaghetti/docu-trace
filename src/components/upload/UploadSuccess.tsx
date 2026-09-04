"use client";

import { motion } from "framer-motion";
import { FileText, CheckCircle2, ArrowRight, Layers, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatBytes } from "@/lib/utils";

interface UploadSuccessProps {
    file: File;
    prompt: string;
    onPromptChange: (val: string) => void;
    format: string;
    onFormatChange: (val: string) => void;
    onProceed: () => void;
    onReset: () => void;
    batchCount?: number;
    batchFiles?: { name: string; size: number }[];
}

export function UploadSuccess({
    file,
    prompt,
    onPromptChange,
    format,
    onFormatChange,
    onProceed,
    onReset,
    batchCount,
    batchFiles
}: UploadSuccessProps) {
    const isBatch = Boolean(batchCount && batchCount > 1);
    const totalBatchBytes = batchFiles?.reduce((acc, f) => acc + f.size, 0) || file.size;

    const quickTemplates = [
        {
            label: "📋 Ключевые данные (Авто)",
            text: "Извлеки все ключевые данные, реквизиты, даты, таблицы и списки из документа."
        },
        {
            label: "📑 Договор / Соглашение",
            text: "Извлеки стороны договора, предмет соглашения, ключевые условия, сроки действия, финансовые обязательства, штрафные санкции и подписи."
        },
        {
            label: "🧾 Таблицы / Позиции",
            text: "Извлеки исключительно таблицу позиций/строк: наименование, количество, цену и сумму. Без шапки и метаданных документа."
        },
        {
            label: "🏦 Банковская выписка",
            text: "Извлеки номер счета, период, начальный/конечный остаток и таблицу транзакций (дата, контрагент, назначение, сумма)."
        }
    ];

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3, type: "spring", bounce: 0.4 }}
            className="w-full max-w-xl mx-auto mt-8"
        >
            <Card className="overflow-hidden border-primary/20 bg-background/50 backdrop-blur-sm shadow-xl">
                <div className="h-2 w-full bg-primary/20">
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: "100%" }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className="h-full bg-primary"
                    />
                </div>
                <CardContent className="p-8 pt-10">
                    <div className="flex flex-col items-center text-center space-y-4">
                        <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ delay: 0.2, type: "spring" }}
                        >
                            <CheckCircle2 className="w-16 h-16 text-primary" />
                        </motion.div>

                        <div className="space-y-2">
                            <h2 className="text-2xl font-semibold tracking-tight">
                                {isBatch ? `Пакет документов готов (${batchCount} файлов)` : "Документ готов к анализу"}
                            </h2>
                            <p className="text-muted-foreground text-xs sm:text-sm">
                                {isBatch
                                    ? "Все файлы подготовлены. Напиши произвольный поисковый запрос или выбери шаблон."
                                    : "Документ загружен. Задай любой поисковый запрос или выбери шаблон данных."
                                }
                            </p>
                        </div>

                        <motion.div
                            initial={{ y: 10, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.3 }}
                            className="flex items-center gap-3 w-full bg-muted/50 p-4 rounded-xl border"
                        >
                            <div className="p-2 bg-background rounded-lg shadow-sm shrink-0">
                                {isBatch ? (
                                    <Layers className="w-6 h-6 text-primary" />
                                ) : (
                                    <FileText className="w-6 h-6 text-primary/80" />
                                )}
                            </div>
                            <div className="flex flex-col items-start overflow-hidden w-full text-left">
                                <span className="font-medium text-sm truncate max-w-[200px] md:max-w-xs">
                                    {isBatch ? `Пакет из ${batchCount} документов` : file.name}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    {isBatch ? "Многостраничный пакет документов" : (file.type || "Document")} • {formatBytes(totalBatchBytes)}
                                </span>
                            </div>
                        </motion.div>

                        <motion.div
                            initial={{ y: 10, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.4 }}
                            className="w-full text-left space-y-4"
                        >
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-semibold text-foreground/80 pl-1">
                                        Что именно нужно извлечь?
                                    </label>
                                    <span className="text-[11px] text-muted-foreground">Быстрый шаблон:</span>
                                </div>

                                {/* Quick prompt template buttons */}
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                    {quickTemplates.map((t, idx) => (
                                        <button
                                            key={idx}
                                            type="button"
                                            onClick={() => onPromptChange(t.text)}
                                            className="text-[11px] px-2.5 py-1 rounded-full bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 transition-colors"
                                        >
                                            {t.label}
                                        </button>
                                    ))}
                                </div>

                                <textarea
                                    className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y"
                                    placeholder="Например: Извлеки только таблицу позиций товаров с ценами и количеством, шапку и контакты магазина не извлекать..."
                                    value={prompt}
                                    onChange={(e) => onPromptChange(e.target.value)}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-foreground/80 pl-1 flex items-center gap-2">
                                    ⚙️ Формат вывода
                                </label>
                                <select
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    value={format}
                                    onChange={(e) => onFormatChange(e.target.value)}
                                >
                                    <option value="table">Строгая таблица данных (Чеки, Накладные)</option>
                                    <option value="auto">Авто (AI решает структуру сам)</option>
                                    <option value="report">Текстовый отчет (Договоры, Саммари)</option>
                                    <option value="hybrid">Гибрид (Сводка + Таблица)</option>
                                </select>
                            </div>
                        </motion.div>

                        <motion.div
                            initial={{ y: 10, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.5 }}
                            className="flex items-center gap-3 w-full mt-6"
                        >
                            <Button variant="outline" className="flex-1" onClick={onReset}>
                                Выбрать другие файлы
                            </Button>
                            <Button className="flex-1 gap-2 bg-primary hover:bg-primary/90" onClick={onProceed}>
                                <Sparkles className="w-4 h-4" />
                                {isBatch ? `Начать извлечение (${batchCount} файлов)` : "Начать извлечение"}
                            </Button>
                        </motion.div>
                    </div>
                </CardContent>
            </Card>
        </motion.div>
    );
}
