# Bifrost

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.x-orange.svg)](https://bun.sh/)

Multi-server persistent SSH connection plugin for [OpenCode](https://github.com/opencode-ai/opencode).

Bifrost maintains persistent SSH connections to one or more servers using the [ssh2](https://github.com/mscdex/ssh2) library (pure JavaScript), so every command reuses the same connection instead of reconnecting each time. Works cross-platform on macOS, Linux, and Windows.

![Bifrost Demo](assets/demo.gif)

## Installation

### 1. Register the plugin

Add to your `~/.config/opencode/opencode.json`:

```json
{
  "plugins": [
    "opencode-bifrost@latest"
  ]
}
```

### 2. Create the SSH config

Create `~/.config/opencode/bifrost.json`:

#### Single server (simplest)

```json
{
  "host": "your-server-ip",
  "user": "root",
  "keyPath": "~/.ssh/id_rsa"
}
```

#### Multiple servers

```json
{
  "servers": {
    "production": {
      "host": "192.168.1.100",
      "keyPath": "~/.ssh/prod_key"
    },
    "staging": {
      "host": "10.0.0.5",
      "user": "deploy",
      "port": 2222
    },
    "dev": "root@dev.example.com:2222"
  },
  "default": "production"
}
```

#### Minimal config (with key discovery)

When `keyPath` is omitted, Bifrost automatically finds and tries SSH keys from `~/.ssh/`:

```json
{
  "servers": {
    "myserver": { "host": "192.168.1.100" }
  }
}
```

Bifrost scans `~/.ssh/` for private keys and tries them in order: `id_ed25519` → `id_ecdsa` → `id_rsa` → `id_dsa` → others alphabetically.

### 3. Restart OpenCode

The plugin is installed automatically on startup.

## Configuration Reference

### Server fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `host` | Yes | - | Server IP or hostname |
| `user` | No | `root` | SSH username |
| `keyPath` | No | auto-discovered | Path to SSH private key (supports `~`) |
| `port` | No | `22` | SSH port |
| `connectTimeout` | No | `10` | Connection timeout in seconds |
| `serverAliveInterval` | No | `30` | Keepalive interval in seconds |

### Multi-server fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `servers` | Yes | - | Map of server name → config object or shorthand string |
| `default` | No | first server | Name of the default server |
| `keyDiscovery` | No | `true` | Auto-discover SSH keys from `~/.ssh/` |

### String shorthand

Servers can be defined as strings instead of objects:

| Shorthand | Equivalent |
|-----------|------------|
| `"192.168.1.100"` | `{ "host": "192.168.1.100", "user": "root", "port": 22 }` |
| `"deploy@10.0.0.5"` | `{ "host": "10.0.0.5", "user": "deploy", "port": 22 }` |
| `"deploy@10.0.0.5:2222"` | `{ "host": "10.0.0.5", "user": "deploy", "port": 2222 }` |

### Backward compatibility

The old single-server format still works:

```json
{
  "host": "your-server-ip",
  "user": "root",
  "keyPath": "~/.ssh/id_rsa"
}
```

It's automatically treated as a single server named `"default"`.

> **Note:** Password authentication is not supported. Use SSH keys only.

## Usage

Once configured, the agent automatically uses Bifrost when you mention:
- "server", "remote", "deploy", "production", "staging"
- "check the server", "run on server", "server logs"

### Available Tools

| Tool | Description |
|------|-------------|
| `bifrost_connect` | Establish SSH connection. Pass `server` to target a specific one. |
| `bifrost_exec` | Run a command on a server. Pass `server` to target a specific one. |
| `bifrost_status` | Show status of all configured servers |
| `bifrost_disconnect` | Close connection(s). Pass `server` for one, or omit for all. |
| `bifrost_upload` | Upload a file to a server |
| `bifrost_download` | Download a file from a server |

### Example Prompts

```
"How's the server doing?"
"Show me the nginx logs on production"
"Restart docker on staging"
"Upload config.yaml to /etc/app/ on production"
"Check disk space on all servers"
```

### Multi-server examples

```
"Connect to staging and check the logs"
"Run docker ps on production"
"Upload the config to the dev server"
```

The agent automatically passes the `server` parameter based on context.

## Key Discovery

When a server has no `keyPath` configured and `keyDiscovery` is enabled (default), Bifrost automatically scans `~/.ssh/` for private keys.

Discovery rules:
- Looks for files starting with `-----BEGIN` (actual private key files)
- Skips `.pub` files, `known_hosts`, `config`, `authorized_keys`
- On macOS/Linux: only uses keys with secure permissions (`600` or `400`)
- Tries keys in priority order: `id_ed25519` → `id_ecdsa` → `id_rsa` → `id_dsa` → rest alphabetically

To disable: set `"keyDiscovery": false` in your config.

## How It Works

Bifrost uses [ssh2](https://github.com/mscdex/ssh2) to maintain persistent SSH connections in-process:

```
First command:  [Connect] -----> [Execute] -----> [Keep connection open]
Next commands:  [Reuse conn] --> [Execute] -----> [Still open]
Session ends:   [Auto-disconnect all]
```

With multiple servers, each gets its own persistent connection managed independently.

## Security

All inputs are validated before execution to prevent injection attacks:

- **Path traversal** (`../`) blocked
- **Command injection** (`;`, `|`, `&`, `` ` ``, `$()`) blocked
- **Shell expansion** (`*`, `?`, `~`, `{}`) blocked
- **Unicode bypass attempts** detected and rejected
- **Null bytes** and control characters rejected

## Requirements

- OpenCode with plugin support
- SSH key-based authentication

## Development

```bash
# Run tests
bun test

# Type check
bun run typecheck

# Build
bun run build
```

## License

MIT
