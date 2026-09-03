"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
    children?: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo);
    }

    public render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="flex items-center justify-center min-h-[400px] w-full p-4">
                    <Card className="w-full max-w-md border-destructive/20 bg-destructive/5 shadow-sm">
                        <CardContent className="p-6 flex flex-col items-center text-center space-y-4">
                            <div className="p-3 bg-destructive/10 rounded-full text-destructive">
                                <AlertCircle className="w-8 h-8" />
                            </div>
                            <div className="space-y-2">
                                <h2 className="text-xl font-semibold">Something went wrong</h2>
                                <p className="text-sm text-muted-foreground">
                                    The application encountered an unexpected error. Please try reloading the page.
                                </p>
                                {this.state.error && (
                                    <div className="mt-4 p-3 bg-background border rounded-md text-xs text-left text-muted-foreground overflow-auto max-h-32">
                                        <code>{this.state.error.message}</code>
                                    </div>
                                )}
                            </div>
                            <Button
                                variant="outline"
                                className="w-full mt-4 gap-2"
                                onClick={() => {
                                    this.setState({ hasError: false, error: null });
                                    window.location.reload();
                                }}
                            >
                                <RefreshCw className="w-4 h-4" />
                                Reload Page
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            );
        }

        return this.props.children;
    }
}
