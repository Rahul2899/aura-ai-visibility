import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Aura AI — Visibility Engine",
  description: "See how visible your brand is across AI models like ChatGPT, Claude, and Gemini. Real-time visibility scores for HR tech and SaaS brands.",
  openGraph: {
    title: "Aura AI — Visibility Engine",
    description: "See how visible your brand is across AI models. Real-time scores for ChatGPT, Claude, Gemini and more.",
    type: "website",
    siteName: "Aura AI",
  },
  twitter: {
    card: "summary",
    title: "Aura AI — Visibility Engine",
    description: "See how visible your brand is across AI models. Real-time scores for ChatGPT, Claude, Gemini and more.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased`} style={{ background: "var(--bg)", fontFamily: "var(--font-inter), -apple-system, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
