// Low-precision solar position (about 1 minute accuracy). UTC only; sunrise/sunset use the
// conventional -0.833 degree horizon, altitudeAt itself applies no refraction.

export interface Location {
  lat: number;
  lon: number; // east-positive
  label?: string;
}

export interface SunTimes {
  sunrise: Date | null;
  sunset: Date | null;
  civilDawn: Date | null;
  civilDusk: Date | null;
  polar: 'day' | 'night' | null;
}

export type SeasonName = 'spring' | 'summer' | 'autumn' | 'winter';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const MIN_MS = 60000;

const mod = (x: number, m: number): number => ((x % m) + m) % m;

interface SunState {
  lambda: number; // ecliptic longitude, degrees 0..360 from the March equinox
  delta: number; // declination, degrees
  eotMin: number; // equation of time, minutes
}

function sunState(ms: number): SunState {
  const jd = ms / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = mod(280.46 + 0.9856474 * n, 360);
  const g = mod(357.528 + 0.9856003 * n, 360) * RAD;
  const lambdaDeg = L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g);
  const lam = lambdaDeg * RAD;
  const eps = (23.439 - 4e-7 * n) * RAD;
  const delta = Math.asin(Math.sin(eps) * Math.sin(lam)) * DEG;
  const alpha = mod(Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) * DEG, 360);
  const diff = mod(L - alpha + 180, 360) - 180; // into [-180, 180)
  return { lambda: mod(lambdaDeg, 360), delta, eotMin: 4 * diff };
}

/** Solar altitude in degrees (geometric, no refraction). */
export function altitudeAt(date: Date, loc: Location): number {
  const ms = date.getTime();
  const { delta, eotMin } = sunState(ms);
  const utcMin =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60 +
    date.getUTCMilliseconds() / 60000;
  const T = utcMin + 4 * loc.lon + eotMin;
  const H = (T / 4 - 180) * RAD;
  const lat = loc.lat * RAD;
  const dl = delta * RAD;
  const s = Math.sin(lat) * Math.sin(dl) + Math.cos(lat) * Math.cos(dl) * Math.cos(H);
  return Math.asin(Math.max(-1, Math.min(1, s))) * DEG;
}

/**
 * Sunrise/sunset and civil dawn/dusk for the solar day containing `date`.
 * The window is anchored to the UTC day of `date`: it spans local solar noon of that UTC date
 * +/- 12h, so at |lon| > ~150 "today" is the date whose UTC day matches the local solar day.
 * Polar test: with no sunrise/sunset in the window, the sun is 'day' if its noon altitude is
 * above the -0.833 degree horizon (the same level used for crossings), else 'night'.
 */
export function sunTimes(date: Date, loc: Location): SunTimes {
  const noon =
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12) -
    (loc.lon / 15) * 3600000;
  const start = noon - 12 * 3600000;
  const steps = 24 * 60;

  let sunrise: number | null = null;
  let sunset: number | null = null;
  let dawn: number | null = null;
  let dusk: number | null = null;

  const crossing = (t0: number, a0: number, a1: number, level: number): number =>
    t0 + ((level - a0) / (a1 - a0)) * MIN_MS;

  let prevT = start;
  let prevA = altitudeAt(new Date(prevT), loc);
  for (let i = 1; i <= steps; i++) {
    const t = start + i * MIN_MS;
    const a = altitudeAt(new Date(t), loc);
    if (prevA < -0.833 && a >= -0.833) sunrise ??= crossing(prevT, prevA, a, -0.833);
    else if (prevA >= -0.833 && a < -0.833) sunset ??= crossing(prevT, prevA, a, -0.833);
    if (prevA < -6 && a >= -6) dawn ??= crossing(prevT, prevA, a, -6);
    else if (prevA >= -6 && a < -6) dusk ??= crossing(prevT, prevA, a, -6);
    prevT = t;
    prevA = a;
  }

  if (sunrise === null && sunset === null) {
    return {
      sunrise: null,
      sunset: null,
      civilDawn: null,
      civilDusk: null,
      polar: altitudeAt(new Date(noon), loc) > -0.833 ? 'day' : 'night',
    };
  }
  const toDate = (v: number | null): Date | null => (v === null ? null : new Date(v));
  return {
    sunrise: toDate(sunrise),
    sunset: toDate(sunset),
    civilDawn: toDate(dawn),
    civilDusk: toDate(dusk),
    polar: null,
  };
}

const NORTH: SeasonName[] = ['spring', 'summer', 'autumn', 'winter'];
const SWAP: Record<SeasonName, SeasonName> = {
  spring: 'autumn',
  summer: 'winter',
  autumn: 'spring',
  winter: 'summer',
};

/** Astronomical season (equinox/solstice boundaries) and progress through it. */
export function season(date: Date, lat: number): { name: SeasonName; phase: number } {
  const { lambda } = sunState(date.getTime());
  const name = NORTH[Math.floor(lambda / 90) % 4]!;
  return { name: lat < 0 ? SWAP[name] : name, phase: (lambda % 90) / 90 };
}
