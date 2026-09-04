import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SessionProvider } from "@/lib/sessionContext";
import { AppHeader } from "@/components/AppHeader";

export const metadata: Metadata = {
  title: "DocuTrace AI",
  description: "Enterprise-grade B2B SaaS for AI Document Extraction",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-background font-sans`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ErrorBoundary>
            <SessionProvider>
              <div className="relative flex min-h-screen flex-col">
                <AppHeader />
                <main className="flex-1">
                  {children}
                </main>
              </div>
              <Toaster position="top-center" richColors />
            </SessionProvider>
          </ErrorBoundary>
        </ThemeProvider>
      </body>
    </html>
  );
}
