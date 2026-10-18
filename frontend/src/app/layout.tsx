import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Schibsted_Grotesk } from "next/font/google";
import "@xyflow/react/dist/base.css";
import "./globals.css";
import { ThemeProvider } from "@/components/theme";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

const sans = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-schibsted", display: "swap" });
const code = JetBrains_Mono({ subsets: ["latin"], weight: ["400"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: "TruthGraph: what the research actually says",
  description: "Agents read the literature on a substance, extract claims, score credibility and map contradictions into a FalkorDB graph.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1119" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // next-themes sets the theme class with a blocking script before first paint,
    // so the server-rendered <html> legitimately differs from the client's.
    <html lang="en" className="font-sans" suppressHydrationWarning>
      <body className={`${sans.variable} ${code.variable}`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider delayDuration={250}>{children}</TooltipProvider>
          <Toaster position="bottom-center" closeButton toastOptions={{ className: "text-[13px]" }} />
        </ThemeProvider>
      </body>
    </html>
  );
}
