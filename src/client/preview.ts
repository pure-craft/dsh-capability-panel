/**
 * The Host's right-sidebar navigation, as this panel uses it.
 *
 * A skill row can show its instruction file in the Host's own side panel, and
 * the Host's client packages reach that surface through `ctx.sidebarRight`
 * (`openResource(address)`). This panel reads the service through the optional
 * `get` channel rather than declaring it in `inject`, because `inject` gates
 * plugin ACTIVATION in cordis: a Host whose right sidebar is absent — or whose
 * sidebar ships under another name — would park the entire panel instead of
 * losing one row action. Reading it optionally is what the Host's own shipped
 * bundles do, and the browser facade documents `get` as precisely this:
 * lookup without a declaration.
 */
export type PreviewOpener = (address: string) => void;

/**
 * Read the Host's sidebar navigation, or `undefined` when this deployment has
 * none. The returned closure keeps the service as its receiver: it is a live
 * object whose methods arrive through a guarding proxy, so detaching one and
 * calling it bare would drop `this`.
 * @param ctx - the plugin context; only its optional-lookup channel is used.
 * @returns an opener for a `dsh-resource://file/…` address, or `undefined`.
 */
export function resolvePreviewOpener(ctx: { get(name: string): unknown }): PreviewOpener | undefined {
  const service = ctx.get('sidebarRight');
  if (service === null || (typeof service !== 'object' && typeof service !== 'function')) return undefined;
  const open = (service as { openResource?: unknown }).openResource;
  if (typeof open !== 'function') return undefined;
  return (address: string) => { (open as (this: unknown, address: string) => void).call(service, address); };
}

/**
 * Open a resource address in the Host's right sidebar, looking the service up
 * at the moment of the click rather than once when the panel activates.
 *
 * Cordis starts the sidebar's own fiber when IT is ready, which is not
 * necessarily before this panel's: resolving once at activation would read
 * `undefined` whenever the panel won that race and then never retry, silently
 * removing an action the row should have had — a failure with no error to see.
 * The Host's own skill package avoids the race by declaring `sidebarRight` as a
 * required inject, which cordis holds the fiber for; this panel cannot afford
 * that, since an absent sidebar would take the skills/MCP/tools panel with it.
 */
export function openPreviewResource(ctx: { get(name: string): unknown }, address: string): void {
  resolvePreviewOpener(ctx)?.(address);
}