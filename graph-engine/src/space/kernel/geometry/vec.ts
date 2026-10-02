// Three-vectors as plain tuples, for S4a's builders. Pure.

export type V3 = [number, number, number]

export const add = (a: readonly number[], b: readonly number[]): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: readonly number[], k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
export const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const norm = (a: readonly number[]): number => Math.hypot(a[0], a[1], a[2])

// a / |a|; the caller has checked |a| > 0.
export const unit = (a: readonly number[]): V3 => scale(a, 1 / norm(a))

export const isFiniteV = (a: readonly number[]): boolean => Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2])
