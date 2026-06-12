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
