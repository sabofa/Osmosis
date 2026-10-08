import { describe, expect, it } from 'vitest';
import { altitudeAt, season, sunTimes } from './sun.js';

const CHAMPAIGN = { lat: 40.1164, lon: -88.2434 };
const TOL_MS = 2 * 60 * 1000;

// Reference instants from https://api.sunrise-sunset.org/json?lat=40.1164&lng=-88.2434&date=<date>&formatted=0
// (an independent implementation; spot-checked against USNO https://aa.usno.navy.mil/api/rstt/oneday for 2026-06-21).
const REF = [
  { day: '2026-06-21', sunrise: '2026-06-21T10:22:25Z', sunset: '2026-06-22T01:27:17Z', dawn: '2026-06-21T09:51:04Z', dusk: '2026-06-22T01:58:37Z' },
  { day: '2026-12-21', sunrise: '2026-12-21T13:10:07Z', sunset: '2026-12-21T22:32:11Z', dawn: '2026-12-21T12:41:07Z', dusk: '2026-12-21T23:01:12Z' },
  { day: '2026-03-20', sunrise: '2026-03-20T11:54:24Z', sunset: '2026-03-21T00:06:18Z', dawn: '2026-03-20T11:28:44Z', dusk: '2026-03-21T00:31:58Z' },
];

describe('sunTimes vs reference', () => {
  for (const r of REF) {
    it(`Champaign ${r.day}`, () => {
      const t = sunTimes(new Date(`${r.day}T12:00:00Z`), CHAMPAIGN);
      expect(t.polar).toBeNull();
      const near = (got: Date | null, want: string) => {
        expect(got).not.toBeNull();
        expect(Math.abs(got!.getTime() - Date.parse(want))).toBeLessThanOrEqual(TOL_MS);
      };
      near(t.sunrise, r.sunrise);
      near(t.sunset, r.sunset);
      near(t.civilDawn, r.dawn);
      near(t.civilDusk, r.dusk);
    });
  }
});

describe('polar', () => {
  const tromso = { lat: 69.65, lon: 18.96 };
  it('midnight sun', () => {
    const t = sunTimes(new Date('2026-06-21T12:00:00Z'), tromso);
    expect(t.polar).toBe('day');
    expect(t.sunrise).toBeNull();
    expect(t.sunset).toBeNull();
  });
  it('polar night', () => {
    expect(sunTimes(new Date('2026-12-21T12:00:00Z'), tromso).polar).toBe('night');
  });
});

describe('season', () => {
  it('northern summer', () => expect(season(new Date('2026-07-15T00:00:00Z'), 40).name).toBe('summer'));
  it('southern winter', () => expect(season(new Date('2026-07-15T00:00:00Z'), -34).name).toBe('winter'));
  it('spring begins', () => {
    const s = season(new Date('2026-03-21T00:00:00Z'), 40);
    expect(s.name).toBe('spring');
    expect(s.phase).toBeLessThan(0.1);
  });
  // The December solstice is 2026-12-21 ~20:50 UTC, so 00:00Z that day is still autumn; use the 22nd.
  it('winter after solstice', () => expect(season(new Date('2026-12-22T00:00:00Z'), 40).name).toBe('winter'));
  it('phase within 0..1', () => {
    const s = season(new Date('2026-05-01T00:00:00Z'), 40);
    expect(s.phase).toBeGreaterThanOrEqual(0);
    expect(s.phase).toBeLessThan(1);
  });
});

describe('altitudeAt', () => {
  it('equator at equinox noon is nearly overhead', () => {
    expect(altitudeAt(new Date('2026-03-20T12:00:00Z'), { lat: 0, lon: 0 })).toBeGreaterThan(85);
  });
  it('rises monotonically from sunrise to solar noon at Champaign', () => {
    const t = sunTimes(new Date('2026-06-21T12:00:00Z'), CHAMPAIGN);
    const noon = Date.parse('2026-06-21T12:00:00Z') + (-CHAMPAIGN.lon / 15) * 3600000;
    let prev = -Infinity;
    for (let ms = t.sunrise!.getTime(); ms <= noon - 15 * 60000; ms += 10 * 60000) {
      const a = altitudeAt(new Date(ms), CHAMPAIGN);
      expect(a).toBeGreaterThan(prev);
      prev = a;
    }
  });
});
