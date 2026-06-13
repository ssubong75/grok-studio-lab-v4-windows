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
let pendingFont = "";
let originalAspect = 1;
let wheelZoomLevel = 1;
let lastWheelZoomAt = 0;

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
}

function applyFeather(rawValue) {
  if (!selectedShapeId) return;
  const value = Math.max(0, Math.round(Number(rawValue) || 0));
  els.featherRange.value = String(value);
  els.featherValue.value = String(value);
  imageEditor.setObjectPropertiesQuietly(selectedShapeId, { rx: value, ry: value });
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
    if (type === "rect") setFeatherControl(props.id);
    if (!type.includes("text") || !pendingFont) return;
    selectedTextId = props.id;
    imageEditor.changeTextStyle(props.id, { fontFamily: pendingFont }).catch(() => {});
  });

  imageEditor.on("selectionCleared", () => {
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
  bindEditorEvents();
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
