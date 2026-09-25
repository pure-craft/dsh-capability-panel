import { describe, expect, it } from 'vitest';
import { normalizeToolkitSettings, ToolkitSettingsSchema } from '../../src/host/settings-schema.js';

describe('ToolkitSettingsSchema', () => {
  // dsh-settings 0.1.7 decides configurability purely from the entry's Config:
  // `volatileForm` returns undefined unless at least one field carries
  // `meta.volatile`, and `write()` then refuses with "has no volatile fields".
  // All three persisted maps must carry the marker, at the FIELD level — the
  // form validator rejects a volatile node beneath an enclosing volatile one.
  it('marks every persisted field volatile so the entry stays configurable', () => {
    const fields = (ToolkitSettingsSchema as unknown as { dict: Record<string, { meta?: { volatile?: boolean } }> }).dict;
    expect(Object.keys(fields)).toEqual(['presets', 'presetSkills', 'sessions']);
    for (const key of ['presets', 'presetSkills', 'sessions'] as const) {
      expect(fields[key]?.meta?.volatile).toBe(true);
    }
  });

  // The marker must survive serialization too: dsh-settings rebuilds the form
  // from `schema.toJSON()` (its own schemastery copy), so metadata that only
  // exists on the in-memory object would be invisible to describe().
  it('keeps the volatile markers through toJSON round-trip', () => {
    const json = ToolkitSettingsSchema.toJSON() as unknown as {
      uid: number;
      refs: Record<string, { meta?: { volatile?: boolean }; dict?: Record<string, number> } | undefined>;
    };
    const root = json.refs[String(json.uid)];
    for (const key of ['presets', 'presetSkills', 'sessions'] as const) {
      const field = json.refs[String(root?.dict?.[key])];
      expect(field?.meta?.volatile).toBe(true);
    }
  });
});

describe('normalizeToolkitSettings', () => {
  // `describe()` projects only fields that exist in the stored value; a section
  // written before a key existed, or absent entirely, must still read as the
  // three empty maps the schema's defaults promise.
  it('fills every absent map so readers never guard', () => {
    expect(normalizeToolkitSettings(undefined)).toEqual({ presets: {}, presetSkills: {}, sessions: {} });
    expect(normalizeToolkitSettings(null)).toEqual({ presets: {}, presetSkills: {}, sessions: {} });
    expect(normalizeToolkitSettings({ presets: { alpha: ['bash'] } })).toEqual({
      presets: { alpha: ['bash'] },
      presetSkills: {},
      sessions: {},
    });
    expect(normalizeToolkitSettings({ presetSkills: { alpha: ['search'] } })).toEqual({
      presets: {},
      presetSkills: { alpha: ['search'] },
      sessions: {},
    });
    expect(normalizeToolkitSettings({ sessions: { s1: {} } })).toEqual({
      presets: {},
      presetSkills: {},
      sessions: { s1: {} },
    });
  });
});