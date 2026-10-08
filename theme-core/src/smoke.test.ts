import { describe, expect, it } from 'vitest';
import { THEME_SCHEMA } from './index.js';

describe('theme-core', () => {
  it('exports the schema version', () => {
    expect(THEME_SCHEMA).toBe(1);
  });
});
