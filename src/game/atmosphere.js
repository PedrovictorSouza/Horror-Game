/**
 * Hostile atmosphere. The red multiply is on while the pursuer is close enough
 * in room terms; `safeRooms` is the distance, in areas, that clears it.
 *
 * 1 = only the same area is hostile (any other area is safe)
 * 2 = same area and one area away are still hostile
 */
const ROOM_ORDER = ["hall", "corridor", "room"];

export function createAtmosphere({
  station,
  player,
  enemy,
  safeRooms = 1,
}) {
  let active = false;
  let gap = null;

  function update() {
    const playerArea = station.areaAt(
      player.root.position.x,
      player.root.position.z,
    );
    const enemyArea = station.areaAt(
      enemy.group.position.x,
      enemy.group.position.z,
    );

    const playerIndex = ROOM_ORDER.indexOf(playerArea);
    const enemyIndex = ROOM_ORDER.indexOf(enemyArea);
    gap =
      playerIndex < 0 || enemyIndex < 0
        ? null
        : Math.abs(playerIndex - enemyIndex);

    active =
      Boolean(enemy.group.visible) && gap !== null && gap < safeRooms;
  }

  return {
    update,
    get active() {
      return active;
    },
    get gap() {
      return gap;
    },
    get safeRooms() {
      return safeRooms;
    },
  };
}
