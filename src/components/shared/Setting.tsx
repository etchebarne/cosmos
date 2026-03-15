interface SettingProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

export function Setting({ label, description, children }: SettingProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 px-1">
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-xs text-[var(--color-text-primary)]">{label}</span>
        {description && (
          <span className="text-[11px] text-[var(--color-text-tertiary)]">{description}</span>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
