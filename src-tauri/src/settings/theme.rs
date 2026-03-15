use super::types::*;

pub fn section() -> SettingsSection {
    SettingsSection {
        id: "theme".into(),
        label: "Theme".into(),
        groups: vec![SettingsGroup {
            title: "Color Theme".into(),
            settings: vec![SettingEntry {
                key: "theme.colorTheme".into(),
                label: "Color theme".into(),
                description: Some("Specifies the color theme".into()),
                control: SettingControl::Dropdown {
                    options: vec![
                        DropdownOption {
                            value: "cosmos-dark".into(),
                            label: "Cosmos Dark".into(),
                        },
                        DropdownOption {
                            value: "cosmos-light".into(),
                            label: "Cosmos Light".into(),
                        },
                        DropdownOption {
                            value: "cosmos-ember".into(),
                            label: "Cosmos Ember".into(),
                        },
                    ],
                },
                default_value: serde_json::json!("cosmos-dark"),
            }],
        }],
    }
}
