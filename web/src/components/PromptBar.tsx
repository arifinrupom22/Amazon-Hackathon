import { useRef, useState } from "react";
import { ArrowUp, Loader2, Sparkles } from "lucide-react";

export function PromptBar({
  onSubmit,
  busy,
  placeholder = "Tell HomePilot what's happening…",
  autoFocus = false,
}: {
  onSubmit: (text: string) => void;
  busy?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const text = value.trim();
    if (!text || busy) return;
    onSubmit(text);
    setValue("");
    if (ref.current) ref.current.style.height = "auto";
  };

  return (
    <div className="card-raised flex items-end gap-3 p-3">
      <span className="mt-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-strong">
        <Sparkles size={15} aria-hidden="true" />
      </span>
      <textarea
        ref={ref}
        rows={1}
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          event.target.style.height = "auto";
          event.target.style.height = `${Math.min(160, event.target.scrollHeight)}px`;
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        aria-label="Household request"
        className="max-h-40 flex-1 resize-none border-0 bg-transparent text-[14.5px] leading-6 text-ink outline-none placeholder:text-muted"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!value.trim() || busy}
        className="btn btn-primary btn-sm h-9"
        aria-label="Send request"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={15} />}
        {busy ? "Planning…" : "Plan with AI"}
      </button>
    </div>
  );
}
