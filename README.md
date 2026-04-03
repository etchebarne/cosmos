<img width="1200" height="630" alt="Frame 30" src="https://github.com/user-attachments/assets/424b1052-850b-4aff-abca-63ad3c2cedd3" />

# Kosmos

A tab-based code editor where everything is a tab. Arrange your workspace however you want with split panes, and switch between multiple workspaces to multitask across multiple projects seamlessly.

## Why

Most editors dictate where things go. Kosmos lets you treat every view as a tab you can place anywhere, split in any direction, and rearrange freely. Multiple workspaces stay alive in the background so you can context-switch without losing terminals, layouts, or in-progress work.

## Installation

You can download the binaries from the [latest release](https://github.com/etchebarne/kosmos/releases/latest).

Or, if you're on Arch Linux, download from AUR:

`yay -S kosmos-bin` or `yay -S kosmos` to build from source

## Prerequisites

- [Bun](https://bun.sh/)
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

## Development

```bash
bun install
bun run tauri dev
```

## Build

```bash
bun run tauri build
```
