/**
 * The shot tables. They are data only: positions, targets, lenses and zones.
 * FixedCamera shows all of them; RoomCamera picks one per room.
 */
const rectZone = (cx, cz, w, d) => (x, z) =>
  Math.abs(x - cx) <= w / 2 && Math.abs(z - cz) <= d / 2;

export function buildFixedShots(layout) {
  const { hall, corridor, room } = layout.areas;
  const shots = [];
  const add = (shot) => shots.push(shot);

  /* -------------------------------- hall --------------------------------- */
  // The hall is a pre-rendered image (assets/Scenario/Hall.png). The camera
  // sits south of the hall looking north; the exit is on the south wall.
  add({
    id: "hall",
    group: "hall",
    priority: 1,
    backdrop: true,
    position: [0, 4.5, 16],
    target: [0, 1.2, -2],
    fov: 55,
    anchor: [0, 0],
    zone: rectZone(0, 0, hall.w, hall.d),
  });

  /* ------------------------------- corridor ------------------------------ */
  // The corridor runs south. Each half is seen from its far end.
  add({
    id: "corridor-first",
    group: "corridor",
    priority: 2,
    position: [corridor.x, 2.6, 20.5],
    target: [corridor.x, 1.0, 9],
    fov: 55,
    anchor: [corridor.x, 10.5],
    zone: (x, z) =>
      rectZone(corridor.x, corridor.z, corridor.w, corridor.d)(x, z) &&
      z < 14,
  });
  add({
    id: "corridor-second",
    group: "corridor",
    priority: 2,
    position: [corridor.x, 2.6, 7.5],
    target: [corridor.x, 1.0, 19],
    fov: 55,
    anchor: [corridor.x, 17.5],
    zone: (x, z) =>
      rectZone(corridor.x, corridor.z, corridor.w, corridor.d)(x, z) &&
      z >= 14,
  });

  /* -------------------------------- room --------------------------------- */
  add({
    id: "room-near",
    group: "room",
    priority: 3,
    position: [room.x + 5.5, 4.8, 21.6],
    target: [room.x - 1, 1.0, 27],
    fov: 64,
    anchor: [room.x, 23],
    zone: (x, z) =>
      rectZone(room.x, room.z, room.w, room.d)(x, z) && z < 26,
  });
  add({
    id: "room-far",
    group: "room",
    priority: 3,
    position: [room.x - 5.5, 4.5, 30.4],
    target: [room.x + 1, 1.0, 24],
    fov: 64,
    anchor: [room.x, 29],
    zone: (x, z) =>
      rectZone(room.x, room.z, room.w, room.d)(x, z) && z >= 26,
  });

  return shots;
}

/** One camera per room: the hall keeps its backdrop shot, the room its near one. */
export function buildRoomShots(layout) {
  const { room } = layout.areas;
  const fixed = buildFixedShots(layout);
  const hall = fixed.find((shot) => shot.id === "hall");
  const roomShot = fixed.find((shot) => shot.id === "room-near");
  // The room camera owns the whole room, not only the near half.
  return [
    hall,
    {
      ...roomShot,
      zone: rectZone(room.x, room.z, room.w, room.d),
    },
  ];
}
