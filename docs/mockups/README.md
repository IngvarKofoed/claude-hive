# Mockups

The look of Claude Hive, designed as a clickable canvas: https://claude.ai/artifact/7Do6G3RzA6hBvrwt68ESC7. The link is private until it's shared from the page's Share menu.

| File | Screen |
| --- | --- |
| `Main.dc.html` | Board |
| `BoardByProject.dc.html` | Board, by project: a panel per project, with the lane on each card |
| `ForYou.dc.html` | For you |
| `CardRefine.dc.html` | A card in Refine: chat with the product owner, next to the brief |
| `CardMockup.dc.html` | A card in Mockup: two versions with pinned comments |
| `CardTryIt.dc.html` | A card in Try it: test guide, checks, decisions made for you, feedback |
| `CardDone.dc.html` | A card in Done: lane history and everything that happened |
| `canvas.json` | The canvas layout |

These files use the design tool's own format (`.dc.html`). They render on the canvas, not on their own in a browser. They are a reference for the look, not code to copy:

- **Their styles are inline** because the design tool edits them that way. The real frontend follows the CSS rules in `ARCHITECTURE.md`, under Frontend.
- **The cards and app screens in them are made-up examples.**

## Design Tokens

These are the starting values for `packages/frontend/src/styles/tokens.css`, taken from the mockup. Names describe the role; restyling changes only the values.

### Colors

| Token | Value | Used for |
| --- | --- | --- |
| `--color-page` | `#F6F6F3` | Page background |
| `--color-surface` | `#FFFFFF` | Panels, card tiles, header |
| `--color-surface-muted` | `#EFEFEA` | Active nav item, finished lane steps, quiet chips |
| `--color-surface-hands-off` | `#F7F7F4` | Hands-off lane cells on the board |
| `--color-border` | `#E4E3DE` | Panel and card borders, dividers |
| `--color-border-strong` | `#D6D5CF` | Buttons, inputs, clickable card tiles |
| `--color-text` | `#1B1B18` | Body text |
| `--color-text-secondary` | `#45443E` | Nav, labels |
| `--color-text-muted` | `#5F5E57` | Meta lines, timestamps, hints |
| `--color-text-subtle` | `#6B6A63` | Lanes not reached yet |
| `--color-link` | `#1849A9` | Links |
| `--color-link-hover` | `#0E3378` | Links on hover |
| `--color-primary-bg` | `#1B1B18` | Primary buttons, your chat bubbles |
| `--color-primary-text` | `#FFFFFF` | Text on primary |
| `--color-accent` | `#C2410C` | The For you count, comment pins |
| `--color-needs-you-bg` / `-text` | `#FDEBDD` / `#8F3A06` | ● needs you |
| `--color-working-bg` / `-text` | `#E6EEFC` / `#1849A9` | ▶ working |
| `--color-versions-bg` / `-text` | `#E2F3F0` / `#0B5F58` | ◆ versions to compare, changes highlighted in the brief |
| `--color-stopped-bg` / `-text` / `-border` | `#FBE4E1` / `#9B1C12` / `#F0C7C1` | ■ stopped, severe issues |
| `--color-done-bg` / `-text` | `#E3F1E7` / `#1F6B3A` | ✓ done |

Every text and background pair above passes 4.5:1 contrast. Each status also has its own symbol (● ▶ ◆ ■ ✓), so none is told apart by color alone.

### Type

| Token | Value |
| --- | --- |
| `--font-ui` | `Inter, system-ui, sans-serif` (weights 400, 500, 600, 700) |
| `--font-mono` | `'JetBrains Mono', monospace`, for paths, ports, branches and commit hashes |
| `--text-xs` … `--text-2xl` | 11, 12, 13, 14 (body), 15, 18, 22 (page title), 24 (card title) px |

### Shape and Space

| Token | Value |
| --- | --- |
| `--radius-sm` | 6px: chips, inputs |
| `--radius-md` | 8px: buttons, card tiles |
| `--radius-lg` | 12px: panels |
| `--radius-pill` | 999px: badges, pills |
| `--space-1` … `--space-8` | 4, 6, 8, 10, 12, 16, 20, 24 px |
| `--shadow-tile` | `0 1px 2px rgba(27, 27, 24, 0.06)` |
| `--target-min` | 44px: the smallest clickable height |
