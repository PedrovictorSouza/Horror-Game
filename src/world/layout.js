/**
 * The first deck: a hall, a corridor and a second room.
 *
 * The hall exits through its SOUTH wall, between x -4.44 and x -0.22; the
 * corridor runs south and the room sits at its end. Everything is declarative
 * and in world units.
 */
export const WALL_HEIGHT = 3.6;
export const WALL_THICKNESS = 0.35;

const CORRIDOR_X = -2.33;

// Corner values captured in the rig/area editor and kept as the source of
// truth for navigation and for the editor overlay. Do not regenerate these
// from the rectangles: they are the values the user aligned to the images.
export const AREAS = {
  hall: {
    id: "hall",
    x: 0,
    z: 0,
    w: 16,
    d: 14,
    corners: [
      { x: -2, z: -3.91 },
      { x: 11.39, z: -0.59 },
      { x: 8.43, z: 10.33 },
      { x: -8.16, z: 8.12 },
    ],
  },
  corridor: {
    id: "corridor",
    x: -2.33,
    z: 14,
    w: 4.22,
    d: 14,
    // Third correction of the green gizmo by the user. Keep these values.
    corners: [
      { x: -1.97, z: 8.59 },
      { x: 2.07, z: 8.98 },
      { x: -1.06, z: 21.14 },
      { x: -6.78, z: 20.96 },
    ],
  },
  room: {
    id: "room",
    x: CORRIDOR_X,
    z: 26,
    w: 12,
    d: 10,
    corners: [
      { x: -8.33, z: 21 },
      { x: 3.67, z: 21 },
      { x: 3.67, z: 31 },
      { x: -8.33, z: 31 },
    ],
  },
};

/**
 * Openings: hall/corridor at z = +7, corridor/room at z = +21.
 * `low`/`high` are the areas on each side of the axis; the transition uses
 * them to place the player facing into the room it just entered.
 */
export const DOORS = [
  {
    id: "hall-corridor",
    x: CORRIDOR_X,
    z: 7,
    width: 4.22,
    height: 2.8,
    axis: "z",
    low: "hall",
    high: "corridor",
  },
  {
    id: "corridor-room",
    x: CORRIDOR_X,
    z: 21,
    width: 4.22,
    height: 2.8,
    axis: "z",
    low: "corridor",
    high: "room",
  },
];

/**
 * Door portals: rectangles between two areas where the area clamp is off, so
 * the player crosses walking, like a normal game. The camera/backdrop still
 * switch on the area boundary (the rectangles), not on the portal.
 */
export const PORTALS = [
  {
    id: "hall-corridor",
    x: -0.06,
    z: 8.5,
    w: 4.22,
    d: 3.3,
    from: "hall",
    to: "corridor",
  },
  {
    id: "corridor-room",
    x: -3.84,
    z: 21.9,
    w: 4.22,
    d: 3.3,
    from: "corridor",
    to: "room",
  },
];

/**
 * Wall runs. "x" runs along X at a fixed Z; "z" runs along Z at a fixed X.
 * The hall's south side is split by the exit; the north side is solid.
 */
export const WALLS = [
  // Hall: north, west, east; south split by the doorway.
  { axis: "x", z: -7, from: -8, to: 8 },
  { axis: "z", x: -8, from: -7, to: 7 },
  { axis: "z", x: 8, from: -7, to: 7 },
  { axis: "x", z: 7, from: -8, to: -4.44 },
  { axis: "x", z: 7, from: -0.22, to: 8 },

  // Corridor: two side walls running south, open at both ends.
  { axis: "z", x: -4.44, from: 7, to: 21 },
  { axis: "z", x: -0.22, from: 7, to: 21 },

  // Room: far wall, sides, and the near side split by the doorway.
  { axis: "x", z: 31, from: -8.33, to: 3.67 },
  { axis: "z", x: -8.33, from: 21, to: 31 },
  { axis: "z", x: 3.67, from: 21, to: 31 },
  { axis: "x", z: 21, from: -8.33, to: -4.44 },
  { axis: "x", z: 21, from: -0.22, to: 3.67 },
];
