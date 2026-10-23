import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import { useAppState } from "../state/store";

export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-[13px] leading-5 text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin text-muted" aria-hidden="true" />;
}

export function LoadingRows({ rows = 3, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div className="space-y-3" role="status" aria-label={label}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton h-12 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-line bg-surface-2/60 px-6 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent-strong">
        {icon}
      </div>
      <p className="text-[14px] font-semibold text-ink">{title}</p>
      <p className="max-w-sm text-[13px] leading-5 text-muted">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="w-full overflow-hidden rounded-[16px] border border-line bg-surface"
        style={{ maxWidth: width, boxShadow: "var(--shadow-overlay)" }}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost btn btn-sm"
            aria-label="Close dialog"
          >
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmButton({
  onConfirm,
  children,
  confirmTitle,
  confirmBody,
  confirmLabel = "Confirm",
  className = "btn btn-secondary btn-sm",
  disabled,
}: {
  onConfirm: () => void | Promise<void>;
  children: ReactNode;
  confirmTitle: string;
  confirmBody: string;
  confirmLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <button type="button" className={className} disabled={disabled || busy} onClick={() => setOpen(true)}>
        {children}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={confirmTitle}
        width={440}
        footer={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>
              Keep
            </button>
            <button
              type="button"
              className="btn btn-sm"
              style={{ background: "var(--color-error)", color: "#fff", border: "1px solid transparent" }}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Working…" : confirmLabel}
            </button>
          </>
        }
      >
        <p className="text-[13.5px] leading-6 text-ink-soft">{confirmBody}</p>
      </Modal>
    </>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useAppState();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-start gap-3 rounded-[12px] border border-line bg-surface px-4 py-3"
          style={{ boxShadow: "var(--shadow-raised)" }}
          role="status"
        >
          <span
            className={
              toast.kind === "success"
                ? "text-success"
                : toast.kind === "error"
                  ? "text-error"
                  : "text-accent"
            }
          >
            {toast.kind === "success" ? (
              <CheckCircle2 size={17} />
            ) : toast.kind === "error" ? (
              <XCircle size={17} />
            ) : (
              <Info size={17} />
            )}
          </span>
          <p className="flex-1 text-[13px] leading-5 text-ink">{toast.message}</p>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            className="text-muted transition hover:text-ink"
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Shown only when a live provider degraded to the local planner. This is not a
 * permanent mode badge: it appears with the response that triggered it and can
 * be dismissed. Quota exhaustion uses the exact wording required by the spec.
 */
export function ProviderNoticeBanner() {
  const { providerNotice, dismissProviderNotice } = useAppState();
  if (!providerNotice) return null;

  return (
    <div className="border-b border-warning/30 bg-warning-soft" role="status" aria-live="polite">
      <div className="mx-auto flex max-w-[1180px] items-start gap-3 px-4 py-3 lg:px-8">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface text-warning">
          <AlertTriangle size={15} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-ink">{providerNotice.notice}</p>
          <p className="mt-0.5 text-[12.5px] leading-5 text-ink-soft">
            {providerNotice.kind === "quota"
              ? "Requests are answered by the local planner instead. Every tool, approval flow and persisted change keeps working."
              : "This request was answered by the local planner instead of the configured model."}
            {providerNotice.simulated
              ? " Simulated for a controlled test — no provider call was made and no credits were used."
              : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={dismissProviderNotice}
          className="shrink-0 text-muted transition hover:text-ink"
          aria-label="Dismiss provider notice"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

export function WarningBanner({
  children,
  tone = "warning",
}: {
  children: ReactNode;
  tone?: "warning" | "error" | "info";
}) {
  const styles =
    tone === "error"
      ? "border-error/25 bg-error-soft text-error"
      : tone === "info"
        ? "border-accent/20 bg-accent-soft text-accent-ink"
        : "border-warning/25 bg-warning-soft text-warning";
  const Icon = tone === "error" ? XCircle : tone === "info" ? Info : AlertTriangle;
  return (
    <div className={`flex items-start gap-2.5 rounded-[10px] border px-3.5 py-2.5 text-[13px] leading-5 ${styles}`}>
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: ReactNode;
}) {
  return (
    <div className="card px-4 py-3.5">
      <div className="flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        <span className="text-muted">{icon}</span>
      </div>
      <p className="tnum mt-2 text-[24px] font-semibold leading-7 tracking-[-0.02em] text-ink">{value}</p>
      {hint ? <p className="mt-1 text-[12px] leading-4 text-muted">{hint}</p> : null}
    </div>
  );
}
