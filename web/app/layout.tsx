import type { Metadata } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Serif display face for headlines — the single strongest "editorial luxury" signal,
// pairs with Inter for body. Loaded via next/font so it self-hosts (no layout shift).
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Aura AI · Visibility Engine",
  description: "See how visible your brand is across AI models like ChatGPT, Claude, and Gemini. Real-time visibility scores for brands in any industry.",
  openGraph: {
    title: "Aura AI · Visibility Engine",
    description: "See how visible your brand is across AI models. Real-time scores for ChatGPT, Claude, Gemini and more.",
    type: "website",
    siteName: "Aura AI",
  },
  twitter: {
    card: "summary",
    title: "Aura AI · Visibility Engine",
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
      <body className={`${inter.variable} ${fraunces.variable} antialiased`} style={{ background: "var(--bg)", fontFamily: "var(--font-inter), -apple-system, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
