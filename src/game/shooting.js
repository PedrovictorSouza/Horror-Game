import * as THREE from "three";
import { Weapon } from "./weapon.js";
import { audio } from "./audio.js";
import { WEAPON_START, AMMO_CACHES } from "./content.js";

const AIM_RANGE = 30;
const AIM_HEIGHT = 1.2;

function makeGlowTexture(inner, mid) {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.4, mid);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 32, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The pistol loop, kept out of Player and out of the render loop.
 *
 * It owns aim intent, the shot ray, the stun hand-off to the creature and the
 * ammo caches. Everything the player actually sees is diegetic: the raised
 * arm, the laser dot, the recoil kick and the synthesized sounds.
 */
export function createShooting({ scene, player, enemy, station, cameraRig }) {
  const weapon = new Weapon(WEAPON_START);

  const dot = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture("rgba(255,120,90,1)", "rgba(255,40,30,0.5)"),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    }),
  );
  dot.scale.setScalar(0.45);
  dot.visible = false;
  dot.renderOrder = 4;
  scene.add(dot);

  const flash = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture("rgba(255,225,170,1)", "rgba(255,150,60,0.5)"),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    }),
  );
  flash.visible = false;
  flash.renderOrder = 5;
  scene.add(flash);

  const caches = AMMO_CACHES.map((data, index) => {
    const group = new THREE.Group();
    group.position.set(data.x, 0.3, data.z);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 0.45, 0.65),
      new THREE.MeshStandardMaterial({
        color: 0x2b313a,
        roughness: 0.65,
        metalness: 0.45,
      }),
    );
    group.add(body);
    const lid = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.09, 0.42),
      new THREE.MeshBasicMaterial({ color: 0x9fe6f2 }),
    );
    lid.position.y = 0.27;
    group.add(lid);
    scene.add(group);
    return { group, data, taken: false, phase: index * 1.7 };
  });

  const control = { move: 0, turn: 0, run: false };
  const forward = { x: 0, z: 1 };

  let aiming = false;
  let time = 0;
  let flashTimer = 0;
  let wasReloading = false;

  audio.unlock();

  function aimDirection() {
    forward.x = -Math.sin(player.yaw);
    forward.z = -Math.cos(player.yaw);
    return forward;
  }

  function rayOrigin() {
    const f = aimDirection();
    return {
      x: player.root.position.x + f.x * 0.45,
      z: player.root.position.z + f.z * 0.45,
    };
  }

  /** Where the shot would land: the creature if it is in the line, else wall. */
  function aimPoint() {
    const f = aimDirection();
    const origin = rayOrigin();
    const wallT = station.rayHit(
      origin.x,
      origin.z,
      origin.x + f.x * AIM_RANGE,
      origin.z + f.z * AIM_RANGE,
    );
    const wallDistance = AIM_RANGE * wallT;

    const px = enemy.group.position.x;
    const pz = enemy.group.position.z;
    const dx = px - origin.x;
    const dz = pz - origin.z;
    const along = dx * f.x + dz * f.z;
    const lateral = Math.abs(dx * f.z - dz * f.x);

    if (along > 0 && along < wallDistance && lateral < 0.55) {
      return { x: px, z: pz, hit: true };
    }
    return {
      x: origin.x + f.x * wallDistance,
      z: origin.z + f.z * wallDistance,
      hit: false,
    };
  }

  function showFlash(x, z) {
    flash.position.set(x, AIM_HEIGHT, z);
    flash.scale.setScalar(1.1);
    flash.material.opacity = 1;
    flash.visible = true;
    flashTimer = 0.14;
  }

  function fire() {
    const result = weapon.fire();
    if (result === "fired") {
      audio.shoot();
      player.applyRecoil?.(0.9);
      const point = aimPoint();
      showFlash(point.x, point.z);
      if (point.hit) {
        enemy.stun(3.2, aimDirection());
        audio.stun();
      }
    } else if (result === "empty") {
      audio.dry();
    }
  }

  function reload() {
    if (weapon.startReload()) audio.reloadStart();
  }

  return {
    get weapon() {
      return weapon;
    },
    get aiming() {
      return aiming;
    },
    /** Reads aim/reload intent; call before player.update. */
    beginFrame(input) {
      aiming = Boolean(input.aiming && player.loaded);
      player.setAiming(aiming);
      if (input.consumeReload()) reload();
    },
    /** Movement adapter: aiming roots the body but lets it pivot slowly. */
    inputFor(input) {
      // Aim-walk, like the RE remake reference: the upper body stays on the
      // sight while the legs keep a slow, planted walk. A frozen body is what
      // reads as RoboCop.
      control.move = aiming ? input.move * 0.3 : input.move;
      control.turn = aiming ? input.turn * 0.6 : input.turn;
      control.run = aiming ? false : input.run;
      return control;
    },
    /** Shot, laser and caches; call after player.update. */
    update(dt, input) {
      time += dt;
      weapon.update(dt);

      if (wasReloading && !weapon.reloading) audio.reloadEnd();
      wasReloading = weapon.reloading;

      if (input.consumeFire() && aiming) fire();

      if (aiming) {
        const point = aimPoint();
        dot.position.set(point.x, AIM_HEIGHT, point.z);
        dot.material.opacity = 0.55 + Math.sin(time * 16) * 0.2;
        dot.visible = true;
      } else {
        dot.visible = false;
      }

      if (flashTimer > 0) {
        flashTimer = Math.max(0, flashTimer - dt);
        const k = flashTimer / 0.14;
        flash.material.opacity = k;
        flash.scale.setScalar(1.1 + (1 - k) * 1.4);
        flash.visible = true;
      } else {
        flash.visible = false;
      }

      for (const cache of caches) {
        if (cache.taken) continue;
        cache.group.rotation.y += dt * 0.8;
        cache.group.position.y = 0.3 + Math.sin(time * 2 + cache.phase) * 0.06;
        const dx = player.root.position.x - cache.group.position.x;
        const dz = player.root.position.z - cache.group.position.z;
        if (dx * dx + dz * dz < 1.4 * 1.4) {
          cache.taken = true;
          cache.group.visible = false;
          weapon.addAmmo(cache.data.amount);
          audio.pickup();
        }
      }
    },
  };
}
