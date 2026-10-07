import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS, PARAM_SCHEMA } from '../params'
import tuning from '../tuning.json'

// The lab's Bake switch ("Bake (instant orbit)") is a view setting, like the theme: kept in the URL the way the theme is (written back by writeUrl, read
// by the page's URL state), and never a painter parameter. paintLabState reads the page's URL when it is imported, so each case loads it afresh.

const HOME = 'http://lab/paint-lab.html'

// A page at `search`, whose URL writeUrl can move (history.replaceState): `where.href` is what the address bar would say.
async function page(search: string) {
  const where = { href: `${HOME}${search}` }
  vi.resetModules()
  vi.stubGlobal('location', {
    get href() {
      return where.href
    },
    get search() {
      return new URL(where.href).search
    },
  })
  vi.stubGlobal('history', {
    replaceState: (_state: unknown, _title: string, url: string | URL) => {
      where.href = String(url)
    },
  })
  const state = await import('../../../../../review/src/paintLabState')
  return { ...state, where, flag: () => new URL(where.href).searchParams.get('bake') }
}

afterEach(() => vi.unstubAllGlobals())

describe('the Bake switch in the URL', () => {
  it('starts on, and &bake=0 starts it off (the flag the lab always had, now the switch’s own start)', async () => {
    expect((await page('')).URL_STATE.bake).toBe(true)
    expect((await page('?figure=torus')).URL_STATE.bake).toBe(true)
    expect((await page('?bake=0')).URL_STATE.bake).toBe(false)
    expect((await page('?figure=torus&worker=0&bake=0&theme=dark')).URL_STATE.bake).toBe(false)
    expect((await page('?bake=1')).URL_STATE.bake).toBe(true)
  })

  it('is written back as the theme is: &bake=0 while it is off, nothing while it is on, the rest of the URL as it was', async () => {
    const lab = await page('?worker=0&seed=7')
    lab.writeUrl('tune', 'sphere', 'none', 'light', false)
    expect(lab.flag()).toBe('0')
    expect(new URL(lab.where.href).searchParams.get('figure')).toBe('sphere')
    // (what the lab had in its URL that it does not write stays)
    expect(new URL(lab.where.href).searchParams.get('worker')).toBe('0')
    expect(new URL(lab.where.href).searchParams.get('seed')).toBe('7')
    lab.writeUrl('tune', 'sphere', 'none', 'dark', false)
    expect(lab.flag()).toBe('0')
    expect(new URL(lab.where.href).searchParams.get('theme')).toBe('dark')
    lab.writeUrl('tune', 'sphere', 'none', 'dark', true)
    expect(lab.flag()).toBeNull()
    expect(new URL(lab.where.href).searchParams.get('theme')).toBe('dark')
    // a writer that does not know of the switch never turns it off
    lab.writeUrl('tune', 'sphere', 'none', 'dark')
    expect(lab.flag()).toBeNull()
  })

  it('round-trips: what was written is where a reload lands, off and on', async () => {
    const lab = await page('?worker=0')
    lab.writeUrl('showcase', 'torus', 'zones', 'dark', false)
    const reloadedOff = await page(new URL(lab.where.href).search)
    expect(reloadedOff.URL_STATE.bake).toBe(false)
    expect(reloadedOff.URL_STATE).toMatchObject({ tab: 'showcase', figure: 'torus', debug: 'zones', theme: 'dark', bake: false })
    reloadedOff.writeUrl('showcase', 'torus', 'zones', 'dark', true)
    const reloadedOn = await page(new URL(reloadedOff.where.href).search)
    expect(reloadedOn.URL_STATE.bake).toBe(true)
    expect(reloadedOn.URL_STATE).toMatchObject({ tab: 'showcase', figure: 'torus', debug: 'zones', theme: 'dark', bake: true })
  })
})

describe('the Bake switch is not a painter parameter', () => {
  it('has no slider, no key in the params, and no place in the saved defaults', () => {
    expect(PARAM_SCHEMA.some((spec) => /bake/i.test(spec.path) || /bake/i.test(spec.label))).toBe(false)
    expect(JSON.stringify(DEFAULT_PAINT_PARAMS)).not.toMatch(/bake/i)
    expect(JSON.stringify(tuning)).not.toMatch(/bake/i)
  })
})
