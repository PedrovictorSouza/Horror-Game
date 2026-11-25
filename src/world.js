import * as THREE from "three";
import { NIGHT, HORIZON } from "./world/config.js";
import { createSky, createLights, createMoon } from "./world/environment.js";
import { createStation } from "./world/station.js";
import { createBackdrop } from "./world/backdrop.js";

/**
 * Composition root. It connects the environment (sky, moon, lights) with the
 * station (its own builder). Gameplay consumes the returned API only.
 */
export function buildWorld(scene) {
  const animated = [];

  scene.background = new THREE.Color(NIGHT);
  // Dense exponential fog: past ~30 units the station stops existing. What you
  // cannot see is the whole point, so the fog is the level design now.
  scene.fog = new THREE.FogExp2(HORIZON, 0.031);

  /* ------------------------------ environment ----------------------------- */
  const sky = createSky();
  scene.add(sky);
  scene.add(createMoon());
  animated.push((dt, elapsed) => {
    sky.material.uniforms.time.value = elapsed;
  });

  const lights = createLights(scene);

  /* -------------------------------- station ------------------------------- */
  const station = createStation();
  scene.add(station.group);

  // The hall and the corridor are still images; the characters are 3D over them.
  const backdrop = createBackdrop(scene, "./assets/Scenario/Hall.png");
  const corridorBackdrop = createBackdrop(
    scene,
    "./assets/Scenario/corridor-1.png",
  );

  // A dying bulb: the moonlight never sits still, so nothing ever feels safe.
  const moonBase = lights.sun.intensity;
  const hemiBase = lights.hemisphere.intensity;
  animated.push((dt, elapsed) => {
    const flicker =
      0.82 +
      Math.sin(elapsed * 7.3) * 0.06 +
      Math.sin(elapsed * 17.9) * 0.05 +
      Math.sin(elapsed * 43.1) * 0.04;
    const dip = Math.max(0, Math.sin(elapsed * 0.61)) ** 8;
    const gain = flicker * (1 - dip * 0.35);
    lights.sun.intensity = moonBase * gain;
    lights.hemisphere.intensity = hemiBase * (0.9 + gain * 0.1);
  });

  return {
    // `maze` is the historical name player.js and main.js know; the value is
    // the station deck now.
    maze: station,
    station,
    // No circular props anymore; the camera rig can keep asking and get none.
    colliders: [],
    backdrop,
    corridorBackdrop,
    lights,
    terrain: { heightAt: station.heightAt },
    update(dt, elapsed) {
      for (const update of animated) update(dt, elapsed);
    },
  };
}
