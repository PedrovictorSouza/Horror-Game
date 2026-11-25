/**
 * Content lives in data, not in systems. A designer can move an ammo cache or
 * tune the pistol here without touching a single line of logic.
 */
export const WEAPON_START = {
  clipSize: 8,
  reserve: 16,
  fireInterval: 0.42,
  reloadTime: 1.5,
};

/** One cache per sector, so the loop is: explore, find rounds, spend them. */
export const AMMO_CACHES = [
  { x: -5, z: 4, amount: 8 }, // hall
  { x: -2.33, z: 12, amount: 8 }, // corridor
  { x: -3, z: 28, amount: 8 }, // room, far side
  { x: 0, z: 23, amount: 8 }, // room, near side
];
