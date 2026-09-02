/**
 * The settings panel's text filter. It is the same function the composer panel
 * uses, fixed to the preset payload types: the two scopes must behave
 * identically under one query, and sharing the implementation is what makes
 * that true rather than merely intended.
 */
import { filterCapabilities } from './filter-core.js';
import type { FilteredCapabilities } from './filter-core.js';
import type { PresetMcpView, PresetSkillView, PresetToolPresetView, PresetToolView } from './preset-store.js';

export type FilteredPreset = FilteredCapabilities<PresetSkillView, PresetToolView, PresetMcpView>;

export function filterPreset(preset: PresetToolPresetView, rawQuery: string): FilteredPreset {
  return filterCapabilities(preset, rawQuery);
}
