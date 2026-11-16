import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Masuk ke Akun | Manajerku",
  description:
    "Halaman login Manajerku untuk pemilik toko, admin, dan kasir UMKM agen frozen food.",
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
