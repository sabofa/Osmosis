// ----------------------------------------------------------------------------
// Desktop notification for "the tutor sent an item" (spec §7.4).
//
// Permission is requested from the Settings toggle and nowhere else: a
// permission prompt on page load is the fastest way to have it denied forever,
// and a denied permission cannot be asked for again. So the app asks only when
// Ben has just said he wants it.
//
// The notification is a courtesy on top of the title flash, not a replacement
// for it — the tab title changes whether or not notifications are allowed.
// ----------------------------------------------------------------------------

const STORAGE_KEY = 'osmosis.notifyOnItem'
const FLASHED_TITLE = '● Osmosis'

export type NotifyPermission = 'unsupported' | 'default' | 'granted' | 'denied'

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function notifyPermission(): NotifyPermission {
  if (!notificationsSupported()) return 'unsupported'
  return Notification.permission as NotifyPermission
}

// The stored preference, which is not the same thing as the browser
// permission: Ben can have granted permission and still turn the toggle off.
export function notifyPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

export function setNotifyPreference(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // A browser with storage blocked simply doesn't remember the choice.
  }
}

// Called only from the Settings toggle. Returns whether notifications are on
// afterwards — a denied permission leaves the toggle off rather than lying.
export async function enableNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false
  let permission = Notification.permission
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission()
    } catch {
      return false
    }
  }
  const on = permission === 'granted'
  setNotifyPreference(on)
  return on
}

export function disableNotifications(): void {
  setNotifyPreference(false)
  clearTitleFlash()
}

// Whether Ben is looking at something else right now. Both halves matter: a
// visible-but-unfocused window (the tutor's chat next to the app) is exactly
// the case the notification exists for.
export function isAway(): boolean {
  if (typeof document === 'undefined') return false
  if (document.hidden) return true
  return typeof document.hasFocus === 'function' ? !document.hasFocus() : false
}

let restoreTitle: string | null = null
let focusListener: (() => void) | null = null

export function flashTitle(): void {
  if (typeof document === 'undefined') return
  if (restoreTitle === null) restoreTitle = document.title
  document.title = FLASHED_TITLE
  if (focusListener) return
  // The flash lasts until Ben comes back, not for a fixed few seconds — the
  // point is that he sees it whenever he looks, not that it times out.
  focusListener = () => {
    if (!isAway()) clearTitleFlash()
  }
  window.addEventListener('focus', focusListener)
  document.addEventListener('visibilitychange', focusListener)
}

export function clearTitleFlash(): void {
  if (typeof document === 'undefined') return
  if (restoreTitle !== null) {
    document.title = restoreTitle
    restoreTitle = null
  }
  if (focusListener) {
    window.removeEventListener('focus', focusListener)
    document.removeEventListener('visibilitychange', focusListener)
    focusListener = null
  }
}

// What the live screen calls when the tutor puts something new on it. Does
// nothing at all while the app is in front — a notification for something
// already on screen is pure noise.
function notifyPresented(body: string): void {
  if (!isAway()) return
  flashTitle()
  if (!notifyPreference() || notifyPermission() !== 'granted') return
  try {
    new Notification(body)
  } catch {
    // Some browsers refuse the constructor outside a service worker; the
    // title flash has already done the important half.
  }
}

export function notifyItemPresented(): void {
  notifyPresented('Osmosis — the tutor sent an item')
}

// A show is the other half of the live loop (§5.1) and is just as easy to
// miss from another window, so it flashes the title too. Worded differently
// because "an item" would have Ben reaching for the keyboard to answer one.
export function notifyShowPresented(): void {
  notifyPresented('Osmosis — the tutor put something on screen')
}
