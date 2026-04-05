import type { Metadata, Viewport } from "next";
import { Inter, Manrope } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { ServiceWorkerRegister } from "@/components/service-worker-register";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
});

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
  themeColor: "#131313",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${manrope.variable} h-full antialiased`}>
      <body className="font-sans min-h-full">
        <Providers>
          <ServiceWorkerRegister />
          {children}
        </Providers>
      </body>
    </html>
  );
}
