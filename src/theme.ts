// Single source of truth for visual constants (THEME_POLISH.md §2, gate passed
// 2026-07-29). Plain constants on purpose: one theme, no runtime switching, so a
// provider/hook would be indirection with no payoff — screens import values the
// same way they import a function.

export const color = {
  // brand
  brand: "#1565C0", // primary actions, header accent, links
  // semantic — the app's real information channel
  success: "#2E7D32", // pass results, synced badge
  danger: "#C0392B", // fail results, error text
  neutral: "#616161", // N/A fills — visibly "answered" without reading good or bad
  // text
  ink: "#1A1A1A", // primary text, stat values
  text: "#666666", // secondary text (addresses, notes, dates)
  muted: "#999999", // placeholders, pending badge, empty states
  label: "#888888", // uppercase section/overline labels
  onFill: "#FFFFFF", // text on brand/semantic fills
  // surfaces
  card: "#FFFFFF",
  screen: "#F2F2F7", // screen background — cards pop instead of white-on-white
  border: "#DDDDDD",
  disabled: "#CCCCCC",
} as const;

// The spacing scale. Existing off-scale paddings/margins were left as literals
// rather than silently resized — normalizing them is a deliberate visual change
// for a future ticket, not part of the zero-diff token sweep.
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export const radius = { card: 12 } as const;

export const font = {
  title: 20, // screen/item headings
  emphasis: 16, // card titles, header link
  body: 15, // labels, buttons, inputs
  note: 14, // notes, error/status lines
  secondary: 13, // addresses, dates, overlines
  caption: 12, // badges, tile labels
  stat: 22, // count-tile values
} as const;
