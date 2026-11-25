import * as THREE from "three";

/**
 * Proximity interaction. One world-anchored round prompt serves every
 * interactable on the deck:
 *
 *   console -> opens the (currently empty) interface screen
 *   doors   -> starts the classic RE door transition in the main loop
 *
 * The prompt uses the nearest point; the fire button (N / RT / A) becomes the
 * interact button while in range and not aiming.
 */
export const INTERACT_POINT = { x: 7.46, z: 0.5 };
const ANCHOR_Y = 1.2;
const NEAR_DISTANCE = 2.6;
const FAR_DISTANCE = 3.1;
const DOOR_ANCHOR_Y = 1.35;
const DOOR_NEAR = 2.6;
const DOOR_FAR = 3.1;
/** Landing distance on either side of a door; shared with the main transition. */
// Far enough past the door to land inside the next area's corner polygon,
// not in the seam where the nav clamp would hold the player.
export const DOOR_TARGET_OFFSET = 2.6;

export function createInteraction({
  camera,
  player,
  input,
  screen,
  prompt,
  menu,
  closeButton,
  doors = [],
  portals = [],
  onDoor,
  scene,
  gizmosVisible = true,
  areas = {},
  walkableCells = [],
}) {
  let open = false;
  let active = null;
  let shown = false;

  const points = [
    {
      kind: "console",
      id: "console",
      x: INTERACT_POINT.x,
      z: INTERACT_POINT.z,
      y: ANCHOR_Y,
      near: NEAR_DISTANCE,
      far: FAR_DISTANCE,
    },
    ...doors.map((door) => ({
      kind: "door",
      id: door.id,
      door,
      x: door.x,
      z: door.z,
      y: DOOR_ANCHOR_Y,
      near: DOOR_NEAR,
      far: DOOR_FAR,
    })),
  ];

  const anchor = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const toAnchor = new THREE.Vector3();

  /* --------------------------- door debug gizmos -------------------------- */

  const gizmos = new THREE.Group();
  gizmos.name = "door-gizmos";

  function lineMaterial(color, opacity) {
    return new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
      toneMapped: false,
    });
  }

  function addDoorGizmos(point) {
    const door = point.door;
    const group = new THREE.Group();
    group.position.set(door.x, 0, door.z);

    // Doorway volume.
    const box = new THREE.BoxGeometry(door.width, door.height, 0.35);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      lineMaterial(0x62e8ff, 0.95),
    );
    edges.position.y = door.height / 2;
    edges.renderOrder = 20;
    group.add(edges);

    // Trigger radius (the same near/far the interaction uses, in local space).
    for (const [radius, color, opacity] of [
      [point.near, 0x62e8ff, 0.9],
      [point.far, 0xffb347, 0.35],
    ]) {
      const geometry = new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 65 }, (_, index) => {
          const angle = (index / 64) * Math.PI * 2;
          return new THREE.Vector3(
            Math.cos(angle) * radius,
            0,
            Math.sin(angle) * radius,
          );
        }),
      );
      const ring = new THREE.LineLoop(geometry, lineMaterial(color, opacity));
      ring.position.y = 0.06;
      ring.renderOrder = 20;
      group.add(ring);
    }

    // Landing spots and facing arrow, one on each side.
    for (const side of [1, -1]) {
      const z = side * DOOR_TARGET_OFFSET;
      const color = side > 0 ? 0x7dff9b : 0xff7aa8;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.28, 0.36, 24),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
          depthTest: false,
          toneMapped: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(0, 0.09, z);
      ring.renderOrder = 21;
      group.add(ring);

      const arrow = new THREE.ArrowHelper(
        new THREE.Vector3(0, 0, side),
        new THREE.Vector3(0, 0.12, z),
        0.9,
        color,
        0.3,
        0.18,
      );
      arrow.traverse((child) => {
        child.renderOrder = 22;
        if (child.material) {
          child.material.depthTest = false;
          child.material.toneMapped = false;
          child.material.transparent = true;
          child.material.opacity = 0.95;
        }
      });
      group.add(arrow);
    }

    gizmos.add(group);
  }

  const AREA_COLORS = {
    hall: 0x4fe3ff,
    corridor: 0xa6ff5c,
    room: 0xff7ad9,
  };

  const STORAGE_KEY = "pico-walker:editor-areas";
  const initialAreas = {};
  const editableAreas = {};
  const initialPortals = portals.map((portal) => ({ ...portal }));
  const editablePortals = portals.map((portal) => ({ ...portal }));

  const rectCorners = (area) =>
    area.corners && area.corners.length === 4
      ? area.corners.map((corner) => ({ ...corner }))
      : [
          { x: area.x - area.w / 2, z: area.z - area.d / 2 },
          { x: area.x + area.w / 2, z: area.z - area.d / 2 },
          { x: area.x + area.w / 2, z: area.z + area.d / 2 },
          { x: area.x - area.w / 2, z: area.z + area.d / 2 },
        ];

  for (const [id, area] of Object.entries(areas)) {
    initialAreas[id] = {
      corners: rectCorners(area).map((corner) => ({ ...corner })),
    };
    editableAreas[id] = { id, corners: rectCorners(area) };
  }

  const areaStates = new Map();
  const allHandles = [];

  const round = (value) => Number(value.toFixed(2));

  function areaJson() {
    const out = {};
    for (const [id, area] of Object.entries(editableAreas)) {
      out[id] = {
        corners: area.corners.map((corner) => [
          round(corner.x),
          round(corner.z),
        ]),
      };
    }
    for (const portal of editablePortals) {
      out[portal.id] = {
        x: round(portal.x),
        z: round(portal.z),
        w: round(portal.w),
        d: round(portal.d),
      };
    }
    return JSON.stringify(out, null, 2);
  }

  const editorJson = document.querySelector("#editor-json");
  const editorStatus = document.querySelector("#editor-status");
  const editorCopy = document.querySelector("#editor-copy");
  const editorSave = document.querySelector("#editor-save");
  const editorReset = document.querySelector("#editor-reset");

  function setEditorStatus(text) {
    if (editorStatus) editorStatus.textContent = text;
  }

  function syncEditor() {
    if (editorJson) editorJson.textContent = areaJson();
    mapDraw();
  }

  editorCopy?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(areaJson());
      setEditorStatus("JSON copiado");
    } catch {
      setEditorStatus("selecione o JSON e copie");
      editorJson?.focus?.();
    }
  });

  editorSave?.addEventListener("click", () => {
    try {
      localStorage.setItem(STORAGE_KEY, areaJson());
      setEditorStatus("salvo no navegador");
    } catch {
      setEditorStatus("não foi possível salvar");
    }
  });

  editorReset?.addEventListener("click", () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    for (const [id, area] of Object.entries(initialAreas)) {
      editableAreas[id].corners = area.corners.map((corner) => ({
        ...corner,
      }));
    }
    for (const portal of editablePortals) {
      const original = initialPortals.find((p) => p.id === portal.id);
      if (original) Object.assign(portal, original);
    }
    for (const id of areaStates.keys()) updateArea(id);
    setEditorStatus("resetado");
  });

  function updateArea(id) {
    const state = areaStates.get(id);
    const area = editableAreas[id];
    if (!state || !area) return;

    const fillPositions = state.fill.geometry.attributes.position;
    const borderPositions = state.border.geometry.attributes.position;
    for (let i = 0; i < 4; i += 1) {
      const corner = area.corners[i];
      fillPositions.setXYZ(i, corner.x, 0.02, corner.z);
      borderPositions.setXYZ(i, corner.x, 0.05, corner.z);
    }
    fillPositions.needsUpdate = true;
    borderPositions.needsUpdate = true;
    state.fill.geometry.computeBoundingSphere();
    state.border.geometry.computeBoundingSphere();

    for (const handle of state.handles) {
      const corner = area.corners[handle.userData.index];
      handle.position.set(corner.x, 0.18, corner.z);
    }
    syncEditor();
  }

  function addAreaGizmo(area) {
    const color = AREA_COLORS[area.id] ?? 0x62e8ff;

    // Free quadrilateral floor: each corner moves on its own.
    const fillGeometry = new THREE.BufferGeometry();
    fillGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(12), 3),
    );
    fillGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    const fill = new THREE.Mesh(
      fillGeometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    fill.renderOrder = 3;
    gizmos.add(fill);

    const borderGeometry = new THREE.BufferGeometry();
    borderGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(12), 3),
    );
    const border = new THREE.LineLoop(
      borderGeometry,
      lineMaterial(color, 0.95),
    );
    border.renderOrder = 20;
    gizmos.add(border);

    const handles = [];
    for (let index = 0; index < 4; index += 1) {
      const handle = new THREE.Group();
      const outer = new THREE.Mesh(
        new THREE.SphereGeometry(0.24, 10, 8),
        new THREE.MeshBasicMaterial({
          color: 0x000000,
          transparent: true,
          opacity: 0.92,
          depthTest: false,
          toneMapped: false,
        }),
      );
      const inner = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 10, 8),
        new THREE.MeshBasicMaterial({
          color,
          depthTest: false,
          toneMapped: false,
        }),
      );
      outer.userData = { areaId: area.id, index };
      outer.renderOrder = 24;
      inner.renderOrder = 25;
      handle.add(outer);
      handle.add(inner);
      handle.userData = { areaId: area.id, index };
      gizmos.add(handle);
      handles.push(handle);
      allHandles.push(outer);
    }

    areaStates.set(area.id, { fill, border, handles, color });
    updateArea(area.id);
  }

  /* ----------------------------- corner editor ---------------------------- */

  const canvas = screen.querySelector("#scene");
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();
  let dragging = null;

  function toPointer(event) {
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    return true;
  }

  function handleAt(event) {
    if (!canvas) return null;
    toPointer(event);
    raycaster.setFromCamera(pointer, camera);
    const intersections = raycaster.intersectObjects(allHandles, false);
    return intersections[0]?.object ?? null;
  }

  function pointerDown(event) {
    if (!gizmos.visible || event.button !== 0) return;
    const handle = handleAt(event);
    if (!handle) return;

    dragging = {
      areaId: handle.userData.areaId,
      index: handle.userData.index,
    };
    canvas.setPointerCapture?.(event.pointerId);
    canvas.style.cursor = "grabbing";
    event.preventDefault();
  }

  function pointerMove(event) {
    if (!dragging) {
      if (!canvas) return;
      const hover = gizmos.visible ? handleAt(event) : null;
      canvas.style.cursor = hover ? "grab" : "";
      return;
    }

    toPointer(event);
    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return;

    const area = editableAreas[dragging.areaId];
    const corner = area.corners[dragging.index];
    corner.x = hitPoint.x;
    corner.z = hitPoint.z;
    updateArea(dragging.areaId);
  }

  function pointerUp(event) {
    if (!dragging) return;
    dragging = null;
    canvas.style.cursor = "";
    canvas.releasePointerCapture?.(event.pointerId);
  }

  canvas?.addEventListener("pointerdown", pointerDown);
  window.addEventListener("pointermove", pointerMove);
  window.addEventListener("pointerup", pointerUp);

  /* ------------------------------ editor map ------------------------------- */

  const mapCanvas = document.querySelector("#editor-map");
  const mapCtx = mapCanvas?.getContext("2d");
  const MAP_BOUNDS = { minX: -9, maxX: 9, minZ: -8, maxZ: 32 };
  const MAP_PAD = 12;
  let mapDragging = null;

  function mapTransform() {
    const width = mapCanvas?.width ?? 220;
    const height = mapCanvas?.height ?? 260;
    const scale = Math.min(
      (width - MAP_PAD * 2) / (MAP_BOUNDS.maxX - MAP_BOUNDS.minX),
      (height - MAP_PAD * 2) / (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ),
    );
    return {
      width,
      height,
      scale,
      ox: (width - (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) * scale) / 2,
      oz: (height - (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) * scale) / 2,
    };
  }

  function toMap(x, z) {
    const t = mapTransform();
    return {
      x: t.ox + (x - MAP_BOUNDS.minX) * t.scale,
      y: t.oz + (z - MAP_BOUNDS.minZ) * t.scale,
    };
  }

  function fromMap(px, py) {
    const t = mapTransform();
    return {
      x: MAP_BOUNDS.minX + (px - t.ox) / t.scale,
      z: MAP_BOUNDS.minZ + (py - t.oz) / t.scale,
    };
  }

  function mapDraw() {
    if (!mapCtx || !mapCanvas) return;
    const t = mapTransform();
    mapCtx.clearRect(0, 0, t.width, t.height);
    mapCtx.fillStyle = "#01050a";
    mapCtx.fillRect(0, 0, t.width, t.height);

    mapCtx.strokeStyle = "rgba(120, 170, 200, 0.16)";
    mapCtx.lineWidth = 1;
    for (let x = -8; x <= 8; x += 4) {
      const p = toMap(x, 0);
      mapCtx.beginPath();
      mapCtx.moveTo(p.x, 0);
      mapCtx.lineTo(p.x, t.height);
      mapCtx.stroke();
    }
    for (let z = -4; z <= 32; z += 4) {
      const p = toMap(0, z);
      mapCtx.beginPath();
      mapCtx.moveTo(0, p.y);
      mapCtx.lineTo(t.width, p.y);
      mapCtx.stroke();
    }

    for (const [id, area] of Object.entries(editableAreas)) {
      const color = AREA_COLORS[id] ?? 0x62e8ff;
      const css = `#${color.toString(16).padStart(6, "0")}`;
      mapCtx.beginPath();
      area.corners.forEach((corner, index) => {
        const p = toMap(corner.x, corner.z);
        if (index === 0) mapCtx.moveTo(p.x, p.y);
        else mapCtx.lineTo(p.x, p.y);
      });
      mapCtx.closePath();
      mapCtx.fillStyle = `${css}33`;
      mapCtx.fill();
      mapCtx.strokeStyle = css;
      mapCtx.lineWidth = 1.5;
      mapCtx.stroke();

      for (const corner of area.corners) {
        const p = toMap(corner.x, corner.z);
        mapCtx.beginPath();
        mapCtx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        mapCtx.fillStyle = css;
        mapCtx.fill();
        mapCtx.strokeStyle = "#000";
        mapCtx.lineWidth = 2;
        mapCtx.stroke();
      }
    }

    for (const portal of editablePortals) {
      const x0 = portal.x - portal.w / 2;
      const x1 = portal.x + portal.w / 2;
      const z0 = portal.z - portal.d / 2;
      const z1 = portal.z + portal.d / 2;
      const a = toMap(x0, z0);
      const b = toMap(x1, z0);
      const c = toMap(x1, z1);
      const d = toMap(x0, z1);
      mapCtx.beginPath();
      mapCtx.moveTo(a.x, a.y);
      mapCtx.lineTo(b.x, b.y);
      mapCtx.lineTo(c.x, c.y);
      mapCtx.lineTo(d.x, d.y);
      mapCtx.closePath();
      mapCtx.fillStyle = "rgba(255, 90, 90, 0.18)";
      mapCtx.fill();
      mapCtx.strokeStyle = "#ff5a5a";
      mapCtx.lineWidth = 1.5;
      mapCtx.stroke();
      const center = toMap(portal.x, portal.z);
      mapCtx.beginPath();
      mapCtx.arc(center.x, center.y, 5, 0, Math.PI * 2);
      mapCtx.fillStyle = "#ff5a5a";
      mapCtx.fill();
      mapCtx.strokeStyle = "#000";
      mapCtx.lineWidth = 2;
      mapCtx.stroke();
    }

    for (const door of doors) {
      const p = toMap(door.x, door.z);
      mapCtx.beginPath();
      mapCtx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      mapCtx.fillStyle = "#ffb347";
      mapCtx.fill();
    }

    const playerPoint = toMap(player.root.position.x, player.root.position.z);
    mapCtx.beginPath();
    mapCtx.arc(playerPoint.x, playerPoint.y, 3, 0, Math.PI * 2);
    mapCtx.fillStyle = "#ffffff";
    mapCtx.fill();
  }

  function mapPoint(event) {
    const rect = mapCanvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (mapCanvas.width / rect.width),
      y: (event.clientY - rect.top) * (mapCanvas.height / rect.height),
    };
  }

  function mapHit(point) {
    let best = null;
    let bestDistance = 10;
    for (const [id, area] of Object.entries(editableAreas)) {
      area.corners.forEach((corner, index) => {
        const p = toMap(corner.x, corner.z);
        const distance = Math.hypot(point.x - p.x, point.y - p.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { kind: "area", areaId: id, index };
        }
      });
    }
    for (const portal of editablePortals) {
      const p = toMap(portal.x, portal.z);
      const distance = Math.hypot(point.x - p.x, point.y - p.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { kind: "portal", id: portal.id };
      }
    }
    return best;
  }

  function mapDown(event) {
    if (!mapCanvas) return;
    const hit = mapHit(mapPoint(event));
    if (!hit) return;
    mapDragging = hit;
    mapCanvas.setPointerCapture?.(event.pointerId);
    mapCanvas.style.cursor = "grabbing";
    event.preventDefault();
  }

  function mapMove(event) {
    if (!mapCanvas) return;
    if (!mapDragging) {
      mapCanvas.style.cursor = mapHit(mapPoint(event)) ? "grab" : "crosshair";
      return;
    }
    const world = fromMap(mapPoint(event).x, mapPoint(event).y);
    if (mapDragging.kind === "portal") {
      const portal = editablePortals.find((p) => p.id === mapDragging.id);
      if (portal) {
        portal.x = world.x;
        portal.z = world.z;
        syncEditor();
      }
      return;
    }
    const area = editableAreas[mapDragging.areaId];
    area.corners[mapDragging.index].x = world.x;
    area.corners[mapDragging.index].z = world.z;
    updateArea(mapDragging.areaId);
  }

  function mapUp(event) {
    if (!mapDragging) return;
    mapDragging = null;
    mapCanvas.style.cursor = "crosshair";
    mapCanvas.releasePointerCapture?.(event.pointerId);
  }

  mapCanvas?.addEventListener("pointerdown", mapDown);
  window.addEventListener("pointermove", mapMove);
  window.addEventListener("pointerup", mapUp);

  for (const point of points) {
    if (point.kind === "door") addDoorGizmos(point);
  }
  for (const area of Object.values(editableAreas)) addAreaGizmo(area);
  syncEditor();
  gizmos.visible = gizmosVisible;
  scene?.add(gizmos);

  function clearQueuedActions() {
    input.consumeFire();
    input.consumeReload();
    input.consumeCameraStep();
    input.consumeCameraMode();
  }

  function hidePrompt() {
    shown = false;
    prompt.classList.remove("is-visible");
  }

  function setOpen(next) {
    if (next === open) return;
    open = next;
    menu.classList.toggle("is-open", open);
    menu.setAttribute("aria-hidden", String(!open));
    if (open) {
      hidePrompt();
      closeButton.focus({ preventScroll: true });
    }
    // Either way, a queued shot must not leak into the next frame.
    clearQueuedActions();
  }

  function action() {
    if (!active) return;
    if (active.kind === "console") {
      setOpen(true);
      return;
    }
    hidePrompt();
    onDoor?.(active.door);
  }

  function choose() {
    const px = player.root.position.x;
    const pz = player.root.position.z;

    if (active) {
      if (Math.hypot(px - active.x, pz - active.z) < active.far) {
        return active;
      }
    }

    let best = null;
    let bestDistance = Infinity;
    for (const point of points) {
      const distance = Math.hypot(px - point.x, pz - point.z);
      if (distance < point.near && distance < bestDistance) {
        best = point;
        bestDistance = distance;
      }
    }
    return best;
  }

  prompt.addEventListener("click", action);
  closeButton.addEventListener("click", () => setOpen(false));
  window.addEventListener("keydown", (event) => {
    if (event.code === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  });

  function update() {
    if (open) {
      // Gamepad B / Start closes the interface; Escape/click are DOM events.
      if (input.consumeCancel?.()) setOpen(false);
      return;
    }

    mapDraw();
    active = choose();

    if (active && !input.aiming && input.consumeFire()) {
      action();
      return;
    }

    if (!active) {
      hidePrompt();
      return;
    }

    const rect = screen.getBoundingClientRect();
    anchor.set(active.x, active.y, active.z);
    camera.getWorldDirection(forward);
    toAnchor.copy(anchor).sub(camera.position);
    const inFront = toAnchor.dot(forward) > 0;
    projected.copy(anchor).project(camera);

    const onScreen =
      inFront &&
      projected.z < 1 &&
      projected.x > -1.02 &&
      projected.x < 1.02 &&
      projected.y > -1.02 &&
      projected.y < 1.02;

    const visible = onScreen;
    if (visible !== shown) {
      shown = visible;
      prompt.classList.toggle("is-visible", visible);
    }
    if (visible) {
      prompt.style.left = `${(projected.x * 0.5 + 0.5) * rect.width}px`;
      prompt.style.top = `${(-projected.y * 0.5 + 0.5) * rect.height}px`;
      prompt.setAttribute(
        "aria-label",
        active.kind === "console"
          ? "interagir (N ou RT)"
          : "abrir porta (N ou RT)",
      );
    }
  }

  return {
    update,
    open: () => setOpen(true),
    close: () => setOpen(false),
    get isOpen() {
      return open;
    },
    get inRange() {
      return active !== null;
    },
    get active() {
      return active;
    },
    setGizmosVisible(value) {
      gizmos.visible = Boolean(value);
    },
    get gizmosVisible() {
      return gizmos.visible;
    },
    get isEditing() {
      return dragging !== null || mapDragging !== null;
    },
    point: INTERACT_POINT,
  };
}
