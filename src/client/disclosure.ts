export interface DisclosureState {
  readonly open: boolean;
  readonly disabled: boolean;
}

/**
 * Resolve one controlled disclosure's visible and interactive state.
 * Filtering deliberately preserves the user's stored preference while forcing
 * matching detail open; the disabled trigger prevents a no-feedback toggle.
 * Labels are the caller's job — they go through the locale translate function.
 */
export function resolveDisclosure(expanded: boolean, filtering: boolean): DisclosureState {
  if (filtering) {
    return { open: true, disabled: true };
  }
  return { open: expanded, disabled: false };
}

/** Shared geometry and hover classes used by every capability header. */
export const ROW_ROOT_CLASS = '';
export const MCP_TOOL_ROOT_CLASS = 'ci-toolrow';
export const ROW_HEADER_CLASS = 'ci-row-head';
