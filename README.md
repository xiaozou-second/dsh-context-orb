# Context orb

A floating orb above the composer in DeepSeek Harness Web. It shows the current session's context window as a green wave with a white percentage.

- The wave height and the number are the share of the window in use. The green deepens as the window fills.
- The orb follows the session you switch to.
- **Click** opens a breakdown: system prompt, tool schemas and messages, with tokens used / total and the room left.
- **Double-click** runs the Host's `/compact`. While it runs, a strip above the input shows the compacting state, then the released tokens and the new window.
- **Drag** to move it; the position is kept per browser. Arrow keys nudge, Home resets.

## Install

```bash
dsh plugin --profile web add link:/path/to/context-orb
```

Then enable the **Context orb** bundle on the Plugins page.

To add the row by hand in the profile's `cordis.patch.yml`:

```yaml
- id: context-orb
  name: '@xiaozou-wine/context-orb'
```

Requires DeepSeek Harness `>=0.2.2-rc.1` and Node.js `>=24.9.0`.

## How it works

- The browser half registers into `conversation.input.overlay` (orb and panel) and `conversation.input.dock` (compacting strip). Both are session-scoped, so a session switch starts from that session's own reading.
- Readings come from the Host's `contextPressure` and `contextBreakdown` projections, the same ones behind the built-in context meter.
- Double-click calls the Host's `/compact` command. The orb and the strip share a small per-session store instead of remounting each other.
- A dragged position is stored in `localStorage` under `contextOrb.position.v1`. The Host half is an empty row; all code runs in the browser bundle.

## Limits

- `/compact` only runs while the session is idle. A busy session is reported, not queued.
- Context readings are the Host's estimates and update as the window changes.

## License

MIT
