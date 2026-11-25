import * as THREE from "three";

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/**
 * The enemy: an entity, not part of the station.
 *
 * It knows the navigation API (pathfinding, collision, ground height) and the
 * scene, but nothing about how the deck or the walls were built. The body is
 * handed in later by main: a black clone of the player's rig.
 */
export function createEnemy(scene, navigation) {
  const group = new THREE.Group();
  group.name = "enemy";

  // The body is not built here: it is a black clone of the player's own rig,
  // handed over by main.js once the glTF is loaded. Until then only the eyes
  // exist, and the whole group is hidden anyway.
  const eyes = [];

  // The eyes are the only part that ignores fog: two red points that stay
  // visible through the mist long before the body resolves.
  const eyeMaterial = new THREE.MeshBasicMaterial({
    color: 0xff2b3a,
    fog: false,
    toneMapped: false,
  });
  const eyeGeometry = new THREE.SphereGeometry(0.021, 6, 5);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.position.set(side * 0.09, 4.4, -0.26);
    group.add(eye);
    eyes.push(eye);
  }

  // A small additive halo around the eyes. This is what you actually see
  // first: two red smudges in the fog, long before the body resolves.
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = 64;
  glowCanvas.height = 64;
  const glowContext = glowCanvas.getContext("2d");
  const glowGradient = glowContext.createRadialGradient(32, 32, 0, 32, 32, 32);
  glowGradient.addColorStop(0, "rgba(255, 70, 80, 0.95)");
  glowGradient.addColorStop(0.22, "rgba(214, 22, 40, 0.5)");
  glowGradient.addColorStop(1, "rgba(120, 0, 10, 0)");
  glowContext.fillStyle = glowGradient;
  glowContext.fillRect(0, 0, 64, 64);
  const glowTexture = new THREE.CanvasTexture(glowCanvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;

  const eyeGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  eyeGlow.position.set(0, 4.4, -0.26);
  eyeGlow.scale.setScalar(0.5);
  group.add(eyeGlow);

  group.visible = false;
  scene.add(group);

  let distance = 30;
  let lookFactor = 0;
  let caught = false;
  let speedNow = 0;
  let phase = 0;
  let spawned = false;
  let huntStart = 0;
  let path = [];
  let pathTimer = 0;
  let goalCell = null;
  let stunned = 0;
  const knock = { x: 0, z: 0 };
  let shadow = null;
  let rig = null;
  const scratchProject = new THREE.Vector3();

  /** Receives the black copy of the player's rig and wires its joints. */
  function setBody(model) {
    if (!model || shadow) return;
    shadow = model;
    group.add(shadow);
    group.updateMatrixWorld(true);

    // The eyes go where the player's head is: same rig, same height.
    const head = shadow.getObjectByName("head-pivot");
    if (head) {
      const box = new THREE.Box3().setFromObject(head);
      const center = box.getCenter(new THREE.Vector3());
      group.worldToLocal(center);
      const front = box.min.clone();
      group.worldToLocal(front);
      for (const eye of eyes) {
        eye.position.set(eye.position.x, center.y, front.z - 0.02);
      }
      eyeGlow.position.set(0, center.y, front.z - 0.03);
    }

    rig = {
      torso: shadow.getObjectByName("torso-pivot"),
      head: shadow.getObjectByName("head-pivot"),
      armPos: shadow.getObjectByName("arm-pos"),
      armNeg: shadow.getObjectByName("arm-neg"),
      legPos: shadow.getObjectByName("leg-pos"),
      legNeg: shadow.getObjectByName("leg-neg"),
      kneePos: shadow.getObjectByName("knee-pos"),
      kneeNeg: shadow.getObjectByName("knee-neg"),
    };
  }

  /** Shot: freeze the body for a moment and push it out of the way. */
  function stun(seconds, direction) {
    stunned = Math.max(stunned, seconds);
    const length = Math.hypot(direction?.x ?? 0, direction?.z ?? 0) || 1;
    knock.x = ((direction?.x ?? 0) / length) * 3.5;
    knock.z = ((direction?.z ?? 0) / length) * 7;
  }

  function placeAwayFrom(position) {
    const cell = navigation.farthestCell(position.x, position.z);
    group.position.set(cell.x, 0, cell.z);
    distance = Math.hypot(cell.x - position.x, cell.z - position.z);
    path = [];
    pathTimer = 0;
    goalCell = null;
  }

  return {
    group,
    setBody,
    stun,
    get stunned() {
      return stunned > 0;
    },
    get distance() {
      return distance;
    },
    get caught() {
      return caught;
    },
    /** 0 far away, 1 breathing on your neck. Drives camera, HUD and fear. */
    get fear() {
      return clamp01(1 - (distance - 2.6) / 17);
    },
    update(dt, elapsed, playerPosition, camera) {
      if (!spawned) {
        // Give the player a moment to believe the maze is empty.
        if (elapsed < 7) return;
        placeAwayFrom(playerPosition);
        spawned = true;
        huntStart = elapsed;
        group.visible = true;
      }

      const stunnedNow = stunned > 0;
      if (stunnedNow) {
        stunned = Math.max(0, stunned - dt);
        group.position.x += knock.x * dt;
        group.position.z += knock.z * dt;
        const drag = Math.max(0, 1 - 8 * dt);
        knock.x *= drag;
        knock.z *= drag;
        navigation.resolve(group.position, 0.17);
      }

      const dx = playerPosition.x - group.position.x;
      const dz = playerPosition.z - group.position.z;
      distance = Math.hypot(dx, dz) || 1e-4;

      // Is it actually on screen? With the aerial camera a world-space cone is
      // not enough — the projection is the only honest test of "the player is
      // looking at it". It freezes in the middle of the frame and starts
      // moving again as it slips toward the edge of the picture.
      let onScreen = 0;
      if (camera) {
        scratchProject.copy(group.position).project(camera);
        const edge = Math.max(
          Math.abs(scratchProject.x),
          Math.abs(scratchProject.y),
        );
        if (scratchProject.z < 1) {
          onScreen = clamp01((1.1 - edge) / 0.35);
        }
      }
      const targetLook = onScreen;
      lookFactor += (targetLook - lookFactor) * (1 - Math.exp(-9 * dt));

      // The longer the night goes on, the less it respects your walking speed.
      // Run speed is still 7.6, so sprinting always buys distance. The ramp
      // restarts after every catch, so a respawn is a small mercy.
      const baseSpeed = 1.55 + Math.min(3.65, (elapsed - huntStart) * 0.02);
      speedNow = baseSpeed * (1 - lookFactor);
      if (distance < 0.63) speedNow = 0;

      // Repath when the player changes cell, or every 0.45s as a safety net.
      pathTimer += dt;
      const target = navigation.cellAt(playerPosition.x, playerPosition.z);
      if (
        pathTimer > 0.45 ||
        path.length === 0 ||
        !goalCell ||
        goalCell.i !== target.i ||
        goalCell.j !== target.j
      ) {
        path = navigation.findPath(
          group.position.x,
          group.position.z,
          playerPosition.x,
          playerPosition.z,
        );
        pathTimer = 0;
        goalCell = target;
      }

      // Same corridor and nothing in between: walk straight at the player.
      // Otherwise chase the next cell centre from the BFS path.
      const direct = !navigation.blocked(
        group.position.x,
        group.position.z,
        playerPosition.x,
        playerPosition.z,
      );
      let moveX = 0;
      let moveZ = 0;
      if (!stunnedNow && speedNow > 0.01) {
        if (direct) {
          const length = distance || 1;
          moveX = dx / length;
          moveZ = dz / length;
        } else if (path.length) {
          // Steer at the furthest waypoint that is still in plain sight. With
          // 1-unit grid steps this hides the staircase and makes the thing
          // cut smooth arcs through the open hub and the ring.
          let best = 0;
          const lookAhead = Math.min(path.length - 1, 12);
          for (let k = lookAhead; k >= 0; k--) {
            if (
              !navigation.blocked(
                group.position.x,
                group.position.z,
                path[k].x,
                path[k].z,
              )
            ) {
              best = k;
              break;
            }
          }
          const next = path[best];
          const tx = next.x - group.position.x;
          const tz = next.z - group.position.z;
          const length = Math.hypot(tx, tz) || 1;
          moveX = tx / length;
          moveZ = tz / length;
          if (length < 0.6) path.splice(0, best + 1);
        }

        group.position.x += moveX * speedNow * dt;
        group.position.z += moveZ * speedNow * dt;
        navigation.resolve(group.position, 0.17);
      }

      // Face the way it is walking; face the player when it is standing still.
      const heading =
        speedNow > 0.01 && (moveX || moveZ)
          ? Math.atan2(-moveX, -moveZ)
          : Math.atan2(-dx, -dz);
      let delta = heading - group.rotation.y;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      group.rotation.y += delta * (1 - Math.exp(-5 * dt));

      phase += dt * (1.2 + speedNow * 2.4);
      group.position.y =
        (navigation.heightAt ? navigation.heightAt(group.position.x, group.position.z) : 0) +
        Math.sin(phase * 2) * 0.018;

      if (shadow) {
        const tilt = stunnedNow ? -0.42 : 0;
        shadow.rotation.z += (tilt - shadow.rotation.z) * (1 - Math.exp(-9 * dt));
      }

      // The shadow walks with the same joints the player uses, just driven by
      // a phase instead of input.
      if (rig) {
        const stride = Math.sin(phase) * 0.5 * clamp01(speedNow / 2.4);
        if (rig.legPos) rig.legPos.rotation.z = stride;
        if (rig.legNeg) rig.legNeg.rotation.z = -stride;
        if (rig.kneePos) rig.kneePos.rotation.z = -Math.max(0, stride) * 0.5;
        if (rig.kneeNeg) rig.kneeNeg.rotation.z = -Math.max(0, -stride) * 0.5;
        if (rig.armPos) rig.armPos.rotation.z = -stride * 0.55;
        if (rig.armNeg) rig.armNeg.rotation.z = stride * 0.55;
        if (rig.torso) rig.torso.rotation.x = Math.sin(phase) * 0.05;
        if (rig.head) rig.head.rotation.z = Math.sin(elapsed * 0.73) * 0.14;
      }

      const pulse = 0.65 + Math.sin(elapsed * 5.3) * 0.2 + lookFactor * 0.6;
      eyeMaterial.color.setRGB(1, 0.12 * pulse, 0.16 * pulse);
      eyeGlow.material.opacity = 0.35 + lookFactor * 0.55 + Math.sin(elapsed * 7.7) * 0.06;
      eyeGlow.scale.setScalar(0.4 + lookFactor * 0.25);

      // It only grabs what it can actually reach: no catches through walls,
      // and never while a bullet is still knocking it back.
      if (!stunnedNow && distance < 0.95 && direct && !caught) caught = true;
    },
    reset(playerPosition, elapsed = 0) {
      caught = false;
      huntStart = elapsed;
      placeAwayFrom(playerPosition);
      group.visible = true;
      spawned = true;
      lookFactor = 0;
    },
  };
}
