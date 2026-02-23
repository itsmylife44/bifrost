import type { Plugin } from "@opencode-ai/plugin";
import { bifrostRegistry } from "./registry";
import { bifrost_connect } from "./tools/connect";
import { bifrost_exec } from "./tools/exec";
import { bifrost_status } from "./tools/status";
import { bifrost_disconnect } from "./tools/disconnect";
import { bifrost_upload } from "./tools/upload";
import { bifrost_download } from "./tools/download";

function buildServerListPrompt(): string {
  const servers = bifrostRegistry.listServers();
  if (servers.length === 0) return "";

  const lines = servers.map((s) => {
    const flags: string[] = [];
    if (s.isDefault) flags.push("default");
    if (s.isActive) flags.push("active");
    const flagStr = flags.length > 0 ? ` (${flags.join(", ")})` : "";
    const stateStr = s.state === "connected" ? "Connected" : "Disconnected";
    return `- **${s.name}**${flagStr}: ${s.user}@${s.host}:${s.port} [${stateStr}]`;
  });

  return `\n\n### Available Servers\n${lines.join("\n")}`;
}

const Bifrost: Plugin = async () => {
  return {
    tool: {
      bifrost_connect,
      bifrost_exec,
      bifrost_status,
      bifrost_disconnect,
      bifrost_upload,
      bifrost_download,
    },
    event: async (input) => {
      if (input.event.type === "session.deleted") {
        await bifrostRegistry.disconnect();
      }
    },
    "experimental.chat.system.transform": async (_input, output) => {
      const serverList = buildServerListPrompt();

      output.system.push(`## Bifrost SSH Plugin — Remote Server Access

You have access to remote servers via persistent SSH connections. Servers are configured in ~/.config/opencode/bifrost.json. Works cross-platform (macOS, Linux, Windows).

### Available Tools
- \`bifrost_connect\` — Establish persistent SSH connection (call once per session). Pass \`server\` param to connect to a specific server.
- \`bifrost_exec\` — Execute any command on a remote server. Pass \`server\` param to target a specific server.
- \`bifrost_status\` — Check connection status of all servers
- \`bifrost_disconnect\` — Close connection(s). Pass \`server\` param for a specific server, or omit to disconnect all.
- \`bifrost_upload\` — Upload a local file to a remote server
- \`bifrost_download\` — Download a file from a remote server

### When to Use
Automatically use these tools when the user:
- Mentions "server", "remote", "deploy", "production", "staging", "VPS", "Hetzner"
- Asks to test something "on the server" or "remotely"
- Wants to install, configure, or check something on the remote machine
- Asks about server status, logs, or running processes
- Wants to transfer files to/from the server

### Workflow
1. Call \`bifrost_connect\` **without arguments** to establish the connection (config path is auto-detected — do NOT pass configPath manually)
2. Use \`bifrost_exec\` to run commands (e.g., \`bifrost_exec({command: "docker ps"})\`)
3. To target a specific server: \`bifrost_exec({command: "docker ps", server: "hetzner"})\`
4. Use \`bifrost_upload\`/\`bifrost_download\` for file transfers
5. The connection auto-disconnects when the session ends

### Important
- Do NOT use raw \`ssh\` commands — always use bifrost tools
- The connection is persistent — you don't need to reconnect for each command
- If you get a connection error, try \`bifrost_connect\` again (it auto-reconnects)
- When multiple servers are configured, pass the \`server\` parameter to target a specific one${serverList}`);
    },
  };
};

export default Bifrost;
