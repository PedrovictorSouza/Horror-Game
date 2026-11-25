import * as THREE from "three";
import { CameraManager } from "./camera/CameraManager.js";
import { createShooting } from "./game/shooting.js";
import { Input } from "./input.js";
import { Player } from "./entities/player.js";
import { createEnemy } from "./entities/enemy.js";
import { buildWorld } from "./world.js";
import { createCrt } from "./crt.js";
import {
  createInteraction,
  DOOR_TARGET_OFFSET,
} from "./ui/interaction.js";
import { createRigEditor } from "./ui/rigEditor.js";
import { createTracePanel, trace } from "./ui/trace.js";
import { createAtmosphere } from "./game/atmosphere.js";

const canvas = document.querySelector("#scene");
const loaderElement = document.querySelector("#loader");
const loaderBar = document.querySelector("#loader-bar");
const loaderStatus = document.querySelector("#loader-status");
const fatalElement = document.querySelector("#fatal");
const fatalMessage = document.querySelector("#fatal-message");
const introHint = document.querySelector("#intro-hint");
const fpsElement = document.querySelector("#fps");
const coordsElement = document.querySelector("#coords");
const fpsReadout = document.querySelector("#fps-readout");
const fpsBar = document.querySelector("#fps-bar");

const PLAYER_URL = "./assets/player/character.gltf";

// How many areas away from the pursuer count as safe for the red atmosphere.
// 1 = only the same area is hostile; 2 = keep it red one area away as well.
const SAFE_ROOMS = 1;

// The broadcast is rendered at a fixed 4:3 size and blown up by CSS. That is
// both the CRT look (a soft, low-res signal) and what keeps the SVG filter
// affordable: it always runs on 720x540, no matter how large the tube is.
const STAGE = { width: 720, height: 540 };

setupCrt();

start().catch((error) => {
  console.error(error);
  showFatal(error?.message ?? "Erro inesperado ao montar a cena.");
});

async function start() {
  const probe = document.createElement("canvas");
  if (!probe.getContext("webgl2")) {
    throw new Error("Este navegador não suporta WebGL2. Tente Chrome, Edge, Firefox ou Safari atualizados.");
  }

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(1);
  renderer.setSize(STAGE.width, STAGE.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Casters move, but not fast enough to need a new shadow map every frame.
  // Updating at 30 Hz halves this pass and is invisible at 60 fps.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    46,
    STAGE.width / STAGE.height,
    0.1,
    320,
  );
  const qualityParams = new URLSearchParams(window.location.search);
  const crt = createCrt(renderer, scene, camera, STAGE.width, STAGE.height, {
    samples: qualityParams.has("crtSamples")
      ? Number(qualityParams.get("crtSamples"))
      : 0,
    type:
      qualityParams.get("crtType") === "byte"
        ? THREE.UnsignedByteType
        : THREE.HalfFloatType,
  });

  setProgress(8, "esculpindo a ilha…");
  await nextFrame();
  const world = buildWorld(scene);

  setProgress(38, "carregando o player…");
  const player = new Player(scene);
  await player.load(PLAYER_URL, (progress) => {
    setProgress(38 + progress * 52, "carregando o player…");
  });
  player.colliders = world.colliders;
  player.maze = world.maze;
  player.setGroundHeight(world.terrain.heightAt);
  scene.add(player.root);
  // Dev-only left panel: pose the rig by hand and copy the coordinates.
  if (player.rig) createRigEditor({ player });
  createTracePanel();
  // Entities live outside the station: the enemy only receives the navigation
  // API and a body, never the deck meshes.
  const enemy = createEnemy(scene, world.station);
  // The thing that follows you is a black copy of you.
  enemy.setBody(player.createShadow());

  setProgress(96, "acendendo as luzes…");
  await nextFrame();

  const input = new Input(window);
  const cameraRig = new CameraManager(camera, world.station);
  const shooting = createShooting({
    scene,
    player,
    enemy,
    station: world.station,
    cameraRig,
  });

  const transition = { active: false };

  function showLoading() {
    loaderElement.hidden = false;
    loaderElement.classList.remove("is-done");
  }

  function hideLoading() {
    loaderElement.classList.add("is-done");
    setTimeout(() => {
      loaderElement.hidden = true;
    }, 750);
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function startDoorTransition(door) {
    if (transition.active) return;
    transition.active = true;
    trace("door:start", door.id);

    input.consumeFire();
    input.consumeReload();
    input.consumeCameraStep();
    input.consumeCameraMode();

    player.speed = 0;
    player.turnVelocity = 0;
    world.station.setDoorOpen(door.id, false);
    await wait(160);

    showLoading();
    await wait(650);

    // Cross the threshold and face into the room we just entered.
    const lowSide = player.root.position.z < door.z;
    const targetZ =
      door.z + (lowSide ? DOOR_TARGET_OFFSET : -DOOR_TARGET_OFFSET);
    player.root.position.set(
      door.x,
      world.terrain.heightAt(door.x, targetZ),
      targetZ,
    );
    player.yaw = lowSide ? Math.PI : 0;
    player.root.rotation.y = player.yaw;
    player.speed = 0;
    player.turnVelocity = 0;
    cameraRig.snapTo(player);
    trace("door:snap", `${door.id} -> z ${targetZ.toFixed(2)}`);
    world.station.setDoorOpen(door.id, true);

    await wait(250);
    hideLoading();
    await wait(750);
    transition.active = false;
    trace("door:end", door.id);
  }

  const debugStrip = document.querySelector("#debug");
  const debugVisible =
    !debugStrip || getComputedStyle(debugStrip).display !== "none";
  const editorPanel = document.querySelector("#editor");
  if (editorPanel && debugVisible) editorPanel.hidden = false;
  const rigPanel = document.querySelector("#rig-editor");
  if (rigPanel && debugVisible) rigPanel.hidden = false;

  const interaction = createInteraction({
    camera,
    player,
    input,
    scene,
    gizmosVisible: debugVisible,
    screen: document.querySelector(".screen"),
    prompt: document.querySelector("#interact"),
    menu: document.querySelector("#menu"),
    closeButton: document.querySelector("#menu-close"),
    doors: world.station.doors,
    portals: world.station.portals,
    areas: world.station.areas,
    walkableCells: world.station.walkableCells,
    onDoor: (door) => startDoorTransition(door),
  });

  const atmosphere = createAtmosphere({
    station: world.station,
    player,
    enemy,
    safeRooms: SAFE_ROOMS,
  });

  // Adaptive quality: the scene is cheap, but the CRT composer, CSS plates
  // and shadows can exceed 16.7 ms on weaker GPUs or large/retina windows.
  // We only step down, never oscillate, and never touch gameplay state.
  const quality = {
    level: 0,
    auto: true,
    bad: 0,
    lastChange: 0,
  };

  function applyQuality(level) {
    quality.level = Math.min(3, Math.max(0, level));
    quality.lastChange = elapsed;
    const app = document.querySelector("#app");
    if (quality.level >= 1) {
      app?.classList.add("low-fx");
    }
    if (quality.level >= 2) {
      renderer.shadowMap.enabled = false;
      renderer.shadowMap.needsUpdate = false;
    }
    if (quality.level >= 3) {
      crt.setEnabled(false);
      app?.classList.add("is-flat");
    }
    console.info(`[quality] ${quality.level} (fps ${quality.level ? "abaixo da meta" : "cheio"})`);
  }

  input.onFirstMove = () => hideHint();

  // C drops the tube warp (and the whole composer) without losing the tape
  // grain and the scanlines: the escape hatch for slower machines.
  window.addEventListener("keydown", (event) => {
    if (!event.repeat && event.code === "KeyG") {
      interaction.setGizmosVisible(!interaction.gizmosVisible);
      return;
    }
    if (event.key !== "c" && event.key !== "C") return;
    quality.auto = false;
    crt.setEnabled(!crt.enabled);
    document.querySelector("#app")?.classList.toggle("is-flat", !crt.enabled);
  });

  // Caught: the screen goes black, the island resets, the thing walks away.
  const CAUGHT_MS = 1600;
  let catching = false;
  let lastFear = -1;

  function handleCaught() {
    if (catching) return;
    catching = true;
    document.body.classList.add("is-caught");

    setTimeout(() => {
      player.root.position.set(0, world.terrain.heightAt(0, 0), 0);
      player.speed = 0;
      player.turnVelocity = 0;
      player.yaw = Math.PI;
      player.root.rotation.y = player.yaw;
      player.setFear(0);
      player.resetCombat();

      enemy.reset(player.root.position, gameTime);
      cameraRig.setTension(0);
      cameraRig.snapTo(player);

      document.body.classList.remove("is-caught");
      catching = false;
    }, CAUGHT_MS);
  }

  const clock = new THREE.Clock();
  const startedAt = performance.now();
  let elapsed = 0;
  let gameTime = 0;
  let hostileMix = 0;
  let fpsAccumulator = 0;
  let fpsFrames = 0;
  let coordsAccumulator = 0;
  let shadowAccumulator = 0;

  function hideHint() {
    introHint?.classList.add("is-gone");
  }

  setTimeout(hideHint, 9000);

  function renderFrame() {
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    elapsed = (performance.now() - startedAt) / 1000;

    input.poll();
    if (!transition.active) interaction.update();
    const paused =
      interaction.isOpen || transition.active || interaction.isEditing;

    if (!paused) {
      gameTime += dt;

      shadowAccumulator += rawDt;
      if (shadowAccumulator >= 1 / 20) {
        renderer.shadowMap.needsUpdate = true;
        shadowAccumulator = 0;
      }

      world.update(dt, gameTime);
      enemy.update(dt, gameTime, player.root.position, camera);

      const fear = enemy.fear;
      if (Math.abs(fear - lastFear) > 0.004) {
        lastFear = fear;
        document.documentElement.style.setProperty("--fear", fear.toFixed(3));
      }
      player.setFear(fear);
      cameraRig.setTension(fear);

      shooting.beginFrame(input);
      player.update(dt, shooting.inputFor(input), gameTime);
      cameraRig.update(dt, player, input, {
        fear,
        enemy: enemy.group.position,
        elapsed: gameTime,
      });

      // Pre-rendered rooms: the station is hidden and the still image takes over.
      const area = world.station.areaAt(
        player.root.position.x,
        player.root.position.z,
      );
      if (world.__lastArea !== area) {
        world.__lastArea = area;
        trace("area", String(area));
      }
      const hallBackdrop = area === "hall";
      const corridorBackdrop = area === "corridor";
      const activeBackdrop = hallBackdrop
        ? world.backdrop
        : corridorBackdrop
          ? world.corridorBackdrop
          : null;
      world.station.group.visible = !activeBackdrop;
      world.backdrop.setActive(hallBackdrop);
      world.corridorBackdrop.setActive(corridorBackdrop);
      if (activeBackdrop) {
        activeBackdrop.update(camera, camera.aspect, player.root.position);
      }

      atmosphere.update();
      const hostileTarget = atmosphere.active ? 1 : 0;
      hostileMix += (hostileTarget - hostileMix) * (1 - Math.exp(-dt * 2.4));
      crt.setHostile(hostileMix);

      shooting.update(dt, input);

      if (enemy.caught) handleCaught();
    } else {
      // A queued N/reload/arrow press must not leak out of the paused screen.
      input.consumeFire();
      input.consumeReload();
      input.consumeCameraStep();
      input.consumeCameraMode();
    }

    coordsAccumulator += rawDt;
    if (coordsAccumulator >= 0.08) {
      coordsAccumulator = 0;
      if (coordsElement) {
        const position = player.root.position;
        coordsElement.textContent = `X ${position.x.toFixed(2)}   Y ${position.y.toFixed(2)}   Z ${position.z.toFixed(2)}`;
      }
    }

    crt.render(elapsed);

    fpsAccumulator += rawDt;
    fpsFrames += 1;
    if (fpsAccumulator >= 0.5) {
      const measuredFps = fpsFrames / fpsAccumulator;
      const fps = Math.round(measuredFps);
      if (fpsElement) fpsElement.textContent = String(fps);
      if (fpsReadout) {
        fpsReadout.dataset.level = fps >= 50 ? "good" : fps >= 30 ? "warn" : "bad";
      }
      if (fpsBar) {
        fpsBar.style.transform = `scaleX(${Math.min(1, fps / 60).toFixed(3)})`;
      }

      // Three consecutive half-second windows below 55 fps are a real miss,
      // not a shader compile or a screenshot pause. The 4 s warm-up covers
      // first-frame shader compilation; the 1.5 s gap between steps stops a
      // single load spike from cascading straight to the cheapest mode.
      if (
        quality.auto &&
        elapsed > 4 &&
        !document.hidden &&
        quality.level < 3
      ) {
        if (measuredFps < 55) quality.bad += 1;
        else quality.bad = Math.max(0, quality.bad - 1);
        if (measuredFps < 32 && quality.bad >= 2) {
          // Severe dip: the composer is the biggest single cost here, so
          // bypass it at once instead of spending 4.5 s stepping down.
          applyQuality(3);
          quality.bad = 0;
        } else if (
          quality.bad >= 3 &&
          elapsed - quality.lastChange > 1.5
        ) {
          applyQuality(quality.level + 1);
          quality.bad = 0;
        }
      }

      fpsAccumulator = 0;
      fpsFrames = 0;
    }
  }

  renderer.setAnimationLoop(renderFrame);

  // First frame before revealing the scene.
  renderFrame();
  await nextFrame();
  setProgress(100, "pronto!");
  hideLoading();

  document.body.classList.add("is-ready");

  window.__pico = {
    ready: true,
    THREE,
    scene,
    camera,
    renderer,
    player,
    world,
    crt,
    quality,
    input,
    cameraRig,
    shooting,
    enemy,
    interaction,
    atmosphere,
    get state() {
      return {
        position: player.root.position.toArray(),
        yaw: player.root.rotation.y,
        speed: player.speed,
        turnVelocity: player.turnVelocity,
        camera: camera.position.toArray(),
        cameraShot: cameraRig.current?.id ?? null,
        combat: player.combat.getState(),
      };
    },
    // Combat has no input bindings yet: it is an animation layer waiting for
    // the real combat system. These hooks make it testable from the console.
    combat: {
      ready(value = true) {
        player.setCombatReady(value);
        return player.combat.getState();
      },
      attack(side = "right") {
        player.playAttack(side);
        return player.combat.getState();
      },
      hit(strength = 0.8, direction = null) {
        player.takeHit(strength, direction);
        return player.combat.getState();
      },
      reset() {
        player.resetCombat();
        return player.combat.getState();
      },
    },
  };

  // Examples:
  //   pico.combat.ready(true)
  //   pico.combat.attack("right")
  //   pico.combat.hit(0.8, Math.PI / 2)
  window.pico = window.__pico;
}

/**
 * Wires the CRT: builds the barrel-distortion map the SVG filter displaces the
 * picture with, keeps the 720x540 stage scaled to the tube, and lets `C` drop
 * the expensive filter while keeping the scanlines and the tape noise.
 */
function setupCrt() {
  const screen = document.querySelector(".screen");
  const picture = document.querySelector(".picture");

  const layout = () => {
    if (!screen || !picture) return;
    picture.style.setProperty("--crt-scale", String(screen.clientWidth / STAGE.width));
  };

  layout();
  window.addEventListener("resize", layout);
}

function setProgress(value, message) {
  if (loaderBar) loaderBar.style.width = `${Math.round(value)}%`;
  if (message && loaderStatus) loaderStatus.textContent = message;
}

function showFatal(message) {
  loaderElement.classList.add("is-done");
  loaderElement.hidden = true;
  fatalElement.hidden = false;
  fatalMessage.textContent = message;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
