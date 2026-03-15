interface SectionTitleProps {
  children: React.ReactNode;
}

export function SectionTitle({ children }: SectionTitleProps) {
  return (
    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-1 mt-4 first:mt-0">
      {children}
    </h4>
  );
}
