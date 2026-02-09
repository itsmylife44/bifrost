import type { Plugin } from "@opencode-ai/plugin";
import { bifrostManager } from "./manager";
import { bifrost_connect } from "./tools/connect";
import { bifrost_exec } from "./tools/exec";
import { bifrost_status } from "./tools/status";
import { bifrost_disconnect } from "./tools/disconnect";
import { bifrost_upload } from "./tools/upload";
import { bifrost_download } from "./tools/download";

const Bifrost: Plugin = async (ctx) => {
  // Cleanup stale sockets on plugin init
  bifrostManager.cleanup();

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
      // On session end → auto-disconnect
      if (input.event.type === "session.deleted") {
        await bifrostManager.disconnect();
      }
    },
    "experimental.chat.system.transform": async (input, output) => {
      output.system.push(`## Bifrost SSH Plugin — Remote Server Access

You have access to a remote server via persistent SSH connection. The server is pre-configured in ~/.config/opencode/bifrost.json.

### Available Tools
- \`bifrost_connect\` — Establish persistent SSH connection (call once per session)
- \`bifrost_exec\` — Execute any command on the remote server
- \`bifrost_status\` — Check connection status
- \`bifrost_disconnect\` — Close the connection
- \`bifrost_upload\` — Upload a local file to the remote server
- \`bifrost_download\` — Download a file from the remote server

### When to Use
Automatically use these tools when the user:
- Mentions "server", "remote", "deploy", "production", "staging", "VPS", "Hetzner"
- Asks to test something "on the server" or "remotely"
- Wants to install, configure, or check something on the remote machine
- Asks about server status, logs, or running processes
- Wants to transfer files to/from the server

### Workflow
1. Call \`bifrost_connect\` to establish the connection (only needed once, it persists)
2. Use \`bifrost_exec\` to run commands (e.g., \`bifrost_exec({command: "docker ps"})\`)
3. Use \`bifrost_upload\`/\`bifrost_download\` for file transfers
4. The connection auto-disconnects when the session ends

### Important
- Do NOT use raw \`ssh\` commands — always use bifrost tools
- The connection is persistent — you don't need to reconnect for each command
- If you get a connection error, try \`bifrost_connect\` again (it auto-reconnects)`);
    },
  };
};

export default Bifrost;
