import { execFileSync } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * itch.io build.
 *
 * The dev page resolves `three` from /node_modules. itch serves the ZIP from a
 * subdirectory (html-classic.itch.zone/html/<id>/), so the shipped page must
 * use relative URLs and carry its own copy of three + the addons it imports.
 *
 * Output:
 *   dist/itch/               static tree, index.html at the root
 *   dist/pico-walker-itch.zip the upload file (contents of dist/itch)
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist", "itch");
const ZIP = path.join(ROOT, "dist", "pico-walker-itch.zip");

// The debug strip is a development tool. The shipped page hides it and gives
// the extra strip back to the tube. Set to false to keep POS/FPS on itch.
const HIDE_DEBUG = true;

// Every addon the game imports, plus their transitive dependencies.
const ADDONS = [
  "loaders/GLTFLoader.js",
  "utils/BufferGeometryUtils.js",
  "postprocessing/EffectComposer.js",
  "postprocessing/Pass.js",
  "postprocessing/ShaderPass.js",
  "postprocessing/MaskPass.js",
  "postprocessing/RenderPass.js",
  "postprocessing/OutputPass.js",
  "shaders/CopyShader.js",
  "shaders/OutputShader.js",
];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const importFrom = /^\s*import\s+[^;]*?from\s+["']([^"']+)["']/gm;
const imports = (text) => [...text.matchAll(importFrom)].map((m) => m[1]);

await rm(OUT, { recursive: true, force: true });
await rm(ZIP, { force: true });
await mkdir(OUT, { recursive: true });

await cp(path.join(ROOT, "src"), path.join(OUT, "src"), { recursive: true });
await cp(path.join(ROOT, "assets"), path.join(OUT, "assets"), {
  recursive: true,
});
await cp(path.join(ROOT, "styles.css"), path.join(OUT, "styles.css"));

const threeOut = path.join(OUT, "vendor", "three");
await mkdir(path.join(threeOut, "addons"), { recursive: true });
await cp(
  path.join(ROOT, "node_modules", "three", "build", "three.module.min.js"),
  path.join(threeOut, "three.module.min.js"),
);
// three r180 splits the module build: the module imports the core relatively.
await cp(
  path.join(ROOT, "node_modules", "three", "build", "three.core.min.js"),
  path.join(threeOut, "three.core.min.js"),
);
await cp(
  path.join(ROOT, "node_modules", "three", "LICENSE"),
  path.join(threeOut, "LICENSE"),
);
for (const relative of ADDONS) {
  const source = path.join(
    ROOT,
    "node_modules",
    "three",
    "examples",
    "jsm",
    relative,
  );
  const target = path.join(threeOut, "addons", relative);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target);
}

let html = await readFile(path.join(ROOT, "index.html"), "utf8");
html = html.replace(
  /"three":\s*"[^"]*"/,
  '"three": "./vendor/three/three.module.min.js"',
);
html = html.replace(
  /"three\/addons\/":\s*"[^"]*"/,
  '"three/addons/": "./vendor/three/addons/"',
);
if (HIDE_DEBUG) {
  html = html.replace(
    "</head>",
    "<style>#debug{display:none!important}.crt{width:min(95vw,126.66vh)}</style></head>",
  );
}
await writeFile(path.join(OUT, "index.html"), html);

if (!html.includes("./vendor/three/three.module.min.js")) {
  throw new Error("index.html import map was not rewritten");
}
if (!html.includes("./vendor/three/addons/")) {
  throw new Error("index.html addons map was not rewritten");
}

// The addons use relative imports among themselves and `three` from the map.
for await (const file of walk(path.join(threeOut, "addons"))) {
  if (!file.endsWith(".js")) continue;
  const text = await readFile(file, "utf8");
  for (const specifier of imports(text)) {
    if (!specifier.startsWith(".")) continue;
    const target = path.resolve(path.dirname(file), specifier);
    try {
      await stat(target);
    } catch {
      throw new Error(
        `missing addon dependency ${specifier} from ${path.relative(ROOT, file)}`,
      );
    }
  }
}

// Every `three/addons/...` import in the game must exist in the vendor tree.
for await (const file of walk(path.join(OUT, "src"))) {
  if (!file.endsWith(".js")) continue;
  const text = await readFile(file, "utf8");
  for (const specifier of imports(text)) {
    if (!specifier.startsWith("three/addons/")) continue;
    const relative = specifier.slice("three/addons/".length);
    try {
      await stat(path.join(threeOut, "addons", relative));
    } catch {
      throw new Error(
        `missing vendored addon ${specifier} imported by ${path.relative(ROOT, file)}`,
      );
    }
  }
}

execFileSync("zip", ["-r", "-q", ZIP, "."], { cwd: OUT, stdio: "ignore" });

const size = (await stat(ZIP)).size;
const files = await Array.fromAsync(walk(OUT));
console.log(
  `itch build: ${path.relative(ROOT, ZIP)} (${(size / 1024 / 1024).toFixed(2)} MB, ${files.length} files)`,
);
console.log(`  index.html: ${(await stat(path.join(OUT, "index.html"))).size} bytes`);
console.log(`  debug strip: ${HIDE_DEBUG ? "hidden" : "visible"}`);
console.log(`  three: three.module.min.js + three.core.min.js + ${ADDONS.length} addons`);
