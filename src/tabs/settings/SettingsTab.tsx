import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ScrollArea } from "../../components/shared/ScrollArea";
import { Setting } from "../../components/shared/Setting";
import { SectionTitle } from "../../components/shared/SectionTitle";
import { Dropdown } from "../../components/shared/Dropdown";
import { applyTheme, getTheme } from "../../lib/themes";
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

function SectionContent({
  section,
  values,
  onChange,
}: {
  section: SettingsSection;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <div className="flex flex-col">
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
  );
}

export function SettingsTab({ tab: _tab, paneId: _paneId }: TabContentProps) {
  const [schema, setSchema] = useState<SettingsSchema | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({
    "theme.colorTheme": getTheme().name,
  });

  useEffect(() => {
    invoke<SettingsSchema>("get_settings_schema").then((s) => {
      setSchema(s);
      if (s.sections.length > 0) {
        setActiveSection(s.sections[0].id);
      }
    });
  }, []);

  const handleChange = useCallback((key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));

    // Apply side effects for known settings
    if (key === "theme.colorTheme") {
      applyTheme(String(value));
    }
  }, []);

  if (!schema) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-[var(--color-text-secondary)]">Loading settings...</p>
      </div>
    );
  }

  const currentSection = schema.sections.find((s) => s.id === activeSection);

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar */}
      <div className="w-40 shrink-0 h-full border-r border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
        <div className="flex flex-col py-2">
          {schema.sections.map((section) => (
            <button
              key={section.id}
              className={`text-left px-4 py-1.5 text-xs transition-colors ${
                activeSection === section.id
                  ? "text-[var(--color-text-primary)] bg-[var(--color-bg-hover)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
              }`}
              onClick={() => setActiveSection(section.id)}
            >
              {section.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 min-h-0 h-full">
        <ScrollArea className="h-full">
          <div className="max-w-xl mx-auto p-6">
            {currentSection && (
              <>
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-4">
                  {currentSection.label}
                </h3>
                <SectionContent section={currentSection} values={values} onChange={handleChange} />
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
