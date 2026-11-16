"use client";

import SmartPosView from "../../components/SmartPosView";
import { useAppShell } from "../../components/AppShell";

export default function SmartPosPage() {
  const shell = useAppShell();
  if (!shell) return null;

  return (
    <SmartPosView
      activeStoreId={shell.authSession.storeId}
      activeRole={shell.authSession.role}
      onNavigateTab={shell.onNavigateTab}
    />
  );
}
