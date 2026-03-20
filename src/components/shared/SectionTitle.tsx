interface SectionTitleProps {
  children: React.ReactNode;
}

export function SectionTitle({ children }: SectionTitleProps) {
  return (
    <h4 className="text-xs font-bold text-[var(--color-text-secondary)] mb-1 mt-4 first:mt-0">
      {children}
    </h4>
  );
}
