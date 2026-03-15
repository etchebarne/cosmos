import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { ScrollArea } from "../../components/shared/ScrollArea";
import { Setting } from "../../components/shared/Setting";
import { SectionTitle } from "../../components/shared/SectionTitle";
import { Dropdown } from "../../components/shared/Dropdown";
import { useSettingsStore } from "../../store/settings.store";
import type { TabContentProps } from "../types";

interface DropdownOption {
  value: string;
  label: string;
}

type SettingControl =
  | { type: "dropdown"; options: DropdownOption[] }
  | { type: "switch" }
  | { type: "number"; min: number; max: number; step: number };

interface SettingEntry {
  key: string;
  label: string;
  description?: string;
  control: SettingControl;
  defaultValue: unknown;
}

interface SettingsGroup {
  title: string;
  settings: SettingEntry[];
}

interface SettingsSection {
  id: string;
  label: string;
  groups: SettingsGroup[];
}

interface SettingsSchema {
  sections: SettingsSection[];
}

function SettingControlRenderer({
  control,
  value,
  onChange,
}: {
  control: SettingControl;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (control.type) {
    case "dropdown":
      return <Dropdown value={String(value)} options={control.options} onChange={onChange} />;
    case "switch":
      return (
        <button
          className={`relative w-8 h-[18px] transition-colors ${
            value ? "bg-[var(--color-accent-blue)]" : "bg-[var(--color-bg-tertiary)]"
          }`}
          onClick={() => onChange(!value)}
        >
          <span
            className={`absolute top-[2px] w-[14px] h-[14px] bg-white transition-transform ${
              value ? "left-[16px]" : "left-[2px]"
            }`}
          />
        </button>
      );
    case "number":
      return (
        <input
          type="number"
          value={Number(value)}
          min={control.min}
          max={control.max}
          step={control.step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="text-xs w-16 bg-[var(--color-bg-surface)] border border-[var(--color-border-secondary)] text-[var(--color-text-primary)] px-2 py-1 outline-none hover:border-[var(--color-accent-blue)] transition-colors text-center"
        />
      );
  }
}

function AccordionSection({
  section,
  expanded,
  onToggle,
  values,
  onChange,
}: {
  section: SettingsSection;
  expanded: boolean;
  onToggle: () => void;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <div className="border-b border-[var(--color-border-primary)]">
      <button
        className="flex items-center gap-2 w-full px-4 py-2.5 text-left hover:bg-[var(--color-bg-hover)] transition-colors"
        onClick={onToggle}
      >
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={12}
          className={`text-[var(--color-text-tertiary)] transition-transform ${expanded ? "" : "-rotate-90"}`}
        />
        <span className="text-xs font-semibold text-[var(--color-text-primary)]">
          {section.label}
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-3">
          {section.groups.map((group) => (
            <div key={group.title} className="flex flex-col">
              <SectionTitle>{group.title}</SectionTitle>
              {group.settings.map((entry) => (
                <Setting key={entry.key} label={entry.label} description={entry.description}>
                  <SettingControlRenderer
                    control={entry.control}
                    value={values[entry.key] ?? entry.defaultValue}
                    onChange={(v) => onChange(entry.key, v)}
                  />
                </Setting>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SettingsTab({ tab: _tab, paneId: _paneId }: TabContentProps) {
  const [schema, setSchema] = useState<SettingsSchema | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const values = useSettingsStore((s) => s.values);
  const setSetting = useSettingsStore((s) => s.set);

  useEffect(() => {
    invoke<SettingsSchema>("get_settings_schema").then((s) => {
      setSchema(s);
    });
  }, []);

  const toggleSection = useCallback((id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleChange = useCallback(
    (key: string, value: unknown) => {
      setSetting(key, value);
    },
    [setSetting],
  );

  if (!schema) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-[var(--color-text-secondary)]">Loading settings...</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="max-w-2xl mx-auto py-2">
        {schema.sections.map((section) => (
          <AccordionSection
            key={section.id}
            section={section}
            expanded={expandedSections.has(section.id)}
            onToggle={() => toggleSection(section.id)}
            values={values}
            onChange={handleChange}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
