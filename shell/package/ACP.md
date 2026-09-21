# Bob Shell as an ACP Agent

`bob acp` starts Bob Shell as an [Agent Client Protocol](https://agentclientprotocol.com) server over stdio. Any ACP client (e.g. the Zed editor) can spawn it and drive Bob sessions from the editor UI.

## Quick start (Zed)

Add to Zed's `settings.json`:

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

Open the Agent panel, pick **Bob**, and start a thread.

## Authentication

- With the provider's API key environment variable, no login is needed.
- Otherwise Bob uses SSO. The first `session/new` fails with `auth_required`; the editor shows an **Authenticate** action that opens your browser. Tokens are stored, so this is a one-time step per machine.
- Headless/SSH: the login URL is logged to stderr. Run with `--log-level info` and check the editor's agent server logs to copy it.

## Flags

| Flag                  | Description                                                     |
| --------------------- | --------------------------------------------------------------- |
| `--log-level <level>` | `debug`, `info`, `warn`, `error`, `silent` (or `BOB_LOG_LEVEL`) |
| `--trust`             | Trust each workspace opened by the ACP server                   |
| `--auto-approve`      | Skip all permission prompts and approve every tool call         |
| `--disable-mcp`       | Disable MCP server initialization                               |
| `--disable-subagents` | Disable subagent tool registration                              |
| `--accept-license`    | Accept the license before starting the ACP server               |

Run `bob --show-license acp` to show the license file paths and exit.

## Permissions

Read-only tools run without prompting. Every other tool call asks the client for permission with four options: **Allow once**, **Always allow**, **Reject**, **Always reject**. "Always" decisions are remembered for the rest of the session, keyed by tool name. `--auto-approve` disables prompting entirely.

## Features

- **Session history** — compatible clients can list Bob's existing file-based sessions, page through recent history, and delete sessions from the shared Bob store.
- **Live session titles** — clients receive title and last-activity updates after successful prompt turns.
- **Session resume** — `session/resume` restores a thread without replaying already-visible messages; `session/load` remains available for clients that need full history replay, including tool calls, diffs, and the last plan state.
- **Inline diffs** — file edits stream as diff content with file locations, so editors can render diffs and follow the agent.
- **Plan panel** — Bob's todo list updates stream as ACP plan updates.
- **Image prompts** — pasted images are forwarded to the model.
- **Client MCP servers** — MCP servers configured in the editor (stdio, HTTP, or SSE) are registered into the session.

## Caveats

- Each ACP session runs its own Bob harness, including its configured MCP servers.
- Model selection (`session/set_model`) is not supported; use modes instead.
- Bob executes commands in its own shell; ACP client terminals are not used.
