interface StateViewProps {
  message: string;
  variant?: "muted" | "secondary" | "error";
}

const variantClasses: Record<NonNullable<StateViewProps["variant"]>, string> = {
  muted: "text-[var(--color-text-muted)]",
  secondary: "text-[var(--color-text-secondary)]",
  error: "text-[var(--color-status-red)]",
};

export function StateView({ message, variant = "muted" }: StateViewProps) {
  return (
    <div className="flex items-center justify-center h-full">
      <p className={`text-xs ${variantClasses[variant]}`}>{message}</p>
    </div>
  );
}
