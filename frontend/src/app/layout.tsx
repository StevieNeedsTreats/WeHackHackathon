import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, Source_Serif_4 } from "next/font/google";
import "@xyflow/react/dist/base.css";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });
const serif = Source_Serif_4({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-serif4", display: "swap" });

export const metadata: Metadata = {
  title: "TruthGraph — evidence graphs for what the research actually says",
  description: "Agents read the literature on a substance, extract claims, score credibility and map contradictions into a FalkorDB graph.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${mono.variable} ${serif.variable}`}>{children}</body>
    </html>
  );
}
