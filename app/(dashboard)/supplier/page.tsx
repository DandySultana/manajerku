"use client";

import SupplierDiscoveryView from "../../components/SupplierDiscoveryView";
import { useAppShell } from "../../components/AppShell";

export default function SupplierDiscoveryPage() {
  const shell = useAppShell();
  if (!shell) return null;

  return (
    <SupplierDiscoveryView
      activeStoreId={shell.authSession.storeId}
      activeRole={shell.authSession.role}
      onNavigateTab={shell.onNavigateTab}
      initialTargetProductId={shell.preselectedSupplierProductId}
      onClearInitialTargetProduct={shell.clearPreselectedSupplierProductId}
    />
  );
}
