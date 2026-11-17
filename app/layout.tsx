import type { Metadata } from "next";
import {
  Plus_Jakarta_Sans,
  IBM_Plex_Mono,
  Playfair_Display,
} from "next/font/google";
import "./globals.css";
import GooeyToastViewport from "./components/GooeyToastProvider";
import { ConfirmDialogProvider } from "./components/ConfirmActionModal";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-sans-app",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-mono-app",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const playfairDisplay = Playfair_Display({
  variable: "--font-serif-app",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Manajerku | Sistem Operasional UMKM Frozen Food",
  description:
    "Platform operasional untuk agen dan grosir frozen food: kasir web multi-satuan, antrean batch FEFO, pengadaan supplier, dan pembukuan standar KUR.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="id"
      className={`${plusJakarta.variable} ${ibmPlexMono.variable} ${playfairDisplay.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#F7F6F2] text-[#181C1B]">
        <ConfirmDialogProvider>
          <GooeyToastViewport />
          {children}
        </ConfirmDialogProvider>
      </body>
    </html>
  );
}
