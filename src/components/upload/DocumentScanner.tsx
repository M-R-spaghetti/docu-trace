"use client";

import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function DocumentScanner() {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.4, type: "spring", bounce: 0.3 }}
            className="w-full max-w-xl mx-auto mt-8 relative"
        >
            <Card className="overflow-hidden border-primary/20 bg-background/50 backdrop-blur-sm shadow-2xl relative">
                <CardContent className="p-8 pt-10 min-h-[400px] flex flex-col items-center justify-center space-y-8 relative z-10">

                    {/* Pulsing Central Icon */}
                    <div className="relative">
                        <motion.div
                            animate={{
                                scale: [1, 1.2, 1],
                                opacity: [0.5, 1, 0.5]
                            }}
                            transition={{
                                duration: 2,
                                repeat: Infinity,
                                ease: "easeInOut"
                            }}
                            className="absolute inset-0 bg-primary/30 blur-2xl rounded-full"
                        />
                        <div className="relative bg-background p-4 rounded-full border shadow-lg">
                            <Loader2 className="w-12 h-12 text-primary animate-spin" />
                        </div>
                    </div>

                    <div className="space-y-2 text-center">
                        <h2 className="text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/50">
                            Analyzing Document
                        </h2>
                        <p className="text-muted-foreground animate-pulse">
                            DocuTrace AI is extracting and verifying data...
                        </p>
                    </div>

                    <div className="w-full max-w-xs space-y-4">
                        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                            <motion.div
                                className="h-full bg-primary"
                                initial={{ width: "0%" }}
                                animate={{ width: "100%" }}
                                transition={{
                                    duration: 3,
                                    repeat: Infinity,
                                    ease: "easeInOut",
                                }}
                            />
                        </div>

                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Establishing secure connection...</span>
                            <span>Gemini 3.1 Pro</span>
                        </div>
                    </div>
                </CardContent>

                {/* Laser Scanning Line */}
                <motion.div
                    className="absolute inset-x-0 h-1 bg-primary/80 shadow-[0_0_15px_rgba(var(--primary),0.8)] z-20"
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
