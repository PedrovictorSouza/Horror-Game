/**
 * Dev-only rig editor: exposes the player's rig joints as degree sliders.
 * Moving a slider takes ownership of the pose (player.manualPose = true) so
 * the procedural animation stops overwriting it and the values can be copied
 * out as JSON.
 */
const JOINTS = [
  { key: "torso", label: "tronco", axes: ["x", "y", "z"], min: -70, max: 70 },
  { key: "head", label: "cabeça", axes: ["x", "y", "z"], min: -70, max: 70 },
  { key: "armPos", label: "braço pistola", axes: ["x", "z"], min: -140, max: 140 },
  { key: "elbowPos", label: "cotovelo pistola", axes: ["z"], min: 0, max: 150 },
  { key: "armNeg", label: "braço apoio", axes: ["x", "y", "z"], min: -140, max: 140 },
  { key: "elbowNeg", label: "cotovelo apoio", axes: ["z"], min: 0, max: 150 },
  { key: "legPos", label: "perna esq.", axes: ["z"], min: -80, max: 80 },
  { key: "kneePos", label: "joelho esq.", axes: ["z"], min: -130, max: 0 },
  { key: "legNeg", label: "perna dir.", axes: ["z"], min: -80, max: 80 },
  { key: "kneeNeg", label: "joelho dir.", axes: ["z"], min: -130, max: 0 },
  { key: "pelvis", label: "quadril", axes: ["y", "z"], min: -70, max: 70 },
];

const toDeg = (value) => Math.round((value * 180) / Math.PI);
const toRad = (value) => (value * Math.PI) / 180;

export function createRigEditor({ player }) {
  const panel = document.querySelector("#rig-editor");
  if (!panel || !player?.rig) return null;

  const rig = player.rig;
  const sliders = panel.querySelector("#rig-sliders");
  const json = panel.querySelector("#rig-json");
  const manual = panel.querySelector("#rig-manual");
  const copy = panel.querySelector("#rig-copy");
  const reset = panel.querySelector("#rig-reset");
  const status = panel.querySelector("#rig-status");
  const initial = {};
  const inputs = [];

  for (const joint of JOINTS) {
    const group = rig[joint.key];
    if (!group) continue;
    const section = document.createElement("div");
    section.className = "rig-group";
    for (const axis of joint.axes) {
      const key = `${joint.key}.${axis}`;
      const row = document.createElement("label");
      row.className = "rig-row";
      const name = document.createElement("span");
      name.textContent = `${joint.label}.${axis.toUpperCase()}`;
      const range = document.createElement("input");
      range.type = "range";
      range.min = String(joint.min);
      range.max = String(joint.max);
      range.step = "1";
      const current = toDeg(group.rotation[axis]);
      initial[key] = current;
      range.value = String(current);
      const value = document.createElement("span");
      value.textContent = `${current}°`;
      range.addEventListener("input", () => {
        const degrees = Number(range.value);
        group.rotation[axis] = toRad(degrees);
        value.textContent = `${degrees}°`;
        player.manualPose = true;
        manual.checked = true;
        render();
      });
      row.append(name, range, value);
      section.append(row);
      inputs.push({ key, group, axis, range, value });
    }
    sliders.append(section);
  }

  function render() {
    const out = {};
    for (const joint of JOINTS) {
      const group = rig[joint.key];
      if (!group) continue;
      out[joint.key] = {};
      for (const axis of joint.axes) {
        out[joint.key][axis] = toDeg(group.rotation[axis]);
      }
    }
    json.textContent = JSON.stringify(out, null, 2);
  }

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  manual.addEventListener("change", () => {
    player.manualPose = manual.checked;
    setStatus(manual.checked ? "pose manual ativa" : "animação normal");
  });

  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(json.textContent);
      setStatus("JSON copiado");
    } catch {
      setStatus("selecione o JSON e copie");
      json.focus();
    }
  });

  reset.addEventListener("click", () => {
    for (const input of inputs) {
      const degrees = initial[input.key];
      input.group.rotation[input.axis] = toRad(degrees);
      input.range.value = String(degrees);
      input.value.textContent = `${degrees}°`;
    }
    render();
    setStatus("resetado");
  });

  render();
  return panel;
}
