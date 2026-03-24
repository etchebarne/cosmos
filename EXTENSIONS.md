# Kosmos Extensions

Extensions add new tabs, commands, and capabilities to Kosmos. They are standard React/TypeScript projects that get bundled into a single JS file.

## Getting started

A plugin is a folder with this structure:

```
my-plugin/
  manifest.json
  package.json
  src/
    index.tsx        <-- your code (normal JSX)
  dist/
    index.js         <-- built output (auto-generated)
```

### 1. manifest.json

Declares what your plugin contributes. The folder name becomes the plugin's ID — no need to specify one.

```json
{
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "What my plugin does.",
  "author": "github-username",
  "main": "dist/index.js",
  "contributes": {
    "tabs": [
      {
        "type": "my-tab",
        "title": "My Tab",
        "icon": "code"
      }
    ]
  }
}
```

**Available tab icons:** `file`, `code`, `folder-tree`, `git-branch`, `git-compare`, `terminal`, `settings`, `infinity`, `magnifying-glass`, `puzzle-piece`

### 2. package.json

Plugins use [esbuild](https://esbuild.github.io/) to bundle JSX/TSX into a single file. React is externalized — Kosmos provides it at runtime via an [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap).

```json
{
  "private": true,
  "scripts": {
    "build": "esbuild src/index.tsx --bundle --format=esm --outfile=dist/index.js --jsx=automatic --external:react --external:react/jsx-runtime"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "esbuild": "^0.25.0"
  }
}
```

### 3. Write your plugin

**src/index.tsx:**

```tsx
import { useState } from "react";

function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>
        Count: {count}
      </span>
      <button
        onClick={() => setCount(count + 1)}
        style={{
          padding: "6px 16px",
          fontSize: 12,
          color: "white",
          backgroundColor: "var(--color-accent-blue)",
          border: "none",
        }}
      >
        Increment
      </button>
    </div>
  );
}

export function activate(api: any) {
  api.tabs.register({
    type: "my-tab",
    title: "My Tab",
    icon: "code",
    component: Counter,
  });
}

export function deactivate() {}
```

### 4. Build and install

```sh
bun install
bun run build
```

Copy the plugin folder to the plugins directory and restart Kosmos:

- **Windows:** `%APPDATA%/kosmos.etchebarne.net/plugins/`
- **macOS:** `~/Library/Application Support/kosmos.etchebarne.net/plugins/`
- **Linux:** `~/.local/share/kosmos.etchebarne.net/plugins/`

## API reference

The `activate` function receives an API object with the following namespaces.

### api.tabs

```tsx
// Register a tab type
api.tabs.register({
  type: "my-tab",
  title: "My Tab",
  icon: "code",
  component: MyReactComponent,
});

// Open a tab programmatically
api.tabs.open("my-tab", { someKey: "someValue" });
```

The component receives `{ tab, paneId }` as props. `tab.metadata` contains whatever you passed to `open()`.

### api.commands

```tsx
api.commands.register("say-hello", () => {
  api.ui.showNotification("Hello!", "info");
});

// Execute another plugin's command
api.commands.execute("other-plugin.some-command");
```

### api.fs

```tsx
const content = await api.fs.readFile("/path/to/file.txt");
await api.fs.writeFile("/path/to/file.txt", "new content");
```

### api.shell

Run system commands and spawn long-running processes. This is how plugins interact with native tools (databases, compilers, CLIs, etc.).

**Execute and wait:**

```tsx
const result = await api.shell.execute("sqlite3", ["mydb.db", "SELECT * FROM users;"]);
console.log(result.stdout);
console.log(result.code); // 0 = success
```

**Spawn a long-running process:**

```tsx
const proc = await api.shell.spawn("node", ["server.js"], { cwd: "/my/project" });

proc.onStdout((line) => console.log(line));
proc.onStderr((line) => console.error(line));
proc.onExit((code) => console.log("exited:", code));

await proc.write("some input\n");
await proc.kill();
```

Spawned processes are automatically killed when a plugin is deactivated.

### api.events

Pub/sub event bus shared across all plugins.

```tsx
// Emit
api.events.emit("my-plugin:data-updated", { rows: [...] });

// Listen
api.events.on("other-plugin:something-happened", (data) => {
  console.log(data);
});
```

Subscriptions are automatically cleaned up on deactivation.

### api.ui

```tsx
api.ui.showNotification("Done!", "success"); // "info" | "error" | "success"
```

## Disposables

Every `register` and `on` method returns a `{ dispose() }` handle. Call it to unregister early. You don't need to call dispose in `deactivate()` — cleanup is automatic.

## Publishing to the marketplace

The curated registry lives in `src/plugins/registry.json`. To list your plugin, submit a PR adding an entry:

```json
{
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "What it does.",
  "author": "your-github-username",
  "download": "https://github.com/you/your-plugin/releases/download/v1.0.0/plugin.zip",
  "homepage": "https://github.com/you/your-plugin"
}
```

The archive should contain `manifest.json` and `dist/index.js` at the root.
