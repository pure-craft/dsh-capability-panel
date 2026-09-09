import { exec } from 'node:child_process';

/**
 * Open a folder in the system file manager.
 *
 * Covers macOS (`open`), Windows (`start`), and every freedesktop Linux
 * desktop (GNOME, KDE, XFCE, …) via `xdg-open`. Server-only Linux distros
 * that lack a desktop cannot open folders, but the error is graceful.
 */
export function openFolder(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'start'
      : 'xdg-open';
    exec(`${cmd} "${path}"`, (error) => {
      if (error) reject(new Error(`failed to open folder: ${error.message}`));
      else resolve();
    });
  });
}