export const TAU = Math.PI * 2;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** Small seeded PRNG: the station and the terrain must look the same every run. */
export function mulberry32(seed) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
