# ADR-0015: Factory Console with pw_console Custom Plugins

**Status:** Accepted

**Date:** 2026-02-13

**Applies to:** `tools/factory_console.py`, `tools/factory_test_pane.py`

## Context

The factory test workflow requires an interactive TUI checklist where an operator steps through hardware tests (LEDs, display, secrets provisioning) — confirming visual tests with a keypress and auto-running automated checks. The standard pw_console (via `pw_system.console.main()`) provides log viewing and a Python REPL but has no hook for adding custom window panes.

ADR-0011 established `pw_system.console.main()` as the pattern for console integration. However, `pw_system.console.main()` creates `PwConsoleEmbed` internally and calls `.embed()` without exposing the instance, so there is no way to call `add_window_plugin()`.

pw_console supports `WindowPane` plugins (inheriting `WindowPane` + `PluginMixin`) that render alongside log windows and the REPL. The `PluginMixin` provides a background thread for non-blocking RPC execution while the UI thread handles rendering and key input.

## Decision

For consoles that need custom TUI panes, use `PwConsoleEmbed` directly instead of `pw_system.console.main()`. This requires manually setting up log stores and logging configuration that `pw_system.console.main()` normally handles.

### Two Console Patterns

| Pattern | When to use | Example |
|---------|-------------|---------|
| `pw_system.console.main()` | Standard consoles (logs + REPL) | `tools/console.py` (dev console) |
| `PwConsoleEmbed` directly | Consoles needing custom `WindowPane` plugins | `tools/factory_console.py` |

### Plugin Architecture

```
FactoryTestPane(WindowPane, PluginMixin)
├── FactoryTestControl(FormattedTextControl)  # rendering + keybinds
├── Window(content=control)
├── WindowPaneToolbar with ToolbarButtons
└── plugin_init(callback=_background_task, frequency=0.3s)
```

The plugin follows the `ClockPane` example from pw_console. Key aspects:

- **`PluginMixin`** runs a background task periodically. RPC calls execute there to avoid blocking the UI.
- **`FormattedTextControl`** renders the checklist and binds keyboard input.
- **UI → background bridge**: Key presses set a `_run_request` flag; the background task picks it up on the next cycle.
- **Background → UI bridge**: The background task returns `True` to trigger a UI redraw.

### Manual Setup Required

When bypassing `pw_system.console.main()`, the console script must:

1. Create `LogStore` instances and attach them to loggers
2. Create a temp log file via `pw_console.python_logging.create_temp_log_file()`
3. Call `console.setup_python_logging()` to prevent log output from corrupting the TUI
4. Call `console.add_sentence_completer()` for RPC tab-completion

## Consequences

**Pros:**

- Guided operator workflow with visual/auto test steps
- Reusable pattern for future task-specific consoles
- Background RPC execution keeps UI responsive

**Cons:**

- Manual log store setup duplicates what `pw_system.console.main()` does internally
- Shared utilities (ReconnectingSerialClient, create_connection) are duplicated between console scripts — future work to extract a common module

**Tradeoffs:**

- **Rejected patching `pw_system.console.main()`** — Adding a plugin hook upstream would be cleaner but we don't control Pigweed's API
- **Rejected standalone CLI (no TUI)** — Operators benefit from seeing test state at a glance alongside device logs

## References

- ADR-0011: pw_console with Tokenized Logging and RPC
- ADR-0009: Local Build and Flash Tooling
- [pw_console plugin documentation](https://pigweed.dev/pw_console/plugins.html)
- `third_party/pigweed/pw_console/py/pw_console/plugins/clock_pane.py` (reference implementation)
