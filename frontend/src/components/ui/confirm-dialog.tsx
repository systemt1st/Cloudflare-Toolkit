"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  title: string;
  description?: string;
  confirmText: string;
  cancelText: string;
  confirmVariant?: "default" | "destructive";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmText,
  cancelText,
  confirmVariant = "default",
  loading,
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => confirmRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
    };
  }, [onCancel, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onCancel();
        }}
        aria-hidden="true"
      />

      <div
        className="relative z-10 w-full max-w-md rounded-[28px] zen-surface overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between border-b zen-divider px-6 py-4">
          <div className="text-base font-semibold text-foreground">{title}</div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 hover:bg-white/55 hover:text-foreground dark:hover:bg-gray-700/30"
            aria-label={cancelText}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onCancel} disabled={loading}>
              {cancelText}
            </Button>
            <Button
              ref={confirmRef}
              variant={confirmVariant}
              onClick={onConfirm}
              disabled={loading}
            >
              {confirmText}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
