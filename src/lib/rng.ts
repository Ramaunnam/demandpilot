/**
 * Seeded random number generator.
 * Using a fixed seed means the demo data is always exactly the same,
 * so the story on screen never changes between runs.
 */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class Rng {
  private r: () => number
  constructor(seed = 20260413) { this.r = mulberry32(seed) }
  next() { return this.r() }
  /** Uniform number between min and max. */
  range(min: number, max: number) { return min + this.r() * (max - min) }
  /** Whole number between min and max (both included). */
  int(min: number, max: number) { return Math.floor(this.range(min, max + 1)) }
  /** Normally distributed number (Box–Muller). */
  normal(mean = 0, sd = 1) {
    const u = Math.max(1e-9, this.r()), v = this.r()
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.r() * arr.length)] }
  /** True with the given probability. */
  chance(p: number) { return this.r() < p }
  shuffle<T>(arr: T[]): T[] {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.r() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }
}
