"use client";

import { useEffect, useRef } from "react";
import CommandCenterDashboard, {
  type CommandCenterHandle,
} from "../components/CommandCenterDashboard";
import { useAppShell } from "../components/AppShell";

export default function DashboardHomePage() {
  const shell = useAppShell();
  const dashboardRef = useRef<CommandCenterHandle | null>(null);
  const pendingModal = shell?.pendingDashboardModal ?? null;
  const clearPendingModal = shell?.clearPendingDashboardModal;

  useEffect(() => {
    if (!pendingModal || !dashboardRef.current || !clearPendingModal) return;
    if (pendingModal === "ACCESS") {
      dashboardRef.current.openAccessModal();
    } else {
      dashboardRef.current.openOnboardingModal();
    }
    clearPendingModal();
  }, [pendingModal, clearPendingModal]);

  if (!shell) return null;

  return (
    <CommandCenterDashboard
      ref={dashboardRef}
      activeStoreId={shell.authSession.storeId}
      activeRole={shell.authSession.role}
      onNavigateTab={shell.onNavigateTab}
      onStoreChanged={() => {
        shell.checkCurrentSession();
      }}
      refreshSignal={shell.dashboardRefreshKey}
    />
  );
}
