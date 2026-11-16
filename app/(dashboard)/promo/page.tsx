"use client";

import ResellerPromoView from "../../components/ResellerPromoView";
import { useAppShell } from "../../components/AppShell";

export default function ResellerPromoPage() {
  const shell = useAppShell();
  if (!shell) return null;

  return (
    <ResellerPromoView
      activeStoreId={shell.authSession.storeId}
      activeRole={shell.authSession.role}
      onNavigateTab={shell.onNavigateTab}
    />
  );
}
