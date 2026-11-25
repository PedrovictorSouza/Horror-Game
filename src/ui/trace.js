/**
 * Dev-only call lifecycle trace. A ring buffer of named events shown under the
 * rig accordion so the exact frame where a transition goes wrong is visible.
 */
const MAX = 240;
const log = [];
let dirty = false;

export function trace(name, detail = "") {
  log.push({ time: performance.now(), name, detail });
  if (log.length > MAX) log.shift();
  dirty = true;
}

export function createTracePanel() {
  const pre = document.querySelector("#trace-log");
  const count = document.querySelector("#trace-count");
  if (!pre) return null;

  const render = () => {
    if (!dirty) return;
    dirty = false;
    const base = log.length ? log[0].time : performance.now();
    pre.textContent = log
      .map(
        (entry) =>
          `${((entry.time - base) / 1000).toFixed(2)}s  ${entry.name}${
            entry.detail ? `  ${entry.detail}` : ""
          }`,
      )
      .join("\n");
    if (count) count.textContent = String(log.length);
    pre.scrollTop = pre.scrollHeight;
  };

  setInterval(render, 250);
  window.__picoTrace = { trace, log };
  return { clear: () => (log.length = 0) };
}
