const params = new URLSearchParams(window.location.search);
const itemId = params.get("item_id") || "";
const sourceUrl = params.get("source") || "";
const imageName = params.get("name") || "Image";

const els = {
  editor: document.querySelector("#imageEditor"),
  font: document.querySelector("#fontSelect"),
  fontControl: document.querySelector(".font-control"),
  featherControl: document.querySelector(".feather-control"),
  featherRange: document.querySelector("#featherRange"),
  featherValue: document.querySelector("#featherValue"),
  cropRatios: document.querySelector(".crop-ratios"),
  save: document.querySelector("#saveEditorBtn"),
  close: document.querySelector("#closeEditorBtn"),
  status: document.querySelector("#editorStatus"),
  ratios: Array.from(document.querySelectorAll("[data-ratio]")),
};

let imageEditor = null;
let selectedTextId = null;
let selectedShapeId = null;
let selectedObjectId = null;
let selectedObjectMenu = "";
let pendingFont = "";
let originalAspect = 1;
let wheelZoomLevel = 1;
let lastWheelZoomAt = 0;
const opacityControls = new Map();
const objectOpacityMenus = new Map();
const opacityValues = {
  draw: 100,
  shape: 100,
  icon: 100,
  text: 100,
};
const virtualRangeSteps = [
  [".tie-rotate-range", 1 / 720],
  [".tie-draw-range", 1 / 25],
  [".tie-stroke-range", 1 / 298],
  [".tie-text-range", 1 / 90],
  [".tie-removewhite-distance-range", 0.1],
  [".tie-brightness-range", 0.05],
  [".tie-noise-range", 0.01],
  [".tie-pixelate-range", 1 / 18],
  [".tie-colorfilter-threshold-range", 0.1],
  ["#tie-filter-tint-opacity", 0.1],
];
const virtualInputRangeSettings = [
  [".tie-rotate-range", -360, 360, 1],
  [".tie-draw-range", 5, 30, 1],
  [".tie-stroke-range", 2, 300, 1],
  [".tie-text-range", 10, 100, 1],
];

function setStatus(message, kind = "") {
  els.status.textContent = message || "";
  els.status.classList.toggle("error", kind === "error");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function blackTheme() {
  return {
    "common.backgroundColor": "#08090a",
    "common.border": "0px",
    "common.bi.image": "",
    "common.bi.display": "none",
    "menu.backgroundColor": "#111315",
    "menu.normalIcon.color": "#9ca4a8",
    "menu.activeIcon.color": "#fbad2e",
    "menu.disabledIcon.color": "#4f565a",
    "menu.hoverIcon.color": "#ffffff",
    "submenu.backgroundColor": "#171a1d",
    "submenu.normalIcon.color": "#a9b1b5",
    "submenu.activeIcon.color": "#fbad2e",
    "submenu.disabledIcon.color": "#4f565a",
    "submenu.hoverIcon.color": "#ffffff",
  };
}

function makeOpacityControl(menuName) {
  const host = document.createElement("li");
  const control = document.createElement("div");
  const label = document.createElement("span");
  const inputs = document.createElement("span");
  const range = document.createElement("input");
  const value = document.createElement("input");

  host.className = "custom-opacity-options tui-image-editor-newline";
  control.className = "custom-range-control opacity-control";
  label.className = "custom-range-label";
  label.textContent = "Opacity";
  inputs.className = "custom-range-inputs";
  range.type = "range";
  range.min = "0";
  range.max = "100";
  range.step = "1";
  range.value = "100";
  range.setAttribute("aria-label", `${menuName} opacity`);
  value.type = "number";
  value.min = "0";
  value.max = "100";
  value.step = "1";
  value.value = "100";
  value.setAttribute("aria-label", `${menuName} opacity value`);
  inputs.append(range, value);
  control.append(label, inputs);
  host.appendChild(control);
  opacityControls.set(menuName, { host, range, value });
  return host;
}

function syncNativeRangeFill(range) {
  if (!range) return;
  const min = Number(range.min) || 0;
  const max = Number(range.max) || 100;
  const value = Number(range.value) || 0;
  const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;
  range.style.setProperty("--range-fill", `${Math.min(100, Math.max(0, percent))}%`);
}

function normalizeEditorLabels() {
  document.querySelectorAll(".tui-image-editor-menu-text label.range").forEach((label) => {
    if (label.textContent.trim().toLowerCase() === "text size") label.textContent = "Text Size";
  });
}

function installCustomOptionPanels() {
  const cropList = document.querySelector(".tui-image-editor-menu-crop .tui-image-editor-submenu-item");
  const textList = document.querySelector(".tui-image-editor-menu-text .tui-image-editor-submenu-item");
  const shapeList = document.querySelector(".tui-image-editor-menu-shape .tui-image-editor-submenu-item");
  if (cropList && els.cropRatios) {
    const host = document.createElement("li");
    host.className = "custom-crop-options";
    host.appendChild(els.cropRatios);
    cropList.insertBefore(host, cropList.firstElementChild);
  }
  if (textList && els.fontControl) {
    const host = document.createElement("li");
    host.className = "custom-font-options";
    host.appendChild(els.fontControl);
    textList.insertBefore(host, textList.firstElementChild);
  }
  if (shapeList && els.featherControl) {
    const host = document.createElement("li");
    host.className = "custom-feather-options tui-image-editor-newline";
    host.appendChild(els.featherControl);
    shapeList.appendChild(host);
  }
  ["draw", "shape", "icon", "text"].forEach((menuName) => {
    const list = document.querySelector(`.tui-image-editor-menu-${menuName} .tui-image-editor-submenu-item`);
    if (list) list.appendChild(makeOpacityControl(menuName));
  });
}

function setFeatherControl(id = null) {
  selectedShapeId = id;
  const props = id
    ? imageEditor.getObjectProperties(id, ["type", "rx", "ry", "width", "height"])
    : null;
  const enabled = props?.type === "rect";
  const max = enabled
    ? Math.max(1, Math.round(Math.min(Number(props.width) || 0, Number(props.height) || 0) / 2))
    : 100;
  const value = enabled ? Math.round(Number(props.rx || props.ry) || 0) : 0;
  els.featherControl.classList.toggle("is-disabled", !enabled);
  [els.featherRange, els.featherValue].forEach((input) => {
    input.disabled = !enabled;
    input.max = String(max);
    input.value = String(Math.min(value, max));
  });
  syncNativeRangeFill(els.featherRange);
}

function applyFeather(rawValue) {
  if (!selectedShapeId) return;
  const value = Math.max(0, Math.round(Number(rawValue) || 0));
  els.featherRange.value = String(value);
  els.featherValue.value = String(value);
  syncNativeRangeFill(els.featherRange);
  imageEditor.setObjectPropertiesQuietly(selectedShapeId, { rx: value, ry: value });
}

function activeOpacityMenu() {
  const main = document.querySelector(".tui-image-editor-main");
  return ["draw", "shape", "icon", "text"]
    .find((menuName) => main?.classList.contains(`tui-image-editor-menu-${menuName}`)) || "";
}

function opacityMenuForType(rawType) {
  const type = String(rawType || "").toLowerCase();
  if (type === "path" || type === "line") return "draw";
  if (["rect", "circle", "triangle"].includes(type)) return "shape";
  if (type.includes("text")) return "text";
  if (type === "icon" || type === "path-group") return "icon";
  return "";
}

function setOpacityControl(menuName, rawValue) {
  const control = opacityControls.get(menuName);
  if (!control) return;
  const value = Math.min(100, Math.max(0, Math.round(Number(rawValue) || 0)));
  opacityValues[menuName] = value;
  control.range.value = String(value);
  control.value.value = String(value);
  syncNativeRangeFill(control.range);
}

function syncSelectedOpacity(id, rawType = "") {
  selectedObjectId = id || null;
  selectedObjectMenu = objectOpacityMenus.get(selectedObjectId) || opacityMenuForType(rawType);
  if (!selectedObjectId || !selectedObjectMenu) return;
  window.setTimeout(() => {
    const props = imageEditor.getObjectProperties(selectedObjectId, "opacity");
    if (props) setOpacityControl(selectedObjectMenu, Number(props.opacity) * 100);
  }, 0);
}

function applyOpacity(menuName, rawValue) {
  setOpacityControl(menuName, rawValue);
  if (!selectedObjectId || selectedObjectMenu !== menuName) return;
  imageEditor.setObjectPropertiesQuietly(selectedObjectId, {
    opacity: opacityValues[menuName] / 100,
  });
}

function bindOpacityControls() {
  opacityControls.forEach((control, menuName) => {
    control.range.addEventListener("input", () => applyOpacity(menuName, control.range.value));
    control.value.addEventListener("input", () => applyOpacity(menuName, control.value.value));
    syncNativeRangeFill(control.range);
  });
}

function adjustNativeRange(range, direction) {
  if (!range || range.disabled) return false;
  const min = Number(range.min) || 0;
  const max = Number(range.max) || 100;
  const step = Number(range.step) || 1;
  const value = Number(range.value) || 0;
  const next = Math.min(max, Math.max(min, value + direction * step));
  if (next === value) return false;
  range.value = String(next);
  range.dispatchEvent(new Event("input", { bubbles: true }));
  range.dispatchEvent(new Event("change", { bubbles: true }));
  syncNativeRangeFill(range);
  return true;
}

function virtualRangeStep(range) {
  return virtualRangeSteps.find(([selector]) => range.matches(selector))?.[1] || 0.05;
}

function adjustVirtualRange(range, direction) {
  const pointer = range?.querySelector(".tui-image-editor-virtual-range-pointer");
  if (!pointer || range.classList.contains("tui-image-editor-disabled")) return false;
  const input = range.closest(".tui-image-editor-range-wrap")
    ?.querySelector(".tui-image-editor-range-value");
  const setting = virtualInputRangeSettings.find(([selector]) => range.matches(selector));
  if (input && setting) {
    const [, min, max, step] = setting;
    const value = Number(input.value) || 0;
    const next = Math.min(max, Math.max(min, value + direction * step));
    if (next === value) return false;
    input.value = String(next);
    input.dispatchEvent(new Event("blur"));
    return true;
  }
  const rangeWidth = Math.max(1, range.getBoundingClientRect().width - pointer.getBoundingClientRect().width);
  const delta = direction * Math.max(1.5, rangeWidth * virtualRangeStep(range));
  const start = pointer.getBoundingClientRect().left + pointer.getBoundingClientRect().width / 2;
  pointer.dispatchEvent(new MouseEvent("mousedown", {
    bubbles: true,
    buttons: 1,
    clientX: start,
    screenX: start,
  }));
  document.dispatchEvent(new MouseEvent("mousemove", {
    bubbles: true,
    buttons: 1,
    clientX: start + delta,
    screenX: start + delta,
  }));
  document.dispatchEvent(new MouseEvent("mouseup", {
    bubbles: true,
    clientX: start + delta,
    screenX: start + delta,
  }));
  return true;
}

function bindWheelRangeControls() {
  const allowedMenus = [
    ".tui-image-editor-menu-rotate",
    ".tui-image-editor-menu-draw",
    ".tui-image-editor-menu-shape",
    ".tui-image-editor-menu-icon",
    ".tui-image-editor-menu-text",
    ".tui-image-editor-menu-filter",
  ].join(", ");
  els.editor.addEventListener("wheel", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(allowedMenus)) return;
    const direction = event.deltaY < 0 ? 1 : -1;
    const customInputs = target.closest(".custom-range-inputs, .feather-inputs");
    const nativeRange = customInputs?.querySelector('input[type="range"]');
    const virtualRange = target.closest(".tui-image-editor-range")
      || target.closest(".tui-image-editor-range-wrap")?.querySelector(".tui-image-editor-range");
    const changed = nativeRange
      ? adjustNativeRange(nativeRange, direction)
      : adjustVirtualRange(virtualRange, direction);
    if (changed) event.preventDefault();
  }, { passive: false });
}

function bindWheelZoom() {
  const surface = document.querySelector(".tui-image-editor-wrap");
  if (!surface) return;
  surface.addEventListener("wheel", (event) => {
    event.preventDefault();
    const now = Date.now();
    if (now - lastWheelZoomAt < 90) return;
    lastWheelZoomAt = now;
    const direction = event.deltaY < 0 ? 1 : -1;
    const next = Math.min(5, Math.max(1, wheelZoomLevel + direction * 0.25));
    if (next === wheelZoomLevel) return;
    const canvasSize = imageEditor.getCanvasSize();
    imageEditor.zoom({
      x: canvasSize.width / 2,
      y: canvasSize.height / 2,
      zoomLevel: next,
    });
    wheelZoomLevel = next;
    setStatus(`${Math.round(next * 100)}%`);
  }, { passive: false });
}

async function loadSystemFonts() {
  try {
    const data = await api("/api/system-fonts");
    const fonts = Array.isArray(data.fonts) ? data.fonts : [];
    const fragment = document.createDocumentFragment();
    fonts.forEach((font) => {
      const option = document.createElement("option");
      option.value = font;
      option.textContent = font;
      option.style.fontFamily = `"${font.replaceAll('"', '\\"')}"`;
      fragment.appendChild(option);
    });
    els.font.appendChild(fragment);
    els.font.options[0].textContent = `${fonts.length} system fonts`;
  } catch (error) {
    els.font.options[0].textContent = "System fonts unavailable";
    setStatus(error.message, "error");
  }
}

function bindEditorEvents() {
  imageEditor.on("objectActivated", (props) => {
    const type = String(props?.type || "").toLowerCase();
    syncSelectedOpacity(props?.id, type);
    selectedTextId = type.includes("text") ? props.id : null;
    setFeatherControl(type === "rect" ? props.id : null);
    if (!selectedTextId) return;
    const fontFamily = imageEditor.getObjectProperties(selectedTextId, "fontFamily")?.fontFamily;
    if (fontFamily && Array.from(els.font.options).some((option) => option.value === fontFamily)) {
      els.font.value = fontFamily;
    }
  });

  imageEditor.on("objectAdded", (props) => {
    const type = String(props?.type || "").toLowerCase();
    const menuName = activeOpacityMenu();
    if (props?.id && menuName) {
      objectOpacityMenus.set(props.id, menuName);
      imageEditor.setObjectPropertiesQuietly(props.id, {
        opacity: opacityValues[menuName] / 100,
      });
    }
    syncSelectedOpacity(props?.id, type);
    if (type === "rect") setFeatherControl(props.id);
    if (!type.includes("text") || !pendingFont) return;
    selectedTextId = props.id;
    imageEditor.changeTextStyle(props.id, { fontFamily: pendingFont }).catch(() => {});
  });

  imageEditor.on("selectionCleared", () => {
    selectedObjectId = null;
    selectedObjectMenu = "";
    selectedTextId = null;
    setFeatherControl();
  });

  els.font.addEventListener("change", () => {
    pendingFont = els.font.value;
    if (!pendingFont) return;
    if (!selectedTextId) {
      setStatus("Font selected. Add or select text.");
      return;
    }
    imageEditor.changeTextStyle(selectedTextId, { fontFamily: pendingFont })
      .then(() => setStatus(pendingFont))
      .catch((error) => setStatus(error.message, "error"));
  });

  els.ratios.forEach((button) => {
    button.addEventListener("click", () => {
      els.ratios.forEach((candidate) => candidate.classList.toggle("active", candidate === button));
      const cropMenu = document.querySelector(".tui-image-editor-menu-crop");
      if (cropMenu && !cropMenu.classList.contains("active")) cropMenu.click();
      window.setTimeout(() => {
        imageEditor.startDrawingMode("CROPPER");
        const ratioName = button.dataset.ratio;
        const ratio = ratioName === "original"
          ? originalAspect
          : Number(ratioName);
        imageEditor.setCropzoneRect(Number.isFinite(ratio) && ratio > 0 ? ratio : undefined);
      }, 0);
    });
  });

  els.featherRange.addEventListener("input", () => applyFeather(els.featherRange.value));
  els.featherValue.addEventListener("input", () => applyFeather(els.featherValue.value));
  bindOpacityControls();
  els.save.addEventListener("click", saveEdit);
  els.close.addEventListener("click", () => window.close());
}

async function saveEdit() {
  if (!imageEditor || !itemId) return;
  els.save.disabled = true;
  setStatus("Saving...");
  try {
    const isJpeg = /\.(jpe?g)(?:$|\?)/i.test(sourceUrl);
    const image = imageEditor.toDataURL({
      format: isJpeg ? "jpeg" : "png",
      quality: 0.96,
    });
    const data = await api("/api/image-editor/save", {
      method: "POST",
      body: JSON.stringify({ item_id: itemId, source_url: sourceUrl, image }),
    });
    setStatus(`Saved ${data.item?.title || ""}`);
    window.opener?.postMessage(
      { type: "grok-studio-image-edit-saved", itemId: data.item?.id || "" },
      window.location.origin,
    );
    window.setTimeout(() => window.close(), 450);
  } catch (error) {
    setStatus(error.message, "error");
    els.save.disabled = false;
  }
}

function init() {
  if (!itemId || !sourceUrl || !window.tui?.ImageEditor) {
    setStatus("The image editor could not be opened.", "error");
    els.save.disabled = true;
    return;
  }

  imageEditor = new tui.ImageEditor(els.editor, {
    includeUI: {
      loadImage: { path: sourceUrl, name: imageName },
      theme: blackTheme(),
      menu: ["crop", "flip", "rotate", "draw", "shape", "icon", "text", "filter"],
      initMenu: "",
      uiSize: { width: "100%", height: "100%" },
      menuBarPosition: "left",
    },
    cssMaxWidth: Math.max(600, window.innerWidth - 300),
    cssMaxHeight: Math.max(500, window.innerHeight - 170),
    usageStatistics: false,
  });
  installCustomOptionPanels();
  normalizeEditorLabels();
  bindEditorEvents();
  bindWheelRangeControls();
  bindWheelZoom();
  setFeatherControl();
  loadSystemFonts();
  window.setTimeout(() => {
    const canvasSize = imageEditor.getCanvasSize();
    if (canvasSize.width && canvasSize.height) originalAspect = canvasSize.width / canvasSize.height;
  }, 250);
}

init();
window.setInterval(() => {
  fetch("/api/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    keepalive: true,
  }).catch(() => {});
}, 3000);
