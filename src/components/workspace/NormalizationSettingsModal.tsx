"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Check, Sliders, Calendar, Hash, Type, Sparkles, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    NormalizationSettings,
    DEFAULT_NORMALIZATION_SETTINGS,
    getStoredNormalizationSettings,
    saveNormalizationSettings
} from "@/lib/normalization";
import { toast } from "sonner";

interface NormalizationSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onApply?: (settings: NormalizationSettings) => void;
}

export function NormalizationSettingsModal({
    isOpen,
    onClose,
    onApply,
}: NormalizationSettingsModalProps) {
    const [settings, setSettings] = useState<NormalizationSettings>(DEFAULT_NORMALIZATION_SETTINGS);

    useEffect(() => {
        if (isOpen) {
            setSettings(getStoredNormalizationSettings());
        }
    }, [isOpen]);

    const handleSave = () => {
        saveNormalizationSettings(settings);
        onApply?.(settings);
        toast.success("Настройки нормализации сохранены");
        onClose();
    };

    const handleReset = () => {
        setSettings(DEFAULT_NORMALIZATION_SETTINGS);
        saveNormalizationSettings(DEFAULT_NORMALIZATION_SETTINGS);
        onApply?.(DEFAULT_NORMALIZATION_SETTINGS);
        toast.info("Сброшено к настройкам по умолчанию");
    };

    const addAiPromptChip = (chipText: string) => {
        setSettings(prev => ({
            ...prev,
            aiPrompt: prev.aiPrompt ? `${prev.aiPrompt.trim()}, ${chipText}` : chipText,
        }));
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    transition={{ type: "spring", duration: 0.3, bounce: 0 }}
                    className="w-full max-w-xl bg-card border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/20">
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                                <Sliders className="w-4 h-4" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-base text-foreground leading-tight">
                                    Настройки нормализации данных
                                </h3>
                                <p className="text-xs text-muted-foreground">
                                    Единые правила форматирования для таблицы, карточки проверки и экспорта
                                </p>
                            </div>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onClose}
                            className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                        >
                            <X className="w-4 h-4" />
                        </Button>
                    </div>

                    {/* Scrollable Body */}
                    <div className="p-6 space-y-6 overflow-y-auto flex-1 text-sm">
                        {/* 1. Date Format */}
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                <Calendar className="w-3.5 h-3.5 text-primary" />
                                <span>Формат дат</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2.5">
                                {[
                                    { id: 'DD.MM.YYYY', title: 'ДД.ММ.ГГГГ', example: '18.01.2018', desc: 'Европейский / СНГ' },
                                    { id: 'YYYY-MM-DD', title: 'ГГГГ-ММ-ДД', example: '2018-01-18', desc: 'ISO / Базы / 1С' },
                                    { id: 'MM/DD/YYYY', title: 'ММ/ДД/ГГГГ', example: '01/18/2018', desc: 'US / Global' },
                                    { id: 'raw', title: 'Как в чеке', example: '18/01/2018', desc: 'Без изменений (OCR)' },
                                ].map(opt => {
                                    const isSelected = settings.dateFormat === opt.id;
                                    return (
                                        <button
                                            key={opt.id}
                                            type="button"
                                            onClick={() => setSettings(s => ({ ...s, dateFormat: opt.id as any }))}
                                            className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${
                                                isSelected
                                                    ? 'border-primary bg-primary/10 ring-2 ring-primary/20 shadow-xs'
                                                    : 'border-border/60 hover:border-border hover:bg-muted/40'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between w-full mb-1">
                                                <span className="font-semibold text-xs text-foreground">{opt.title}</span>
                                                {isSelected && <Check className="w-3.5 h-3.5 text-primary" />}
                                            </div>
                                            <span className="font-mono text-xs font-bold text-foreground/90">{opt.example}</span>
                                            <span className="text-[10px] text-muted-foreground mt-0.5">{opt.desc}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* 2. Numbers & Currency */}
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                <Hash className="w-3.5 h-3.5 text-primary" />
                                <span>Числа, суммы и валюта</span>
                            </div>
                            <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-3.5">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="font-medium text-xs text-foreground">Разделитель дробной части</div>
                                        <div className="text-[11px] text-muted-foreground">Символ для копеек / центов</div>
                                    </div>
                                    <div className="flex items-center p-0.5 bg-background border rounded-lg">
                                        <button
                                            type="button"
                                            onClick={() => setSettings(s => ({ ...s, decimalSeparator: '.' }))}
                                            className={`px-3 py-1 text-xs font-mono rounded-md font-semibold transition-all ${
                                                settings.decimalSeparator === '.'
                                                    ? 'bg-primary text-primary-foreground shadow-xs'
                                                    : 'text-muted-foreground hover:text-foreground'
                                            }`}
                                        >
                                            . (Точка: 26.00)
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setSettings(s => ({ ...s, decimalSeparator: ',' }))}
                                            className={`px-3 py-1 text-xs font-mono rounded-md font-semibold transition-all ${
                                                settings.decimalSeparator === ','
                                                    ? 'bg-primary text-primary-foreground shadow-xs'
                                                    : 'text-muted-foreground hover:text-foreground'
                                            }`}
                                        >
                                            , (Запятая: 26,00)
                                        </button>
                                    </div>
                                </div>

                                <div className="pt-2 border-t border-border/50 flex items-center justify-between">
                                    <div>
                                        <div className="font-medium text-xs text-foreground">Очистка знаков валют</div>
                                        <div className="text-[11px] text-muted-foreground">Удалять RM, $, руб, € и оставлять только число</div>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={settings.stripCurrency}
                                            onChange={(e) => setSettings(s => ({ ...s, stripCurrency: e.target.checked }))}
                                            className="sr-only peer"
                                        />
                                        <div className="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                                    </label>
                                </div>
                            </div>
                        </div>

                        {/* 3. Text Case */}
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                <Type className="w-3.5 h-3.5 text-primary" />
                                <span>Регистр текста</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                {[
                                    { id: 'raw', title: 'Как в чеке', example: 'LION FILE 220*307' },
                                    { id: 'title', title: 'Title Case', example: 'Lion File 220*307' },
                                    { id: 'upper', title: 'UPPERCASE', example: 'LION FILE 220*307' },
                                    { id: 'lower', title: 'lowercase', example: 'lion file 220*307' },
                                ].map(opt => {
                                    const isSelected = settings.textCase === opt.id;
                                    return (
                                        <button
                                            key={opt.id}
                                            type="button"
                                            onClick={() => setSettings(s => ({ ...s, textCase: opt.id as any }))}
                                            className={`p-2.5 rounded-lg border text-left transition-all flex items-center justify-between ${
                                                isSelected
                                                    ? 'border-primary bg-primary/10 text-primary font-semibold shadow-xs'
                                                    : 'border-border/60 hover:border-border hover:bg-muted/40 text-muted-foreground'
                                            }`}
                                        >
                                            <div>
                                                <div className="text-xs text-foreground font-medium">{opt.title}</div>
                                                <div className="text-[10px] text-muted-foreground font-mono truncate">{opt.example}</div>
                                            </div>
                                            {isSelected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* 4. AI Natural Language Rules */}
                        <div className="space-y-2.5">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
                                    <Sparkles className="w-3.5 h-3.5" />
                                    <span>Инструкции для AI (Natural Language)</span>
                                </div>
                                <span className="text-[10px] text-muted-foreground">Нестандартные правила</span>
                            </div>
                            <textarea
                                value={settings.aiPrompt}
                                onChange={(e) => setSettings(s => ({ ...s, aiPrompt: e.target.value }))}
                                rows={3}
                                placeholder="Например: даты приводить к ДД.ММ.ГГГГ, названия брендов писать латиницей без кавычек, если валюта не указана считать рублями..."
                                className="w-full rounded-xl border border-input bg-background/50 p-3 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary leading-relaxed resize-none shadow-xs font-mono"
                            />
                            {/* Quick chip suggestions */}
                            <div className="flex flex-wrap gap-1.5 pt-0.5">
                                {[
                                    "Даты в ДД.ММ.ГГГГ",
                                    "Бренды латиницей без кавычек",
                                    "Убрать копейки если .00",
                                    "Только числовые суммы",
                                    "Если валюта не указана считать RUB"
                                ].map(chip => (
                                    <button
                                        key={chip}
                                        type="button"
                                        onClick={() => addAiPromptChip(chip)}
                                        className="text-[10px] px-2 py-0.5 rounded-full border border-primary/20 bg-primary/5 hover:bg-primary/10 text-primary transition-colors flex items-center gap-1"
                                    >
                                        <span>+</span>
                                        <span>{chip}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between px-6 py-3.5 border-t bg-muted/20">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={handleReset}
                            className="text-xs text-muted-foreground hover:text-foreground gap-1.5 h-8"
                        >
                            <RotateCcw className="w-3 h-3" />
                            <span>По умолчанию</span>
                        </Button>
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={onClose}
                                className="text-xs h-8"
                            >
                                Отмена
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                onClick={handleSave}
                                className="text-xs h-8 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs font-semibold gap-1.5"
                            >
                                <Check className="w-3.5 h-3.5" />
                                <span>Сохранить и применить</span>
                            </Button>
                        </div>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
