import type { Metadata } from "next";
import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";
import { PALETTE_INIT_SCRIPT } from "@/components/palette-provider";
import { getSiteSettings } from "@/lib/queries/site-settings";

const display = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const body = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

const data = IBM_Plex_Mono({
  variable: "--font-data",
  subsets: ["latin"],
  weight: ["400", "500"],
});

// Async (not the static `metadata` export) specifically so Title/Description/
// Favicon/OG-image can come from DashboardSiteSettings and take effect
// without a redeploy — see docs/superpowers/specs/2026-07-27-pengaturan-situs-design.md.
// A route segment can't export both `metadata` and `generateMetadata`.
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  return {
    // `default` is the bare title (any page/layout that doesn't set its
    // own `title`, e.g. this root itself) — unchanged behavior. `template`
    // lets any descendant page/layout set just its own short title (e.g.
    // "Pemasaran") and have it composed as "Pemasaran | <settings.title>"
    // in the browser tab, without needing to know or repeat the site name.
    title: { default: settings.title, template: `%s | ${settings.title}` },
    description: settings.description ?? undefined,
    icons: { icon: settings.faviconPath || "/brand/default-favicon.png" },
    openGraph: {
      title: settings.title,
      description: settings.description ?? undefined,
      images: settings.ogImagePath ? [settings.ogImagePath] : undefined,
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="id"
      className={`${display.variable} ${body.variable} ${data.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: PALETTE_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </Providers>
      </body>
    </html>
  );
}
