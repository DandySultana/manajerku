"use client";

import React, { useEffect, useRef } from "react";
import { GooeyToaster, gooeyToast as goeyToastLib } from "goey-toast";
import "goey-toast/styles.css";

export const gooeyToast = {
  success(message: string, title = "Berhasil") {
    const clean = message.trim();
    if (!clean) return;
    return goeyToastLib.success(title, {
      description: clean,
      duration: 5000,
    });
  },
  error(message: string, title = "Gagal") {
    const clean = message.trim();
    if (!clean) return;
    return goeyToastLib.error(title, {
      description: clean,
      duration: 7000,
    });
  },
  dismiss(id?: string | number) {
    goeyToastLib.dismiss(id);
  },
};

/**
 * Syncs local component feedback/error string state into `goey-toast` notifications.
 * Passing clear callbacks removes duplicate inline alert banners automatically.
 */
export function useGooeyToastFlash(
  feedbackMsg: string | null | undefined,
  errorMsg: string | null | undefined,
  onClearFeedback?: () => void,
  onClearError?: () => void
) {
  const lastFeedbackRef = useRef<string | null>(null);
  const lastErrorRef = useRef<string | null>(null);
  const clearFeedbackRef = useRef(onClearFeedback);
  const clearErrorRef = useRef(onClearError);

  useEffect(() => {
    clearFeedbackRef.current = onClearFeedback;
    clearErrorRef.current = onClearError;
  });

  useEffect(() => {
    if (feedbackMsg && feedbackMsg !== lastFeedbackRef.current) {
      lastFeedbackRef.current = feedbackMsg;
      gooeyToast.success(feedbackMsg);
      clearFeedbackRef.current?.();
    } else if (!feedbackMsg) {
      lastFeedbackRef.current = null;
    }
  }, [feedbackMsg]);

  useEffect(() => {
    if (errorMsg && errorMsg !== lastErrorRef.current) {
      lastErrorRef.current = errorMsg;
      gooeyToast.error(errorMsg);
      clearErrorRef.current?.();
    } else if (!errorMsg) {
      lastErrorRef.current = null;
    }
  }, [errorMsg]);
}

export default function GooeyToastViewport() {
  return (
    <GooeyToaster
      position="bottom-right"
      offset={20}
      theme="light"
      richColors
      closeButton="top-right"
      preset="smooth"
      showProgress
      closeOnEscape
      swipeToDismiss
      visibleToasts={4}
    />
  );
}
