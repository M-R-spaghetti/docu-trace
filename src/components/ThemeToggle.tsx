"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

export function ThemeToggle() {
    const { theme, setTheme } = useTheme();

    return (
        <div className="fixed bottom-6 right-6 z-50">
            <Button
                variant="outline"
                size="icon"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="rounded-full h-14 w-14 shadow-xl border-primary/20 bg-background/80 backdrop-blur-md hover:bg-primary hover:text-primary-foreground transition-all duration-300 group"
            >
                <Sun className="h-6 w-6 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 group-hover:animate-pulse" />
                <Moon className="absolute h-6 w-6 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 group-hover:animate-pulse" />
                <span className="sr-only">Toggle theme</span>
            </Button>
        </div>
    );
}
