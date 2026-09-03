"use client";

import { motion } from "framer-motion";
import { FileText, CheckCircle2, ArrowRight } from "lucide-react";
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
}

export function UploadSuccess({ file, prompt, onPromptChange, format, onFormatChange, onProceed, onReset }: UploadSuccessProps) {
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
                            <h2 className="text-2xl font-semibold tracking-tight">Document Ready</h2>
                            <p className="text-muted-foreground">
                                Your file has been securely uploaded and is ready for AI extraction.
                            </p>
                        </div>

                        <motion.div
                            initial={{ y: 10, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.3 }}
                            className="flex items-center gap-3 w-full bg-muted/50 p-4 rounded-xl border"
                        >
                            <div className="p-2 bg-background rounded-lg shadow-sm">
                                <FileText className="w-6 h-6 text-primary/80" />
                            </div>
                            <div className="flex flex-col items-start overflow-hidden w-full">
                                <span className="font-medium text-sm truncate max-w-[200px] md:max-w-xs">{file.name}</span>
                                <span className="text-xs text-muted-foreground">{file.type || 'Document'} • {formatBytes(file.size)}</span>
                            </div>
                        </motion.div>

                        <motion.div
                            initial={{ y: 10, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.4 }}
                            className="w-full text-left space-y-4"
                        >
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-foreground/80 pl-1">What should AI extract?</label>
                                <textarea
                                    className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y"
                                    placeholder="E.g. Extract company names, invoice date, line items with description and price..."
                                    value={prompt}
                                    onChange={(e) => onPromptChange(e.target.value)}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-foreground/80 pl-1 flex items-center gap-2">
                                    ⚙️ Output Format
                                </label>
                                <select
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    value={format}
                                    onChange={(e) => onFormatChange(e.target.value)}
                                >
                                    <option value="auto">Auto (AI Decides)</option>
                                    <option value="table">Strict Data / Table (Invoices, Receipts)</option>
                                    <option value="report">Text Report (Contracts, Summaries)</option>
                                    <option value="hybrid">Hybrid (Summary + Table)</option>
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
                                Upload Another
                            </Button>
                            <Button className="flex-1 gap-2" onClick={onProceed}>
                                Extract Data <ArrowRight className="w-4 h-4" />
                            </Button>
                        </motion.div>
                    </div>
                </CardContent>
            </Card>
        </motion.div>
    );
}
