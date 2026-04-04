import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { ServiceWorkerRegister } from "@/components/service-worker-register";

export const metadata: Metadata = {
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Zapp",
  },
  description:
    "Local-first premium PWA for room control, device provisioning, and LLM-assisted automation.",
  icons: {
    apple: "/icons/zapp-icon.svg",
    icon: "/icons/zapp-icon.svg",
  },
  manifest: "/manifest.webmanifest",
  metadataBase: new URL("http://localhost:3000"),
  title: {
    default: "Zapp",
    template: "%s | Zapp",
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0b1324",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <Providers>
          <ServiceWorkerRegister />
          {children}
        </Providers>
      </body>
    </html>
  );
}
