import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Daftar Toko Baru | Manajerku",
  description:
    "Registrasi akun pemilik dan inisialisasi buku kas serta parameter beban freezer toko frozen food di Manajerku.",
};

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

