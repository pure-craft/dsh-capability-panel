/**
 * The right-sidebar address for one skill's instruction file.
 *
 * The Host can already show a file in its right sidebar, and its own client
 * packages reach that surface the same way this module does: they build a
 * `dsh-resource://file/session/<sessionId>/<path>` address and hand it to
 * `ctx.sidebarRight.openResource`. That string is a client-side wire format
 * parsed by whichever Host build the page is running, and it is not simply
 * "absolute path": `fileAddressFor` relativizes a path under the session
 * workspace, keeps one outside it absolute, and encodes each segment while
 * leaving Windows drive colons literal. So we call the Host's own helper
 * instead of reproducing the grammar — a copy here would be a copy that drifts
 * silently, and the failure mode of drift is a click that does nothing.
 *
 * The package is a peer, loaded lazily and defensively rather than imported at
 * module scope. The addressing grammar did not exist in the oldest Host this
 * plugin supports (`0.1.5-alpha.1` is the first generation exporting
 * `fileAddressFor`), and a static import of a missing package would take down
 * the whole Host half — every route, not just the preview. Probing once and
 * caching means a Host without it simply reports no address, and the panel
 * shows no preview entry instead of an entry that cannot work.
 */
/** The Host helper's signature, as this plugin uses it. */
export type FileAddressFor = (sessionId: string, cwd: string | undefined, path: string) => string;

/** The single member used from `@deepseek-ai/dsh-util-workspace-path`. */
function pickFileAddressFor(module: unknown): FileAddressFor | undefined {
  const candidate = (module as { fileAddressFor?: unknown }).fileAddressFor;
  return typeof candidate === 'function' ? (candidate as FileAddressFor) : undefined;
}

let probed = false;
let builder: FileAddressFor | undefined;

/**
 * Resolve the Host's address helper once, or `undefined` when this deployment
 * has no such export. The probe result is remembered either way: a missing
 * package cannot appear later in one process's life.
 * @returns the helper, when the running Host ships it.
 */
export async function loadFileAddressFor(): Promise<FileAddressFor | undefined> {
  if (!probed) {
    probed = true;
    try {
      builder = pickFileAddressFor(await import('@deepseek-ai/dsh-util-workspace-path'));
    } catch {
      // Absent, unreadable, or a version predating the grammar: no address.
      builder = undefined;
    }
  }
  return builder;
}

/**
 * The address that opens `file` in the Host's right-sidebar preview.
 * @param forFile - the resolved helper; `undefined` means this Host cannot.
 * @param sessionId - the Session whose workspace resolves the path.
 * @param cwd - that Session's workspace root, when the Host reported one.
 * @param file - the skill's absolute instruction file path.
 * @returns the address, or `undefined` when the preview is unavailable.
 */
export function previewAddressFor(
  forFile: FileAddressFor | undefined,
  sessionId: string,
  cwd: string | undefined,
  file: string,
): string | undefined {
  return forFile === undefined ? undefined : forFile(sessionId, cwd, file);
}