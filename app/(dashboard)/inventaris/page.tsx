"use client";

import InventoryFefoView from "../../components/InventoryFefoView";
import { useAppShell } from "../../components/AppShell";

export default function InventoryFefoPage() {
  const shell = useAppShell();
  if (!shell) return null;

  return (
    <InventoryFefoView
      activeStoreId={shell.authSession.storeId}
      activeRole={shell.authSession.role}
      onNavigateTab={shell.onNavigateTab}
    />
  );
}
