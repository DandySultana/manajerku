"use client";

import AuthAccountView from "../../components/AuthAccountView";
import { useAppShell } from "../../components/AppShell";

export default function AccountSecurityPage() {
  const shell = useAppShell();
  if (!shell) return null;

  return (
    <AuthAccountView
      currentSession={shell.authSession}
      onAuthSuccess={(session) => {
        shell.setAuthSession(session);
      }}
      onLogoutSuccess={shell.clearSessionToLogin}
    />
  );
}
