import type { Metadata } from "next";
import "./globals.css";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CfMate",
  description: "Cloudflare batch assistant",
};

const themeScript = `
(() => {
  try {
    const key = "cf_toolkit:theme";
    const stored = localStorage.getItem(key);
    const mode = stored === "light" || stored === "dark" ? stored : "system";
    const systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const resolved = mode === "system" ? (systemDark ? "dark" : "light") : mode;
    const root = document.documentElement;
    if (resolved === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    root.style.colorScheme = resolved;
  } catch {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh" className={inter.className} suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased selection:bg-primary selection:text-primary-foreground">
        {children}
      </body>
    </html>
  );
}
