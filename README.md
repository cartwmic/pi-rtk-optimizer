# pi-rtk-optimizer

RTK rewrite + output compaction extension for the Pi coding agent.

`pi-rtk-optimizer` rewrites supported `bash` tool commands to `rtk` equivalents and compacts noisy `tool_result` output (`bash`, `read`, `grep`) to reduce context/token usage while preserving actionable information.

![background](asset/pi-rtk-optimizer-background.png)

## Features

- Command rewrite/suggestion mode for common dev workflows (`git`, `gh`, `cargo`, `npm`, `pytest`, `go`, `docker`, etc.)
- Runtime guard when `rtk` binary is unavailable
- Output compaction pipeline:
  - ANSI stripping
  - build/test/linter/git/search summarization
  - source-code filtering (`none`, `minimal`, `aggressive`)
  - smart truncation + hard truncation
- Interactive TUI settings modal via `/rtk`
- `/rtk` command completions and utility subcommands (`show`, `verify`, `stats`, `reset`, ...)
- Session metrics for compaction savings

## Installation

### Local extension folder

Place this folder in:

- Global: `~/.pi/agent/extensions/pi-rtk-optimizer`
- Project: `.pi/extensions/pi-rtk-optimizer`

Pi auto-discovers these paths.

### As an npm package

```bash
pi install npm:pi-rtk-optimizer
```

Or from git:

```bash
pi install git:github.com/MasuRii/pi-rtk-optimizer
```

## Usage

Open settings modal:

```text
/rtk
```

Subcommands:

```text
/rtk show
/rtk path
/rtk verify
/rtk stats
/rtk clear-stats
/rtk reset
/rtk help
```

## Configuration

Runtime config is stored at:

```text
~/.pi/agent/extensions/pi-rtk-optimizer/config.json
```

A starter file is included as:

```text
config/config.example.json
```

Values are normalized/clamped on load and save to prevent invalid runtime state.

## Development

```bash
npm run build
npm run lint
npm run test
npm run check
```

## Project Layout

- `index.ts` - root Pi auto-discovery entrypoint
- `src/index.ts` - extension bootstrap/event wiring
- `src/config-modal.ts` - `/rtk` settings modal + command handler
- `src/config-store.ts` - config normalization/load/save
- `src/command-rewriter.ts` - command tokenization and rewrite decisions
- `src/rewrite-rules.ts` - rewrite rule catalog
- `src/output-compactor.ts` - tool-result compaction pipeline
- `src/output-metrics.ts` - savings tracking/reporting
- `src/windows-command-helpers.ts` - Windows bash compatibility helpers
- `src/techniques/*` - focused compaction techniques
- `src/zellij-modal.ts` - bundled modal primitives used by settings UI
- `config/config.example.json` - starter config template

## Credits

This extension was built with inspiration from:

- [`mcowger/pi-rtk`](https://github.com/mcowger/pi-rtk)
- [`rtk-ai/rtk`](https://github.com/rtk-ai/rtk)

## License

MIT
