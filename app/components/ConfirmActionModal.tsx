"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type ConfirmDialogVariant = "danger" | "warning" | "primary";

export interface ConfirmDialogOptions {
  title: string;
  description: string;
  detailText?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmDialogVariant;
}

interface ActiveConfirmState extends ConfirmDialogOptions {
  resolve: (confirmed: boolean) => void;
}

type ConfirmFn = (options: ConfirmDialogOptions) => Promise<boolean>;

const ConfirmDialogContext = createContext<ConfirmFn | null>(null);

export function useConfirmDialog(): ConfirmFn {
  const ctx = useContext(ConfirmDialogContext);
  if (!ctx) {
    throw new Error(
      "useConfirmDialog harus digunakan di dalam ConfirmDialogProvider"
    );
  }
  return ctx;
}

export function ConfirmDialogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [dialog, setDialog] = useState<ActiveConfirmState | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setDialog({
        ...options,
        resolve,
      });
    });
  }, []);

  const handleClose = useCallback((result: boolean) => {
    setDialog((prev) => {
      if (prev) {
        prev.resolve(result);
      }
      return null;
    });
  }, []);

  useEffect(() => {
    if (!dialog) return;
    const timer = setTimeout(() => {
      confirmBtnRef.current?.focus();
    }, 20);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleClose(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [dialog, handleClose]);

  const variant = dialog?.variant ?? "primary";

  const iconWrapClass =
    variant === "danger"
      ? "bg-red-50 border-red-200 text-red-600"
      : variant === "warning"
        ? "bg-amber-50 border-amber-200 text-amber-700"
        : "bg-[#EBF8F2] border-[#CCE8DB] text-[#0F6352]";

  const confirmBtnClass =
    variant === "danger"
      ? "bg-red-600 hover:bg-red-700 active:bg-red-800 text-white focus-visible:outline-red-600"
      : variant === "warning"
        ? "bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white focus-visible:outline-amber-600"
        : "bg-[#0F6352] hover:bg-[#0B4F41] active:bg-[#083D32] text-white focus-visible:outline-[#0F6352]";

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}

      {dialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-action-modal-title"
          aria-describedby="confirm-action-modal-desc"
          className="print:hidden fixed inset-0 z-[120] bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => handleClose(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-[#E2E8F0] space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3.5">
              <div
                aria-hidden="true"
                className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${iconWrapClass}`}
              >
                {variant === "danger" ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-5 h-5"
                  >
                    <path d="M3 6h18" />
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                ) : variant === "warning" ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-5 h-5"
                  >
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-5 h-5"
                  >
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    <path d="m9 12 2 2 4-4" />
                  </svg>
                )}
              </div>

              <div className="space-y-1.5 min-w-0 flex-1">
                <h3
                  id="confirm-action-modal-title"
                  className="text-base font-bold text-[#0F172A] leading-snug"
                >
                  {dialog.title}
                </h3>
                <p
                  id="confirm-action-modal-desc"
                  className="text-xs sm:text-[13px] text-[#475569] leading-relaxed"
                >
                  {dialog.description}
                </p>
              </div>
            </div>

            {dialog.detailText && (
              <div className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] px-3.5 py-2.5 text-xs font-medium text-[#334155]">
                {dialog.detailText}
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#F1F5F9]">
              <button
                type="button"
                onClick={() => handleClose(false)}
                className="min-h-[42px] px-4 py-2 rounded-xl border border-[#CBD5E1] bg-white hover:bg-[#F8FAFC] text-xs font-semibold text-[#334155] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
              >
                {dialog.cancelLabel || "Batal"}
              </button>
              <button
                ref={confirmBtnRef}
                type="button"
                onClick={() => handleClose(true)}
                className={`min-h-[42px] px-4 py-2 rounded-xl text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${confirmBtnClass}`}
              >
                {dialog.confirmLabel || "Ya, Lanjutkan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmDialogContext.Provider>
  );
}
