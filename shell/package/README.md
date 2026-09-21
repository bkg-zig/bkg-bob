# Bob Shell

Bob in your terminal.

## Install

Download the latest `.tgz` package and install globally.

#### npm

```bash
npm i -g bobshell-x.x.x.tgz
```

#### yarn

```bash
yarn global add ./bobshell-x.x.x.tgz
```

#### pnpm

```bash
pnpm i -g "$(pwd)/bobshell-x.x.x.tgz"
```

## Authentication

Bob Shell authenticates via an API key or SSO.

**API key** — set the `BOB_API_KEY` environment variable:

```bash
export BOB_API_KEY="your-key"
```

**SSO** — run the `bob chat` command and follow the login prompt in your browser.

## Usage

```
bob [options] [command] [prompt...]

Options:
  -v, --version              Show current version number
  -p, --prompt <prompt>      Prompt to send to the agent
  --resume [task-id]         Open the resume picker, or resume a specific task id
  -h, --help                 display help for command

Commands:
  chat [options]             Launch the interactive terminal UI client
  run [options] [prompt...]  Execute a single task in headless mode
  mcp                        Manage MCP server configurations
```

**Run a single task:**

```bash
bob run -p "What are the top-level directories in this workspace?"
```

**Launch interactive chat:**

```bash
bob chat
```

**Resume the latest task:**

```bash
bob --resume latest
```

### Editor integration (ACP)

`bob acp` runs Bob Shell as an [Agent Client Protocol](https://agentclientprotocol.com) server, so ACP clients like Zed can drive Bob from their agent panel:

```json
{
    "agent_servers": {
        "Bob": {
            "command": "bob",
            "args": ["acp"]
        }
    }
}
```

See [ACP.md](./ACP.md) for authentication, permissions, supported features, and flags.

### `run` options

| Option                           | Description                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `-p, --prompt <text>`            | Prompt to send to the agent                                                   |
| `-w, --workspace <path>`         | Workspace directory (default: current directory)                              |
| `--mode <mode>`                  | Mode to use: `agent`, `ask`, `plan`, or a custom mode slug (default: `agent`) |
| `-f, --format <format>`          | Output format: `pretty`, `json`, or `stream-json` (default: `pretty`)         |
| `-r, --resume [task-id]`         | Open the resume picker, or resume a specific task ID                          |
| `--max-turns <n>`                | Maximum number of turns                                                       |
| `--max-cost <n>`                 | Maximum total cost in USD                                                     |
| `--log-level <level>`            | Log level: `debug`, `info`, `warn`, `error`, `silent`                         |
| `--disable-mcp`                  | Disable MCP server initialization                                             |
| `--disable-subagents`            | Disable subagent tool registration                                            |
| `--disable-tool-groups <groups>` | Disable specific tool groups (comma-separated, e.g. `subagent,mcp`)           |
| `--team-id <id>`                 | Team ID — required when using a general-type API key                          |
| `--trust`                        | Mark the current folder as trusted                                            |
| `--accept-license`               | Accept the IBM license agreement non-interactively                            |

### `chat` options

| Option                           | Description                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `-w, --workspace <path>`         | Workspace directory (default: current directory)                              |
| `--mode <mode>`                  | Mode to use: `agent`, `ask`, `plan`, or a custom mode slug (default: `agent`) |
| `--instance-id <id>`             | Pre-select an instance for the session                                        |
| `--auto-approve`                 | Automatically approve all tool executions without prompting                   |
| `-r, --resume [task-id]`         | Open the resume picker, or resume a specific task ID                          |
| `--max-turns <n>`                | Maximum number of turns                                                       |
| `--max-cost <n>`                 | Maximum total cost in USD                                                     |
| `--log-level <level>`            | Log level: `debug`, `info`, `warn`, `error`, `silent`                         |
| `--disable-mcp`                  | Disable MCP server initialization                                             |
| `--disable-subagents`            | Disable subagent tool registration                                            |
| `--disable-tool-groups <groups>` | Disable specific tool groups (comma-separated, e.g. `subagent,mcp`)           |
| `--team-id <id>`                 | Team ID — required when using a general-type API key                          |
| `--trust`                        | Mark the current folder as trusted                                            |
| `--accept-license`               | Accept the IBM license agreement non-interactively                            |

## Configuration

Defaults are stored in `~/.bob/settings/settings.json`. CLI arguments override these values.

```json
{
    "session": {
        "defaultMode": "agent",
        "maxTurns": 100,
        "maxCost": 0,
        "mcp": true,
        "subagents": true,
        "autoCompact": true,
        "limitWarnings": false,
        "respectGitIgnore": false,
        "maxReadFile": 500
    },
    "approval": {
        "autoApprovalEnabled": true,
        "outsideWorkspaceAllowed": false,
        "allowed_permissions": ["read"],
        "allowedExecutors": [
            {
                "toolId": "execute_command",
                "approvedCommands": ["cat", "git diff", "git log", "ls"],
                "deniedCommands": []
            }
        ]
    },
    "logging": {
        "logLevel": "info",
        "enableFileLogging": false
    },
    "security": {
        "folderTrust": {
            "enabled": true
        }
    },
    "tasks": {
        "retentionDays": 30
    },
    "telemetry": {
        "enabled": true,
        "excludePayload": false
    },
    "bobShell": {
        "autoUpdate": true
    }
}
```

| Key                                | Default    | Description                                                 |
| ---------------------------------- | ---------- | ----------------------------------------------------------- |
| `session.defaultMode`              | `"agent"`  | Default mode: `agent`, `ask`, `plan`, or a custom mode slug |
| `session.maxTurns`                 | `100`      | Maximum agentic turns per task. `0` = unlimited             |
| `session.maxCost`                  | `0`        | Maximum cost per task in USD. `0` = unlimited               |
| `session.mcp`                      | `true`     | Enable MCP server integration                               |
| `session.subagents`                | `true`     | Enable subagent tool registration                           |
| `session.autoCompact`              | `true`     | Automatically compact context when the limit is approached  |
| `session.limitWarnings`            | `false`    | Warn before the turn/cost limit is reached                  |
| `session.respectGitIgnore`         | `false`    | Exclude `.gitignore`d files from file tools                 |
| `session.maxReadFile`              | `500`      | Maximum lines returned by read-file tool                    |
| `approval.autoApprovalEnabled`     | `true`     | Auto-approve tool calls without prompting                   |
| `approval.outsideWorkspaceAllowed` | `false`    | Allow tools to operate outside the workspace directory      |
| `approval.allowed_permissions`     | `["read"]` | Permission groups auto-approved without prompting           |
| `approval.allowedExecutors`        | see above  | Per-tool command allow/deny lists for `execute_command`     |
| `logging.logLevel`                 | `"info"`   | Log level: `debug`, `info`, `warn`, `error`, `silent`       |
| `logging.enableFileLogging`        | `false`    | Write logs to a file in addition to the console             |
| `security.folderTrust.enabled`     | `true`     | Require explicit trust before running in a folder           |
| `tasks.retentionDays`              | `30`       | Task retention in days. `0` disables cleanup                |
| `telemetry.enabled`                | `true`     | Send anonymous usage telemetry                              |
| `telemetry.excludePayload`         | `false`    | Exclude prompt/response content from telemetry              |
| `bobShell.autoUpdate`              | `true`     | Automatically apply updates on startup                      |
