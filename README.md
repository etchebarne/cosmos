<div align="center">
  <img width="1200" height="630" alt="Kosmos" src="https://github.com/user-attachments/assets/424b1052-850b-4aff-abca-63ad3c2cedd3" />
  <br>
  <br>
  <p>A code editor where every view is a tab you can place anywhere.</p>

  [![Release](https://img.shields.io/github/v/release/etchebarne/kosmos?style=flat-square&color=6366f1)](https://github.com/etchebarne/kosmos/releases/latest)
  [![License: MIT](https://img.shields.io/badge/license-MIT-6366f1?style=flat-square)](LICENSE)
  [![Stars](https://img.shields.io/github/stars/etchebarne/kosmos?style=flat-square&color=6366f1)](https://github.com/etchebarne/kosmos/stargazers)
  [![Issues](https://img.shields.io/github/issues/etchebarne/kosmos?style=flat-square&color=6366f1)](https://github.com/etchebarne/kosmos/issues)

</div>

## Why Kosmos

Most editors dictate where things go. Kosmos lets you treat every view as a tab you can place anywhere, split in any direction, and rearrange freely. Multiple workspaces stay alive in the background so you can context-switch without losing terminals, layouts, or in-progress work.

## Features

- **Everything is a tab** — file tree, terminal, git, settings. No fixed panels, no locked sidebars.
- **Flexible layouts** — split panes horizontally or vertically. Drag any tab into any pane.
- **Persistent workspaces** — switch between projects instantly. Every workspace keeps its state running in the background.
- **Infinity Tab** — an infinite canvas where you can place any tab — editors, terminals, previews — and arrange them freely in open space.
- **Extension marketplace** — install new tab types from a built-in marketplace and place them anywhere in your workspace.

## Installation

Download the latest binary for your platform:

| Platform | Download |
|----------|----------|
| Windows | [kosmos_x64.msi](https://github.com/etchebarne/kosmos/releases/latest) |
| macOS | [kosmos_aarch64.dmg](https://github.com/etchebarne/kosmos/releases/latest) |
| Linux | [kosmos_amd64.deb](https://github.com/etchebarne/kosmos/releases/latest) |

**Arch Linux (AUR)**
```bash
yay -S kosmos-bin       # pre-built binary
yay -S kosmos           # build from source
```

## Building from source

**Prerequisites:** [Bun](https://bun.sh/), [Rust](https://www.rust-lang.org/tools/install), [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
```bash
bun install
bun run tauri dev    # development
bun run tauri build  # production build
```

## License

MIT — see [LICENSE](LICENSE).
