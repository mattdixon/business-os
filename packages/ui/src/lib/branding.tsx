import { createContext, useContext, type ReactNode } from 'react';

/**
 * Per-install branding. Optional; the framework renders a generic "Business
 * OS" header when nothing's provided. Each client shell can pass a
 * `branding` object to `createOperatorApp` to get its own name + logo in
 * the operator UI shell.
 *
 * Long-term these values come from `system_settings` (scope:
 * `framework:branding`) once that UI ships. For now the client shell
 * passes literals at build time.
 */
export interface Branding {
  /**
   * What this install is — e.g. "C&M Construction". Renders at the top of
   * the sidebar, with "Business OS" demoted to a subtitle.
   */
  businessName: string;
  /**
   * URL to a logo image. Resolved by the browser, so a same-origin path
   * (e.g. `/logo.png` served from the Vite `public/` dir) works without
   * any framework changes.
   */
  logoUrl?: string;
  /**
   * The logo's own ink color, for single-color (monochrome) logos. When set,
   * the framework keeps the header on the normal theme background and flips
   * the logo with a CSS `invert()` filter so it always contrasts:
   *
   * - `'light'` — a white/light logo. Inverted to dark in light mode; left
   *   light in dark mode.
   * - `'dark'` — a black/dark logo. Left dark in light mode; inverted to
   *   light in dark mode.
   *
   * Only use this for monochrome logos — `invert()` hue-shifts multi-color
   * artwork. For those, use `headerBackground` instead. When omitted, the
   * logo renders as-is on the theme background.
   */
  logoTone?: 'light' | 'dark';
  /**
   * Force the sidebar header section (logo + name + subtitle) to a fixed
   * background regardless of the user's theme. Useful when the logo is
   * multi-color and only reads against one background (so `logoTone`'s
   * invert trick won't work). When omitted, the header inherits the theme
   * background.
   *
   * - `'dark'` — dark background + light text in both light and dark mode.
   * - `'light'` — light background + dark text in both modes.
   */
  headerBackground?: 'dark' | 'light';
}

const Ctx = createContext<Branding | null>(null);

export function BrandingProvider({
  value,
  children,
}: {
  value: Branding | null;
  children: ReactNode;
}): JSX.Element {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBranding(): Branding | null {
  return useContext(Ctx);
}
