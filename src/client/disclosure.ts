export interface DisclosureState {
  readonly open: boolean;
  readonly disabled: boolean;
  readonly label: string;
}

/**
 * Resolve one controlled disclosure's visible and interactive state.
 * Filtering deliberately preserves the user's stored preference while forcing
 * matching detail open; the disabled trigger prevents a no-feedback toggle.
 */
export function resolveDisclosure(
  expanded: boolean,
  filtering: boolean,
  subject: string,
  detail: string,
): DisclosureState {
  if (filtering) {
    return {
      open: true,
      disabled: true,
      label: `${subject} 的${detail}（筛选时保持展开）`,
    };
  }
  return {
    open: expanded,
    disabled: false,
    label: expanded ? `收起 ${subject} 的${detail}` : `展开 ${subject} 的${detail}`,
  };
}

/** Shared geometry and hover classes used by every capability header. */
export const ROW_ROOT_CLASS = '';
export const MCP_TOOL_ROOT_CLASS = 'ci-toolrow';
export const ROW_HEADER_CLASS = 'ci-row-head';
