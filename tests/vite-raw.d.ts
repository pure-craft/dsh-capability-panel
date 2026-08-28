/**
 * Vite's `?raw` import suffix, declared for `tsc`.
 *
 * The composition test reads `cordis.patch.yml` as text to assert the bundle
 * row it declares. Vite resolves the suffix at transform time; `tsc` needs this
 * declaration to typecheck the same import.
 */
declare module '*?raw' {
  const content: string;
  export default content;
}
