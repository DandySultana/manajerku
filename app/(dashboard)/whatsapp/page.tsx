"use client";

import WhatsappAgentOcrView from "../../components/WhatsappAgentOcrView";
import { useAppShell } from "../../components/AppShell";

export default function WhatsappAgentPage() {
  const shell = useAppShell();
  if (!shell) return null;

  return (
    <WhatsappAgentOcrView
      activeStoreId={shell.authSession.storeId}
      activeRole={shell.authSession.role}
      onNavigateTab={shell.onNavigateTab}
    />
  );
}
