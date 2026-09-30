/**
 * Open one capability source folder on the user's own desktop.
 *
 * The Host already owns this operation: its Session controller hands the path
 * to the shell-free native opener, which carries the per-platform knowledge
 * this plugin would otherwise reimplement (Explorer receiving an encoded file
 * URI on Windows, the Windows-subsystem-for-Linux path translation, the Finder
 * reveal) and verifies the path through the composed filesystem first, so a
 * sandboxed deployment refuses anything outside its roots. It also folds the
 * deployment's native-opening policy into `canOpenWorkspacePath()`, which is
 * the difference between an entry that silently does nothing and an entry that
 * is not offered at all.
 *
 * Two cases still need this plugin's own opener, which is what `fallback` is
 * for: a composition that mounts no Session controller, and a path the Host
 * refuses to verify — a refusal, not a failure, since this plugin's own opener
 * never made that guarantee. A deployment answering `false` is different: it
 * has already said no desktop can receive the path, so running our own opener
 * would only reproduce the silent failure being avoided here.
 */
import type { SessionControllerLike } from './types.js';

/** Which opener ran; `unsupported` means the deployment ruled both out. */
export type OpenOutcome = 'host' | 'local' | 'unsupported';

/**
 * Whether the resolved service really carries both members this route calls.
 * Probed rather than assumed, exactly like the other optional services: the
 * service name is stable across generations, but a composition is free to
 * mount a partial implementation.
 */
function isUsableOpener(opener: SessionControllerLike | undefined): opener is SessionControllerLike {
  return opener !== undefined
    && typeof opener.canOpenWorkspacePath === 'function'
    && typeof opener.openWorkspacePath === 'function';
}

/**
 * Open `path` through the Host when it can, else through `fallback`.
 * @param opener - the Session controller, when the composition mounts one.
 * @param path - absolute folder path already resolved from the source key.
 * @param fallback - this plugin's own opener, used where the Host cannot.
 * @returns which opener ran.
 */
export async function openSourceFolder(
  opener: SessionControllerLike | undefined,
  path: string,
  fallback: (path: string) => Promise<void>,
): Promise<OpenOutcome> {
  if (isUsableOpener(opener)) {
    if (!opener.canOpenWorkspacePath()) return 'unsupported';
    try {
      // The Host's own open owns the path's lifetime; this route models no
      // cancellation of its own, so the signal is a live but never-aborted one.
      await opener.openWorkspacePath({ path }, new AbortController().signal);
      return 'host';
    } catch {
      /* No verified Host mapping (or the native command itself failed) — the
         fallback below still knows how to open a plain absolute path. */
    }
  }
  await fallback(path);
  return 'local';
}