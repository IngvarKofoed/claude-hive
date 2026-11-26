# Frontend styling runs on design tokens, and the mockup is the look

The look is set by the mockup saved in `docs/mockups/`. The frontend keeps every raw style value in
`tokens.css` as role-named CSS custom properties, and components use CSS Modules with no inline
styles, so the app can be restyled by changing token values alone.

## Detail
- Rejected copying the mockup's markup: its inline styles exist because the design tool edits them
  that way, and the `.dc.html` files only render on the design canvas.
- Tokens are named by role (`--color-needs-you-bg`), never by look (`--orange-100`), so a restyle
  changes values and never names.
- The starting token values in `docs/mockups/README.md` were checked: every text and background pair
  passes 4.5:1 contrast.
