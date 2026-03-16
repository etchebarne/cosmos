use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde::Serialize;
use tauri::AppHandle;

use super::installer;

pub struct ServerConfig {
    pub language_id: String,
    pub server_name: String, // registry/display name
    pub command: String,     // binary name to execute
    pub args: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct ServerAvailability {
    pub language_id: String,
    pub server_name: String,
    pub available: bool,
}

// ── Language → Server mapping ──
// This is the single source of truth for which server handles which language
// and how to launch it. The registry handles installation metadata separately.

struct LaunchConfig {
    server_name: &'static str, // registry name (for install lookups)
    bin: &'static str,         // binary/command name
    args: &'static [&'static str],
}

/// Maps Monaco language IDs to their preferred LSP server and launch args.
const LANGUAGE_DEFAULTS: &[(&str, LaunchConfig)] = &[
    // ── Systems ──
    (
        "rust",
        LaunchConfig {
            server_name: "rust-analyzer",
            bin: "rust-analyzer",
            args: &[],
        },
    ),
    (
        "c",
        LaunchConfig {
            server_name: "clangd",
            bin: "clangd",
            args: &[],
        },
    ),
    (
        "cpp",
        LaunchConfig {
            server_name: "clangd",
            bin: "clangd",
            args: &[],
        },
    ),
    (
        "go",
        LaunchConfig {
            server_name: "gopls",
            bin: "gopls",
            args: &[],
        },
    ),
    (
        "zig",
        LaunchConfig {
            server_name: "zls",
            bin: "zls",
            args: &[],
        },
    ),
    // ── Web ──
    (
        "typescript",
        LaunchConfig {
            server_name: "typescript-language-server",
            bin: "typescript-language-server",
            args: &["--stdio"],
        },
    ),
    (
        "javascript",
        LaunchConfig {
            server_name: "typescript-language-server",
            bin: "typescript-language-server",
            args: &["--stdio"],
        },
    ),
    (
        "typescriptreact",
        LaunchConfig {
            server_name: "typescript-language-server",
            bin: "typescript-language-server",
            args: &["--stdio"],
        },
    ),
    (
        "javascriptreact",
        LaunchConfig {
            server_name: "typescript-language-server",
            bin: "typescript-language-server",
            args: &["--stdio"],
        },
    ),
    (
        "css",
        LaunchConfig {
            server_name: "css-lsp",
            bin: "vscode-css-language-server",
            args: &["--stdio"],
        },
    ),
    (
        "scss",
        LaunchConfig {
            server_name: "css-lsp",
            bin: "vscode-css-language-server",
            args: &["--stdio"],
        },
    ),
    (
        "less",
        LaunchConfig {
            server_name: "css-lsp",
            bin: "vscode-css-language-server",
            args: &["--stdio"],
        },
    ),
    (
        "html",
        LaunchConfig {
            server_name: "html-lsp",
            bin: "vscode-html-language-server",
            args: &["--stdio"],
        },
    ),
    (
        "json",
        LaunchConfig {
            server_name: "json-lsp",
            bin: "vscode-json-language-server",
            args: &["--stdio"],
        },
    ),
    (
        "jsonc",
        LaunchConfig {
            server_name: "json-lsp",
            bin: "vscode-json-language-server",
            args: &["--stdio"],
        },
    ),
    (
        "svelte",
        LaunchConfig {
            server_name: "svelte-language-server",
            bin: "svelteserver",
            args: &["--stdio"],
        },
    ),
    (
        "vue",
        LaunchConfig {
            server_name: "vue-language-server",
            bin: "vue-language-server",
            args: &["--stdio"],
        },
    ),
    (
        "astro",
        LaunchConfig {
            server_name: "astro-language-server",
            bin: "astro-ls",
            args: &["--stdio"],
        },
    ),
    (
        "tailwindcss",
        LaunchConfig {
            server_name: "tailwindcss-language-server",
            bin: "tailwindcss-language-server",
            args: &["--stdio"],
        },
    ),
    // ── Scripting ──
    (
        "python",
        LaunchConfig {
            server_name: "python-lsp-server",
            bin: "pylsp",
            args: &[],
        },
    ),
    (
        "lua",
        LaunchConfig {
            server_name: "lua-language-server",
            bin: "lua-language-server",
            args: &[],
        },
    ),
    (
        "ruby",
        LaunchConfig {
            server_name: "solargraph",
            bin: "solargraph",
            args: &["stdio"],
        },
    ),
    (
        "php",
        LaunchConfig {
            server_name: "intelephense",
            bin: "intelephense",
            args: &["--stdio"],
        },
    ),
    (
        "shellscript",
        LaunchConfig {
            server_name: "bash-language-server",
            bin: "bash-language-server",
            args: &["start"],
        },
    ),
    // ── Config / Data ──
    (
        "yaml",
        LaunchConfig {
            server_name: "yaml-language-server",
            bin: "yaml-language-server",
            args: &["--stdio"],
        },
    ),
    (
        "toml",
        LaunchConfig {
            server_name: "taplo",
            bin: "taplo",
            args: &["lsp", "stdio"],
        },
    ),
    (
        "markdown",
        LaunchConfig {
            server_name: "marksman",
            bin: "marksman",
            args: &["server"],
        },
    ),
    (
        "dockerfile",
        LaunchConfig {
            server_name: "dockerfile-language-server-nodejs",
            bin: "docker-langserver",
            args: &["--stdio"],
        },
    ),
    // ── JVM ──
    (
        "java",
        LaunchConfig {
            server_name: "jdtls",
            bin: "jdtls",
            args: &[],
        },
    ),
    (
        "kotlin",
        LaunchConfig {
            server_name: "kotlin-language-server",
            bin: "kotlin-language-server",
            args: &[],
        },
    ),
    // ── .NET ──
    (
        "csharp",
        LaunchConfig {
            server_name: "omnisharp",
            bin: "omnisharp",
            args: &[],
        },
    ),
    // ── Other ──
    (
        "elixir",
        LaunchConfig {
            server_name: "elixir-ls",
            bin: "elixir-ls",
            args: &[],
        },
    ),
    (
        "haskell",
        LaunchConfig {
            server_name: "haskell-language-server",
            bin: "haskell-language-server-wrapper",
            args: &["--lsp"],
        },
    ),
    (
        "dart",
        LaunchConfig {
            server_name: "dart-language-server",
            bin: "dart",
            args: &["language-server", "--protocol=lsp"],
        },
    ),
    (
        "terraform",
        LaunchConfig {
            server_name: "terraform-ls",
            bin: "terraform-ls",
            args: &["serve"],
        },
    ),
];

// ── Public API ──

/// Resolve the server config for a given Monaco language ID.
/// Returns None if no server is configured for this language.
pub fn resolve_server_for_language(language_id: &str) -> Option<ServerConfig> {
    let config = LANGUAGE_DEFAULTS
        .iter()
        .find(|(lang, _)| *lang == language_id)?;
    let launch = &config.1;

    Some(ServerConfig {
        language_id: server_language_group(language_id).to_string(),
        server_name: launch.server_name.to_string(),
        command: launch.bin.to_string(),
        args: launch.args.iter().map(|s| s.to_string()).collect(),
    })
}

/// Get the server name for a given language (for display purposes).
pub fn server_name_for_language(language_id: &str) -> Option<&'static str> {
    LANGUAGE_DEFAULTS
        .iter()
        .find(|(lang, _)| *lang == language_id)
        .map(|(_, config)| config.server_name)
}

/// Group multiple Monaco language IDs that share the same server.
/// e.g., typescript/javascript/typescriptreact/javascriptreact → "typescript"
/// This is used as the store key to avoid starting duplicate servers.
pub fn server_language_group(language_id: &str) -> &str {
    match language_id {
        "javascript" | "typescriptreact" | "javascriptreact" => "typescript",
        "cpp" => "c",
        "scss" | "less" => "css",
        "jsonc" => "json",
        other => other,
    }
}

/// Return the language → group mapping for all non-identity entries.
/// Used by the frontend as the single source of truth for language grouping.
pub fn language_groups() -> HashMap<String, String> {
    let mut groups = HashMap::new();
    for (lang, _) in LANGUAGE_DEFAULTS {
        let group = server_language_group(lang);
        if group != *lang {
            groups.insert(lang.to_string(), group.to_string());
        }
    }
    groups
}

/// Check if a server binary is available — either installed locally or on PATH.
pub fn is_server_available(app: &AppHandle, command: &str) -> bool {
    installer::find_installed_binary(app, command).is_some() || which::which(command).is_ok()
}

/// Resolve the full command path for a server.
/// Checks local installations first, then falls back to the bare command name for PATH lookup.
pub fn resolve_command(app: &AppHandle, command: &str) -> String {
    if let Some(local_path) = installer::find_installed_binary(app, command) {
        local_path.to_string_lossy().to_string()
    } else {
        command.to_string()
    }
}

/// Check which language servers are available for a workspace (based on project files).
pub fn check_availability(app: &AppHandle, workspace_path: &str) -> Vec<ServerAvailability> {
    detect_workspace_languages(workspace_path)
        .into_iter()
        .filter_map(|lang| {
            let config = resolve_server_for_language(lang)?;
            Some(ServerAvailability {
                available: is_server_available(app, &config.command),
                server_name: config.server_name,
                language_id: config.language_id,
            })
        })
        .collect()
}

/// Detect which languages a workspace likely uses based on project marker files.
fn detect_workspace_languages(workspace_path: &str) -> Vec<&'static str> {
    let root = Path::new(workspace_path);
    let mut languages = Vec::new();
    let mut seen = HashSet::new();

    let markers: &[(&[&str], &str)] = &[
        (&["Cargo.toml"], "rust"),
        (
            &["package.json", "tsconfig.json", "jsconfig.json"],
            "typescript",
        ),
        (
            &["pyproject.toml", "setup.py", "requirements.txt"],
            "python",
        ),
        (&["go.mod"], "go"),
        (&["CMakeLists.txt", ".clangd", "compile_commands.json"], "c"),
        (&["Gemfile"], "ruby"),
        (&["composer.json"], "php"),
    ];

    for (files, lang) in markers {
        if files.iter().any(|f| root.join(f).exists()) && seen.insert(*lang) {
            languages.push(*lang);
        }
    }

    languages
}
