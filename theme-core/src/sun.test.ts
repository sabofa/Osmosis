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

describe('sunTimes edge cases', () => {
  it('near-pole day with noon altitude between -0.833 and 0 and no crossing is day', () => {
    const loc = { lat: 89.99, lon: 0 };
    const date = new Date('2026-09-23T12:00:00Z');
    const alt = altitudeAt(date, loc);
    expect(alt).toBeLessThan(0);
    expect(alt).toBeGreaterThan(-0.833);
    const t = sunTimes(date, loc);
    expect(t.sunrise).toBeNull();
    expect(t.sunset).toBeNull();
    expect(t.polar).toBe('day');
  });
  for (const lon of [170, -170]) {
    it(`lon ${lon}: rise before set, within 24h of solar noon`, () => {
      const date = new Date('2026-06-21T12:00:00Z');
      const t = sunTimes(date, { lat: 40, lon });
      expect(t.sunrise).not.toBeNull();
      expect(t.sunset).not.toBeNull();
      expect(t.sunrise!.getTime()).toBeLessThan(t.sunset!.getTime());
      const noon = Date.UTC(2026, 5, 21, 12) - (lon / 15) * 3600000;
      for (const d of [t.sunrise!, t.sunset!]) expect(Math.abs(d.getTime() - noon)).toBeLessThanOrEqual(12 * 3600000);
    });
  }
  it('southern hemisphere: December day longer than June day', () => {
    const loc = { lat: -34, lon: 151 };
    const len = (day: string) => {
      const t = sunTimes(new Date(`${day}T12:00:00Z`), loc);
      expect(t.sunrise!.getTime()).toBeLessThan(t.sunset!.getTime());
      return t.sunset!.getTime() - t.sunrise!.getTime();
    };
    expect(len('2026-12-21')).toBeGreaterThan(len('2026-06-21'));
  });
});
