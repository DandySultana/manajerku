"use client";

import FinanceKurView from "../../components/FinanceKurView";
import { useAppShell } from "../../components/AppShell";

export default function FinanceKurPage() {
  const shell = useAppShell();
  if (!shell) return null;

  return (
    <FinanceKurView
      activeStoreId={shell.authSession.storeId}
      activeRole={shell.authSession.role}
    />
  );
}
