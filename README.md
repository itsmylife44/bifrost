# Bifrost

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.x-orange.svg)](https://bun.sh/)

Persistent SSH connection plugin for [OpenCode](https://github.com/opencode-ai/opencode).

Bifrost maintains a single SSH connection using ControlMaster multiplexing, so every command reuses the same connection instead of reconnecting each time.

![Bifrost Demo](assets/demo.gif)

## Installation

### 1. Register the plugin

Add to your `~/.config/opencode/opencode.json`:

```json
{
  "plugins": [
    "github:itsmylife44/bifrost"
  ]
}
```

### 2. Create the SSH config

Create `~/.config/opencode/bifrost.json`:

```json
{
  "host": "your-server-ip",
  "user": "root",
  "keyPath": "~/.ssh/id_rsa"
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `host` | Yes | - | Server IP or hostname |
| `user` | No | `root` | SSH username |
| `keyPath` | Yes | - | Path to SSH private key |
| `port` | No | `22` | SSH port |

> **Note:** Password authentication is not supported. Use SSH keys only.

### 3. Restart OpenCode

The plugin is installed automatically on startup.

## Usage

Once configured, the agent automatically uses Bifrost when you mention:
- "server", "remote", "deploy", "production", "staging"
- "check the server", "run on server", "server logs"

### Available Tools

| Tool | Description |
|------|-------------|
| `bifrost_connect` | Establish SSH connection (called automatically) |
| `bifrost_exec` | Run a command on the server |
| `bifrost_status` | Check connection status |
| `bifrost_disconnect` | Close the connection |
| `bifrost_upload` | Upload a file to the server |
| `bifrost_download` | Download a file from the server |

### Example Prompts

```
"How's the server doing?"
"Show me the nginx logs"
"Restart the docker containers"
"Upload config.yaml to /etc/app/"
"What's using port 8080?"
```

## How It Works

Bifrost uses SSH ControlMaster to maintain a persistent connection:

```
First command:  [Connect] -----> [Execute] -----> [Keep socket open]
Next commands:  [Reuse socket] -> [Execute] -----> [Still open]
Session ends:   [Auto-disconnect]
```

The control socket is stored at `~/.ssh/bifrost-control/`.

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
