"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, ShieldCheck, Sparkles, Scan, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface DocumentScannerProps {
    fileName?: string;
    promptText?: string;
}

const STAGES = [
    {
        id: 1,
        title: "Инициализация AI Engine",
        detail: "Безопасное шифрованное соединение с Google Gemini Neural Engine...",
        progress: 18,
        icon: ShieldCheck,
    },
    {
        id: 2,
        title: "Синтез структуры документа",
        detail: "AI Architect: генерация схемы данных точно под ваш запрос...",
        progress: 45,
        icon: Sparkles,
    },
    {
        id: 3,
        title: "Spatial Vision & Аудит",
        detail: "Попиксельный анализ, извлечение значений и привязка 2D-координат...",
        progress: 78,
        icon: Scan,
    },
    {
        id: 4,
        title: "Финализация результатов",
        detail: "Нормализация финансовых данных и подготовка интерактивной таблицы...",
        progress: 92,
        icon: CheckCircle2,
    },
];

export function DocumentScanner({ fileName, promptText }: DocumentScannerProps) {
    const [currentStageIdx, setCurrentStageIdx] = useState(0);

    useEffect(() => {
        const timers = [
            setTimeout(() => setCurrentStageIdx(1), 2500),
            setTimeout(() => setCurrentStageIdx(2), 7000),
            setTimeout(() => setCurrentStageIdx(3), 20000),
        ];

        return () => timers.forEach(clearTimeout);
    }, []);

    const stage = STAGES[currentStageIdx];
    const StageIcon = stage.icon;

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.4, type: "spring", bounce: 0.3 }}
            className="w-full max-w-xl mx-auto mt-8 relative"
        >
            <Card className="overflow-hidden border-primary/20 bg-background/50 backdrop-blur-sm shadow-2xl relative">
                <CardContent className="p-8 pt-10 min-h-[420px] flex flex-col items-center justify-center space-y-7 relative z-10">

                    {/* Central Animated Radar / Scanner Icon */}
                    <div className="relative">
                        <motion.div
                            animate={{
                                scale: [1, 1.25, 1],
                                opacity: [0.4, 0.9, 0.4]
                            }}
                            transition={{
                                duration: 2.2,
                                repeat: Infinity,
                                ease: "easeInOut"
                            }}
                            className="absolute inset-0 bg-primary/30 blur-2xl rounded-full"
                        />
                        <div className="relative bg-background p-4 rounded-full border shadow-lg flex items-center justify-center">
                            <Loader2 className="w-12 h-12 text-primary animate-spin" />
                            <StageIcon className="w-5 h-5 text-primary absolute" />
                        </div>
                    </div>

                    {/* Stage Header */}
                    <div className="space-y-2 text-center max-w-md">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={stage.id}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -8 }}
                                transition={{ duration: 0.25 }}
                                className="space-y-1.5"
                            >
                                <h2 className="text-xl md:text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/60">
                                    {stage.title}
                                </h2>
                                <p className="text-xs md:text-sm text-muted-foreground min-h-[40px] flex items-center justify-center">
                                    {stage.detail}
                                </p>
                            </motion.div>
                        </AnimatePresence>

                        {fileName && (
                            <p className="text-[11px] font-mono text-muted-foreground/80 truncate max-w-xs mx-auto pt-1">
                                Документ: <span className="text-foreground font-semibold">{fileName}</span>
                            </p>
                        )}
                    </div>

                    {/* Progress Bar with Real Stage Percentage */}
                    <div className="w-full max-w-sm space-y-3">
                        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden relative">
                            <motion.div
                                className="h-full bg-primary"
                                initial={{ width: "10%" }}
                                animate={{ width: `${stage.progress}%` }}
                                transition={{
                                    duration: 1.2,
                                    ease: "easeOut",
                                }}
                            />
                        </div>

                        <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
                            <span className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                <span>Обработка {stage.progress}%</span>
                            </span>
                            <span className="font-semibold text-foreground/80">
                                Gemini Vision 2.5
                            </span>
                        </div>
                    </div>

                    {/* Step Timeline Indicator */}
                    <div className="grid grid-cols-4 gap-2 w-full max-w-sm pt-2">
                        {STAGES.map((s, idx) => {
                            const isPast = idx < currentStageIdx;
                            const isCurrent = idx === currentStageIdx;
                            return (
                                <div key={s.id} className="flex flex-col items-center gap-1">
                                    <div
                                        className={`h-1.5 w-full rounded-full transition-all duration-500 ${
                                            isPast
                                                ? "bg-primary"
                                                : isCurrent
                                                ? "bg-primary/60 animate-pulse"
                                                : "bg-muted"
                                        }`}
                                    />
                                    <span className="text-[10px] text-muted-foreground/70 font-mono">
                                        Шаг {s.id}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </CardContent>

                {/* Laser Scanning Line */}
                <motion.div
                    className="absolute inset-x-0 h-1 bg-primary/80 shadow-[0_0_15px_rgba(var(--primary),0.8)] z-20 pointer-events-none"
                    initial={{ top: "0%" }}
                    animate={{ top: "100%" }}
                    transition={{
                        duration: 2.5,
                        repeat: Infinity,
                        repeatType: "reverse",
                        ease: "linear",
                    }}
                />

                {/* Subtle background grid pattern */}
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:14px_24px] pointer-events-none opacity-20" />
            </Card>
        </motion.div>
    );
}
