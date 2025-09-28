// Whiteboard front-end
// Supports adding images/links, uploading images, pasting images, drag-to-move, z-order, delete

const API = typeof browser !== "undefined" ? browser : chrome;
const BOARD = document.getElementById("board");
const BOARD_CONTENT = document.getElementById("boardContent");
const URL_INPUT = document.getElementById("imageUrl");
const ADD_URL_BTN = document.getElementById("addUrlBtn");
const FILE_INPUT = document.getElementById("fileInput");
const CLEAR_BTN = document.getElementById("clearBtn");
const ZOOM_IN_BTN = document.getElementById("zoomInBtn");
const ZOOM_OUT_BTN = document.getElementById("zoomOutBtn");
const ZOOM_LEVEL = document.getElementById("zoomLevel");
const SNAP_TOGGLE = document.getElementById("snapToggle");
const GRID_TYPE = document.getElementById("gridType");
const THEME_SELECT = document.getElementById("themeSelect");
const EXPORT_SELECT = document.getElementById("exportSelect");
const EXPORT_BTN = document.getElementById("exportBtn");

// Zoom and pan state
let scale = 1;
let tx = 0,
  ty = 0; // translate in CSS pixels
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.01;

// Grid snapping
const GRID_SIZE = 24; // matches CSS background-size
// Suggestion snap when snap-to-grid is OFF
const SUGGEST_SNAP_RANGE = 5; // px distance within which we hard-snap to suggestion
const SUGGEST_SHOW_RANGE = 12; // px window to show equal-spacing guide/labels
const DIST_INSET = 6; // px shorten distance lines from each end

// Track current equal-spacing snap targets (left/top) while dragging
let currentEqualTargetX = null;
let currentEqualTargetY = null;
function snapToGrid(n) {
  return Math.round(n / GRID_SIZE) * GRID_SIZE;
}
let snapToGridEnabled = true;

// Initialize snap toggle from storage and wire events
(async function initSnapSetting() {
  try {
    const { snapToGrid } = await API.storage.local.get({ snapToGrid: true });
    snapToGridEnabled = !!snapToGrid;
  } catch {}
  if (SNAP_TOGGLE) {
    SNAP_TOGGLE.checked = snapToGridEnabled;
    SNAP_TOGGLE.addEventListener("change", async (e) => {
      snapToGridEnabled = /** @type {HTMLInputElement} */ (e.target).checked;
      try {
        await API.storage.local.set({ snapToGrid: snapToGridEnabled });
      } catch {}
    });
  }
})();

// Grid type setting (lines | dots | none)
(async function initGridType() {
  try {
    const { gridType } = await API.storage.local.get({ gridType: "lines" });
    applyGridType(gridType);
    if (GRID_TYPE) GRID_TYPE.value = gridType;
  } catch {}
  if (GRID_TYPE) {
    GRID_TYPE.addEventListener("change", async (e) => {
      const val = /** @type {HTMLSelectElement} */ (e.target).value;
      applyGridType(val);
      try {
        await API.storage.local.set({ gridType: val });
      } catch {}
    });
  }
})();

function applyGridType(type) {
  BOARD_CONTENT.classList.remove("grid-dots", "grid-none");
  if (type === "dots") BOARD_CONTENT.classList.add("grid-dots");
  else if (type === "none") BOARD_CONTENT.classList.add("grid-none");
}

// Theme selection persistence and application
(async function initTheme() {
  try {
    const { boardTheme } = await API.storage.local.get({
      boardTheme: "darkgray",
    });
    applyTheme(boardTheme);
    if (THEME_SELECT) THEME_SELECT.value = boardTheme;
  } catch {}
  if (THEME_SELECT) {
    THEME_SELECT.addEventListener("change", async (e) => {
      const val = /** @type {HTMLSelectElement} */ (e.target).value;
      applyTheme(val);
      try {
        await API.storage.local.set({ boardTheme: val });
      } catch {}
    });
  }
})();

function applyTheme(theme) {
  // remove any previous theme- classes from body
  document.body.classList.forEach((cls) => {
    if (cls.startsWith("theme-")) document.body.classList.remove(cls);
  });
  document.body.classList.add(`theme-${theme}`);
}

// Export board to image/PDF
function getBoardBBox() {
  const items = BOARD_CONTENT.querySelectorAll(".wb-item");
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  items.forEach((el) => {
    const x = parseInt(el.style.left, 10) || 0;
    const y = parseInt(el.style.top, 10) || 0;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  });
  if (!isFinite(minX)) return { x: 0, y: 0, w: 1024, h: 768 };
  return {
    x: minX,
    y: minY,
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY),
  };
}

async function exportBoard(fmt) {
  const bbox = getBoardBBox();
  const canvas = document.createElement("canvas");
  // Render at up to 4K on the longest side for higher quality
  const targetMax = 3840;
  const maxDim = Math.max(bbox.w, bbox.h);
  const scaleFactor = fmt === "pdf" ? Math.max(1, targetMax / maxDim) : 1;
  canvas.width = Math.ceil(bbox.w * scaleFactor);
  canvas.height = Math.ceil(bbox.h * scaleFactor);
  const ctx = canvas.getContext("2d");

  // Fill background with current theme color
  const bgColor = getComputedStyle(BOARD_CONTENT).backgroundColor || "#ffffff";
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Scale context so we can draw using unscaled item coords
  if (scaleFactor !== 1) ctx.scale(scaleFactor, scaleFactor);

  // Draw each item
  const items = Array.from(BOARD_CONTENT.querySelectorAll(".wb-item"));
  for (const el of items) {
    const x = (parseInt(el.style.left, 10) || 0) - bbox.x;
    const y = (parseInt(el.style.top, 10) || 0) - bbox.y;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    // Images
    const img = el.querySelector("img");
    if (img && img.src) {
      await new Promise((resolve) => {
        if (img.complete) return resolve();
        img.onload = () => resolve();
        img.onerror = () => resolve();
      });
      try {
        ctx.drawImage(img, x, y, w, h);
      } catch {}
      continue;
    }
    // Video/iframe cannot be drawn directly; draw placeholder
    const vid = el.querySelector("video,iframe");
    if (vid) {
      ctx.fillStyle = "#000000";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#ffffff";
      ctx.font = "14px sans-serif";
      ctx.fillText("Embedded media", x + 8, y + 22);
      continue;
    }
    // Links or others
    ctx.fillStyle = "#111827";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.font = "14px sans-serif";
    ctx.fillText("Item", x + 8, y + 22);
  }

  if (fmt === "pdf") {
    // Build a one-page PDF embedding the board image (use JPEG for smaller output)
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const pdfBlob = await canvasToPdfBlob(canvas.width, canvas.height, dataUrl);
    downloadBlob(pdfBlob, `whiteboard.pdf`);
  } else {
    const mime = fmt === "jpeg" ? "image/jpeg" : "image/png";
    const quality = fmt === "jpeg" ? 0.92 : 1.0;
    const dataUrl = canvas.toDataURL(mime, quality);
    downloadDataUrl(dataUrl, `whiteboard.${fmt}`);
  }
}

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function canvasToPdfBlob(w, h, imgDataUrl) {
  // Minimal PDF wrapper around an image. For rich PDFs consider jsPDF later.
  const pxPerPt = 96 / 72; // 1pt = 1/72in; canvas is 96dpi typical
  const pageWpt = Math.round(w / pxPerPt);
  const pageHpt = Math.round(h / pxPerPt);
  const imgData = atob(imgDataUrl.split(",")[1]);
  const imgBytes = new Uint8Array(imgData.length);
  for (let i = 0; i < imgData.length; i++) imgBytes[i] = imgData.charCodeAt(i);

  // Very basic PDF (single image)
  function str2buf(s) {
    return new TextEncoder().encode(s);
  }
  const header = `%PDF-1.3\n`;
  const objects = [];
  const xref = [];
  let offset = 0;
  function addObject(content) {
    xref.push(offset);
    const buf = str2buf(content);
    objects.push(buf);
    offset += buf.length;
  }

  addObject(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  addObject(`2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`);
  addObject(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWpt} ${pageHpt}] /Resources << /XObject <</Im0 4 0 R>> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>\nendobj\n`
  );
  addObject(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgBytes.length} >>\nstream\n`
  );
  const imgStreamStart = offset + objects[objects.length - 1].length;
  const imgBuf = imgBytes;
  offset =
    imgStreamStart + imgBuf.length + str2buf(`\nendstream\nendobj\n`).length;
  xref.push(imgStreamStart - objects[objects.length - 1].length); // placeholder, adjust later
  objects.push(imgBuf);
  addObject(`\nendstream\nendobj\n`);
  addObject(
    `5 0 obj\n<< /Length 50 >>\nstream\nq\n${pageWpt} 0 0 ${pageHpt} 0 0 cm\n/Im0 Do\nQ\nendstream\nendobj\n`
  );

  // Build xref table
  let pdf = str2buf(header);
  let xrefPos = pdf.length;
  for (const obj of objects) {
    pdf = concatBuf(pdf, obj);
  }
  const xrefTable =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    xref
      .map((off, i) => `${String(off).padStart(10, "0")} 00000 n \n`)
      .join("");
  const trailer = `trailer\n<< /Size ${
    objects.length + 1
  } /Root 1 0 R >>\nstartxref\n${pdf.length}\n%%EOF`;
  pdf = concatBuf(pdf, str2buf(xrefTable));
  pdf = concatBuf(pdf, str2buf(trailer));
  return new Blob([pdf], { type: "application/pdf" });
}

function concatBuf(a, b) {
  const c = new Uint8Array(a.length + b.length);
  c.set(a, 0);
  c.set(b, a.length);
  return c;
}

if (EXPORT_BTN) {
  EXPORT_BTN.addEventListener("click", async () => {
    const fmt = (EXPORT_SELECT && EXPORT_SELECT.value) || "png";
    await exportBoard(fmt);
  });
}

// Alignment guides layer
const guidesLayer = document.createElement("div");
guidesLayer.className = "wb-guides";
const guideV1 = document.createElement("div");
guideV1.className = "wb-guide-vert";
const guideV2 = document.createElement("div");
guideV2.className = "wb-guide-vert";
const guideH1 = document.createElement("div");
guideH1.className = "wb-guide-horz";
const guideH2 = document.createElement("div");
guideH2.className = "wb-guide-horz";
// Item-to-item guides (green)
const guideVItem = document.createElement("div");
guideVItem.className = "wb-guide-vert item";
const guideHItem = document.createElement("div");
guideHItem.className = "wb-guide-horz item";
// Distance overlays
const distH = document.createElement("div");
distH.className = "wb-distance-horz";
distH.innerHTML =
  '<div class="wb-distance-line"></div><div class="wb-distance-label"></div>';
const distV = document.createElement("div");
distV.className = "wb-distance-vert";
distV.innerHTML =
  '<div class="wb-distance-line"></div><div class="wb-distance-label"></div>';
guidesLayer.appendChild(guideV1);
guidesLayer.appendChild(guideV2);
guidesLayer.appendChild(guideH1);
guidesLayer.appendChild(guideH2);
guidesLayer.appendChild(guideVItem);
guidesLayer.appendChild(guideHItem);
guidesLayer.appendChild(distH);
guidesLayer.appendChild(distV);
if (BOARD_CONTENT) BOARD_CONTENT.appendChild(guidesLayer);

function hideGridGuides() {
  [guideV1, guideV2, guideH1, guideH2].forEach(
    (el) => (el.style.display = "none")
  );
  guideVItem.style.display = "none";
  guideHItem.style.display = "none";
  distH.style.display = "none";
  distV.style.display = "none";
  currentEqualTargetX = null;
  currentEqualTargetY = null;
}

function showGridGuidesForRect(left, top, width, height) {
  if (snapToGridEnabled) {
    hideGridGuides();
    return;
  }
  // Hide blue grid guides; we only show green item guides
  [guideV1, guideV2, guideH1, guideH2].forEach(
    (el) => (el.style.display = "none")
  );

  // Item-to-item alignment: find nearby other items and show green guides when within half-cell
  const others = Array.from(BOARD_CONTENT.querySelectorAll(".wb-item")).filter(
    (el) => !el.classList.contains("wb-dragging")
  );
  let snapX = null;
  let snapY = null;
  const cx = left + width / 2;
  const cy = top + height / 2;
  for (const other of others) {
    const ol = other.offsetLeft;
    const ot = other.offsetTop;
    const ow = other.offsetWidth;
    const oh = other.offsetHeight;
    const otherCenters = { cx: ol + ow / 2, cy: ot + oh / 2 };

    // X targets: other left/center/right
    const xTargets = [ol, otherCenters.cx, ol + ow];
    for (const xt of xTargets) {
      if (Math.abs(cx - xt) <= GRID_SIZE / 2) snapX = xt;
      if (Math.abs(left - xt) <= GRID_SIZE / 2) snapX = xt;
      if (Math.abs(left + width - xt) <= GRID_SIZE / 2) snapX = xt;
    }

    // Y targets: other top/center/bottom
    const yTargets = [ot, otherCenters.cy, ot + oh];
    for (const yt of yTargets) {
      if (Math.abs(cy - yt) <= GRID_SIZE / 2) snapY = yt;
      if (Math.abs(top - yt) <= GRID_SIZE / 2) snapY = yt;
      if (Math.abs(top + height - yt) <= GRID_SIZE / 2) snapY = yt;
    }
  }
  // Equal-spacing suggestions: A-B gap = g → suggest B-C gap = g (right) and C-A gap = g (left)
  let spacingX = null;
  let spacingY = null;
  let spacingXPair = null; // {A,B,gap,dir}
  let spacingYPair = null; // {A,B,gap,dir}
  if (others.length >= 2) {
    const sortedX = [...others].sort((a, b) => a.offsetLeft - b.offsetLeft);
    let bestDX = Infinity;
    for (let i = 0; i < sortedX.length - 1; i++) {
      const A = sortedX[i];
      const B = sortedX[i + 1];
      const Ax = A.offsetLeft,
        Aw = A.offsetWidth;
      const Bx = B.offsetLeft,
        Bw = B.offsetWidth;
      const gapAB = Bx - (Ax + Aw);
      if (gapAB > 0) {
        // Suggest after B with same gap
        const targetRight = Bx + Bw + gapAB; // C.left
        const dRight = Math.abs(left - targetRight);
        if (dRight <= SUGGEST_SHOW_RANGE && dRight < bestDX) {
          bestDX = dRight;
          spacingX = targetRight;
          spacingXPair = { A, B, gap: gapAB, dir: "right" };
        }
        // Suggest before A with same gap
        const targetLeftPos = Ax - gapAB - width; // C.left
        const dLeft = Math.abs(left - targetLeftPos);
        if (dLeft <= SUGGEST_SHOW_RANGE && dLeft < bestDX) {
          bestDX = dLeft;
          spacingX = targetLeftPos;
          spacingXPair = { A, B, gap: gapAB, dir: "left" };
        }
      }
    }
    const sortedY = [...others].sort((a, b) => a.offsetTop - b.offsetTop);
    let bestDY = Infinity;
    for (let i = 0; i < sortedY.length - 1; i++) {
      const A = sortedY[i];
      const B = sortedY[i + 1];
      const Ay = A.offsetTop,
        Ah = A.offsetHeight;
      const By = B.offsetTop,
        Bh = B.offsetHeight;
      const gapABY = By - (Ay + Ah);
      if (gapABY > 0) {
        const targetBelow = By + Bh + gapABY; // C.top
        const dBelow = Math.abs(top - targetBelow);
        if (dBelow <= SUGGEST_SHOW_RANGE && dBelow < bestDY) {
          bestDY = dBelow;
          spacingY = targetBelow;
          spacingYPair = { A, B, gap: gapABY, dir: "below" };
        }
        const targetAbove = Ay - gapABY - height; // C.top
        const dAbove = Math.abs(top - targetAbove);
        if (dAbove <= SUGGEST_SHOW_RANGE && dAbove < bestDY) {
          bestDY = dAbove;
          spacingY = targetAbove;
          spacingYPair = { A, B, gap: gapABY, dir: "above" };
        }
      }
    }
  }

  const guideX = spacingX != null ? spacingX : snapX;
  if (guideX != null) {
    // Hide snap-to line if we are showing distance suggestion (spacingX)
    if (spacingX != null) {
      guideVItem.style.display = "none";
      currentEqualTargetX = guideX;
    } else {
      guideVItem.style.left = Math.round(guideX) + "px";
      guideVItem.style.display = "block";
      currentEqualTargetX = null;
    }
    // Show horizontal distance line for equal spacing (both directions)
    if (spacingXPair) {
      const Ax = spacingXPair.A.offsetLeft,
        Aw = spacingXPair.A.offsetWidth;
      const Bx = spacingXPair.B.offsetLeft,
        Bw = spacingXPair.B.offsetWidth;
      const midY = Math.round(top + height / 2);
      let startX, endX;
      if (spacingXPair.dir === "right") {
        startX = Bx + Bw; // B.right
        endX = guideX; // C.left
      } else {
        startX = guideX + width; // C.right
        endX = Ax; // A.left
      }
      const minX = Math.min(startX, endX) + DIST_INSET;
      const maxX = Math.max(startX, endX) - DIST_INSET;
      distH.style.left = minX + "px";
      distH.style.top = midY - 4 + "px";
      distH.style.width = Math.max(0, maxX - minX) + "px";
      distH.style.height = "16px";
      distH.style.display = "block";
    }
  } else {
    guideVItem.style.display = "none";
    distH.style.display = "none";
  }
  const guideY = spacingY != null ? spacingY : snapY;
  if (guideY != null) {
    if (spacingY != null) {
      guideHItem.style.display = "none";
      currentEqualTargetY = guideY;
    } else {
      guideHItem.style.top = Math.round(guideY) + "px";
      guideHItem.style.display = "block";
      currentEqualTargetY = null;
    }
    if (spacingYPair) {
      const Ay = spacingYPair.A.offsetTop,
        Ah = spacingYPair.A.offsetHeight;
      const By = spacingYPair.B.offsetTop,
        Bh = spacingYPair.B.offsetHeight;
      const midX = Math.round(left + width / 2);
      let startY, endY;
      if (spacingYPair.dir === "below") {
        startY = By + Bh; // B.bottom
        endY = guideY; // C.top
      } else {
        startY = guideY + height; // C.bottom
        endY = Ay; // A.top
      }
      const minY = Math.min(startY, endY) + DIST_INSET;
      const maxY = Math.max(startY, endY) - DIST_INSET;
      distV.style.left = midX - 1 + "px";
      distV.style.top = minY + "px";
      distV.style.height = Math.max(0, maxY - minY) + "px";
      distV.style.width = "16px";
      distV.style.display = "block";
    }
  } else {
    guideHItem.style.display = "none";
    distV.style.display = "none";
  }
}

// Hard snap to current suggestion lines within a small range
function applySuggestSnap(x, y, w, h) {
  // Read current guide positions (if visible)
  const vLine =
    guideVItem && guideVItem.style.display === "block"
      ? parseFloat(guideVItem.style.left)
      : null;
  const hLine =
    guideHItem && guideHItem.style.display === "block"
      ? parseFloat(guideHItem.style.top)
      : null;

  let ax = x;
  let ay = y;

  // Vertical snap: snap left, right, or center to the vLine if within range
  if (vLine != null && !Number.isNaN(vLine)) {
    const targetsX = [x, x + w, x + w / 2];
    const deltasX = targetsX.map((t) => Math.abs(t - vLine));
    const minIdx = deltasX.indexOf(Math.min(...deltasX));
    const nearestTargetX = targetsX[minIdx];
    const d = vLine - nearestTargetX;
    if (Math.abs(d) <= SUGGEST_SNAP_RANGE) {
      if (minIdx === 0) ax = vLine; // left edge to line
      else if (minIdx === 1) ax = vLine - w; // right edge to line
      else ax = vLine - w / 2; // center to line
    }
  }

  // Horizontal snap: snap top, bottom, or center to the hLine if within range
  if (hLine != null && !Number.isNaN(hLine)) {
    const targetsY = [y, y + h, y + h / 2];
    const deltasY = targetsY.map((t) => Math.abs(t - hLine));
    const minIdxY = deltasY.indexOf(Math.min(...deltasY));
    const dY = hLine - targetsY[minIdxY];
    if (Math.abs(dY) <= SUGGEST_SNAP_RANGE) {
      if (minIdxY === 0) ay = hLine; // top
      else if (minIdxY === 1) ay = hLine - h; // bottom
      else ay = hLine - h / 2; // center
    }
  }

  return { x: ax, y: ay };
}

// Panning state
let isPanning = false;
let panStartX = 0;
let panStartY = 0;

// Flag to prevent re-rendering during drag operations
let isDraggingItem = false;

// Click-to-front functionality
let zIndexCounter = 10; // Start reasonable; we'll keep increasing on clicks

/** @typedef {{ id:string, type:'image'|'video'|'youtube'|'link', x:number, y:number, z:number, w:number, h:number, src?:string, url?:string, title?:string }} Item */

async function readItems() {
  const { whiteboardItems } = await API.storage.local.get({
    whiteboardItems: [],
  });
  return Array.isArray(whiteboardItems) ? whiteboardItems : [];
}

async function writeItems(items) {
  await API.storage.local.set({ whiteboardItems: items });
}

function createItemElement(item) {
  const tpl = document.getElementById("item-tpl");
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.style.left = item.x + "px";
  node.style.top = item.y + "px";
  node.style.zIndex = String(item.z || ++zIndexCounter);
  node.style.width = (item.w || 200) + "px";
  node.style.height = item.h || "auto";
  node.dataset.id = item.id;

  const body = node.querySelector(".wb-item-body");
  if (item.type === "image" && item.src) {
    // Mark node as image item to allow transparent background styling
    node.classList.add("wb-item-image");
    const img = document.createElement("img");
    img.referrerPolicy = "no-referrer";
    img.src = item.src;
    img.alt = "image";
    img.decoding = "async";

    // Store original aspect ratio when image loads
    img.onload = function () {
      const originalAspectRatio = this.naturalWidth / this.naturalHeight;
      node.dataset.originalAspectRatio = originalAspectRatio;
    };

    body.appendChild(img);

    // Add crop button event listener for images
    const cropBtn = node.querySelector(".wb-crop");
    if (cropBtn) {
      cropBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        startCrop(node, item);
      });
    }
  } else if (item.type === "youtube" && item.src) {
    const videoElement = createVideoElement(
      "YouTube Video",
      item.src,
      "youtube"
    );
    videoElement.classList.add("wb-youtube-video");
    body.appendChild(videoElement);
  } else if (item.type === "video" && item.src) {
    body.appendChild(createVideoElement("Video", item.src, "video"));
  } else if (item.type === "link" && item.url) {
    // If link is YouTube, render embedded player for a better experience
    const yt = parseYouTube(item.url);
    if (yt) {
      const videoElement = createVideoElement(
        "YouTube Video",
        yt.embedUrl,
        "youtube"
      );
      videoElement.classList.add("wb-youtube-video");
      body.appendChild(videoElement);
    } else {
      const wrap = document.createElement("div");
      wrap.className = "wb-link";
      const a = document.createElement("a");
      a.href = item.url;
      a.textContent = item.title || item.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      const openBtn = document.createElement("button");
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", () => {
        API.tabs.create({ url: item.url });
      });
      wrap.appendChild(a);
      wrap.appendChild(openBtn);
      body.appendChild(wrap);
    }
  }

  // Close button
  const closeBtn = node.querySelector(".wb-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const items = await readItems();
      const idx = items.findIndex((i) => i.id === item.id);
      if (idx !== -1) {
        items.splice(idx, 1);
        await writeItems(items);
        node.remove();
      }
    });
  }

  // Dragging and resizing
  enableDrag(node, item);
  enableResize(node, item);

  return node;
}

function enableDrag(node, item) {
  let offsetX = 0,
    offsetY = 0,
    dragging = false;

  function onMouseDown(ev) {
    console.log("onMouseDown triggered on:", ev.target, "for item:", item.id);

    if (ev.button !== 0) {
      console.log("Not left button, ignoring");
      return;
    }

    // Don't start drag if clicking on buttons or resize handles
    if (
      ev.target.classList.contains("wb-resize-handle") ||
      ev.target.classList.contains("wb-close") ||
      ev.target.classList.contains("wb-crop") ||
      ev.target.closest(".wb-close") ||
      ev.target.closest(".wb-crop")
    ) {
      console.log("Click on button/handle, ignoring");
      return;
    }

    // For video items, only allow dragging from the header
    if (
      (item.type === "youtube" || item.type === "video") &&
      !ev.target.closest(".wb-video-header")
    ) {
      console.log("Video item not clicked on header, ignoring");
      return; // Don't start drag if not clicking on header
    }

    // Always bring to front on mousedown (whether it becomes a drag or click)
    console.log("MouseDown on item, calling bringToFront:", node);
    bringToFront(node);

    ev.preventDefault();
    ev.stopPropagation();

    dragging = true;
    isDraggingItem = true;
    offsetX = ev.clientX - node.offsetLeft;
    offsetY = ev.clientY - node.offsetTop;

    // Add dragging class for visual feedback
    node.classList.add("wb-dragging");

    document.addEventListener("mousemove", onMouseMove, { passive: false });
    document.addEventListener("mouseup", onMouseUp);
  }

  async function onMouseUp(ev) {
    if (!dragging) return;

    dragging = false;
    node.classList.remove("wb-dragging");

    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);

    // Persist final position without triggering re-render
    const items = await readItems();
    const idx = items.findIndex((i) => i.id === item.id);
    if (idx !== -1) {
      items[idx].x = parseInt(node.style.left, 10) || 0;
      items[idx].y = parseInt(node.style.top, 10) || 0;
      items[idx].z = item.z;
      // Update storage directly without using writeItems to avoid triggering listener
      await API.storage.local.set({ whiteboardItems: items });
    }

    // Clear the flag after a small delay to allow storage update to complete
    setTimeout(() => {
      isDraggingItem = false;
    }, 50);

    hideGridGuides();
  }

  function onMouseMove(ev) {
    if (!dragging) return;

    ev.preventDefault();
    const x = ev.clientX - offsetX;
    const y = ev.clientY - offsetY;
    let nx = snapToGridEnabled ? snapToGrid(x) : x;
    let ny = snapToGridEnabled ? snapToGrid(y) : y;

    // Hard snap to visible suggestion lines when close (equal-spacing targets)
    if (!snapToGridEnabled) {
      const w = node.offsetWidth;
      const h = node.offsetHeight;
      // equal-spacing left/top snap
      if (
        currentEqualTargetX != null &&
        Math.abs(nx - currentEqualTargetX) <= SUGGEST_SNAP_RANGE
      ) {
        nx = currentEqualTargetX;
      }
      if (
        currentEqualTargetY != null &&
        Math.abs(ny - currentEqualTargetY) <= SUGGEST_SNAP_RANGE
      ) {
        ny = currentEqualTargetY;
      }
      // Additionally snap to green alignment guides (left/right/center, top/bottom/center)
      const snapped = applySuggestSnap(nx, ny, w, h);
      nx = snapped.x;
      ny = snapped.y;
    }

    node.style.left = nx + "px";
    node.style.top = ny + "px";
    showGridGuidesForRect(nx, ny, node.offsetWidth, node.offsetHeight);
  }

  node.addEventListener("mousedown", onMouseDown);
}

function enableResize(node, item) {
  let resizing = false;
  let resizeHandle = null;
  let startX = 0,
    startY = 0;
  let startWidth = 0,
    startHeight = 0;
  let startLeft = 0,
    startTop = 0;

  // Create resize handles
  const handles = ["nw", "ne", "sw", "se"]; // northwest, northeast, southwest, southeast
  handles.forEach((handle) => {
    const handleEl = document.createElement("div");
    handleEl.className = `wb-resize-handle wb-resize-${handle}`;
    handleEl.addEventListener("mousedown", (e) => onResizeStart(e, handle));
    node.appendChild(handleEl);
  });

  function onResizeStart(ev, handle) {
    ev.preventDefault();
    ev.stopPropagation();

    resizing = true;
    resizeHandle = handle;
    startX = ev.clientX;
    startY = ev.clientY;
    startWidth = node.offsetWidth;
    startHeight = node.offsetHeight;
    startLeft = node.offsetLeft;
    startTop = node.offsetTop;

    document.addEventListener("mousemove", onResizeMove);
    document.addEventListener("mouseup", onResizeEnd);
  }

  function onResizeMove(ev) {
    if (!resizing) return;

    const deltaX = ev.clientX - startX;
    const deltaY = ev.clientY - startY;

    // Use original aspect ratio if available, otherwise use current aspect ratio
    const originalAspectRatio = parseFloat(node.dataset.originalAspectRatio);
    const aspectRatio = originalAspectRatio || startWidth / startHeight;

    let newWidth = startWidth;
    let newHeight = startHeight;
    let newLeft = startLeft;
    let newTop = startTop;

    // Calculate new dimensions based on handle while maintaining aspect ratio
    switch (resizeHandle) {
      case "se": // southeast - bottom right
        newWidth = Math.max(100, startWidth + deltaX);
        newHeight = newWidth / aspectRatio;
        break;
      case "sw": // southwest - bottom left
        newWidth = Math.max(100, startWidth - deltaX);
        newHeight = newWidth / aspectRatio;
        newLeft = startLeft + (startWidth - newWidth);
        break;
      case "ne": // northeast - top right
        newHeight = Math.max(80, startHeight - deltaY);
        newWidth = newHeight * aspectRatio;
        newTop = startTop + (startHeight - newHeight);
        break;
      case "nw": // northwest - top left
        newHeight = Math.max(80, startHeight - deltaY);
        newWidth = newHeight * aspectRatio;
        newLeft = startLeft + (startWidth - newWidth);
        newTop = startTop + (startHeight - newHeight);
        break;
    }

    // Apply new dimensions
    node.style.width = newWidth + "px";
    node.style.height = newHeight + "px";
    const nl = snapToGridEnabled ? snapToGrid(newLeft) : newLeft;
    const nt = snapToGridEnabled ? snapToGrid(newTop) : newTop;
    node.style.left = nl + "px";
    node.style.top = nt + "px";
  }

  async function onResizeEnd() {
    if (!resizing) return;

    resizing = false;
    resizeHandle = null;

    document.removeEventListener("mousemove", onResizeMove);
    document.removeEventListener("mouseup", onResizeEnd);

    // Persist new dimensions
    const items = await readItems();
    const idx = items.findIndex((i) => i.id === item.id);
    if (idx !== -1) {
      items[idx].w = parseInt(node.style.width, 10) || 200;
      items[idx].h = parseInt(node.style.height, 10) || 150;
      items[idx].x = parseInt(node.style.left, 10) || 0;
      items[idx].y = parseInt(node.style.top, 10) || 0;
      await writeItems(items);
    }
  }
}

async function render() {
  // Don't re-render if we're currently dragging an item
  if (isDraggingItem) {
    return;
  }

  BOARD_CONTENT.innerHTML = "";
  const items = await readItems();
  let mutated = false;
  for (const item of items) {
    if (item.spawnAtCenter) {
      const view = BOARD.getBoundingClientRect();
      const local = clientToLocal(
        view.left + view.width / 2,
        view.top + view.height / 2
      );
      item.x = Math.max(0, Math.floor(local.x - (item.w || 200) / 2));
      item.y = Math.max(0, Math.floor(local.y - (item.h || 150) / 2));
      delete item.spawnAtCenter;
      mutated = true;
    }
    BOARD_CONTENT.appendChild(createItemElement(item));
  }
  // Re-add guides layer after clearing content
  if (guidesLayer) {
    BOARD_CONTENT.appendChild(guidesLayer);
  }
  if (mutated) {
    await writeItems(items);
  }
}

function isProbablyImageUrl(url) {
  try {
    const u = new URL(url);
    return /\.(png|jpe?g|webp|gif|bmp|svg)(\?|#|$)/i.test(u.pathname);
  } catch {
    return false;
  }
}

function isProbablyVideoUrl(url) {
  try {
    const u = new URL(url);
    return /\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(u.pathname);
  } catch {
    return false;
  }
}

function canLoadImage(url) {
  return new Promise((resolve) => {
    try {
      const testImage = new Image();
      let completed = false;
      const finish = (ok) => {
        if (!completed) {
          completed = true;
          resolve(ok);
        }
      };
      testImage.onload = () => finish(true);
      testImage.onerror = () => finish(false);
      setTimeout(() => finish(false), 4000);
      testImage.src = url;
    } catch {
      resolve(false);
    }
  });
}

function createVideoElement(title, src, type) {
  const container = document.createElement("div");
  container.className = "wb-video-container";

  // Header bar for dragging (hidden by default for YouTube)
  const header = document.createElement("div");
  header.className = "wb-video-header";
  header.textContent = title;
  header.draggable = false;

  // Hide header by default for YouTube videos
  if (type === "youtube") {
    header.style.transform = "translateY(-100%)";
  }

  // Video content area
  const content = document.createElement("div");
  content.className = "wb-video-content";

  if (type === "youtube") {
    const iframe = document.createElement("iframe");
    iframe.src = src;
    iframe.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    iframe.frameBorder = "0";
    iframe.tabIndex = -1;
    content.appendChild(iframe);

    // Try to get YouTube video title
    fetchYouTubeTitle(src)
      .then((videoTitle) => {
        if (videoTitle) {
          header.textContent = videoTitle;
        }
      })
      .catch(() => {
        // Keep default title if fetch fails
      });
  } else if (type === "video") {
    const video = document.createElement("video");
    video.src = src;
    video.controls = true;
    video.preload = "metadata";
    video.playsInline = true;
    content.appendChild(video);
  }

  container.appendChild(header);
  container.appendChild(content);

  // Add hover listeners for YouTube videos
  if (type === "youtube") {
    container.addEventListener("mouseenter", () => {
      header.style.transform = "translateY(0)";
    });

    container.addEventListener("mouseleave", () => {
      header.style.transform = "translateY(-100%)";
    });
  }

  return container;
}

async function fetchYouTubeTitle(embedUrl) {
  try {
    // Extract video ID from embed URL
    const match = embedUrl.match(/\/embed\/([^?]+)/);
    if (!match) return null;

    const videoId = match[1];

    // Use YouTube oEmbed API to get video title
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

    const response = await fetch(oembedUrl);
    if (!response.ok) return null;

    const data = await response.json();
    return data.title || null;
  } catch (error) {
    console.warn("Failed to fetch YouTube title:", error);
    return null;
  }
}

function parseYouTubeStart(startLike) {
  if (!startLike) return 0;
  const s = String(startLike);
  const secMatch = s.match(/^(\d+)$/);
  if (secMatch) return parseInt(secMatch[1], 10) || 0;
  const rx = /(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/;
  const m = s.match(rx);
  if (!m) return 0;
  const h = parseInt(m[1] || "0", 10) || 0;
  const mnt = parseInt(m[2] || "0", 10) || 0;
  const sec = parseInt(m[3] || "0", 10) || 0;
  return h * 3600 + mnt * 60 + sec;
}

function parseYouTube(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    let id = "";
    let start = 0;
    if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com"
    ) {
      if (u.pathname === "/watch") {
        id = u.searchParams.get("v") || "";
        start = parseYouTubeStart(
          u.searchParams.get("t") || u.searchParams.get("start")
        );
      } else if (u.pathname.startsWith("/shorts/")) {
        id = u.pathname.split("/")[2] || "";
        start = 0;
      } else if (u.pathname.startsWith("/live/")) {
        id = u.pathname.split("/")[2] || "";
      }
    } else if (host === "youtu.be") {
      id = u.pathname.split("/")[1] || "";
      start = parseYouTubeStart(
        u.searchParams.get("t") || u.searchParams.get("start")
      );
    }
    if (!id) return null;
    const params = new URLSearchParams();
    if (start > 0) params.set("start", String(start));
    params.set("rel", "0");
    params.set("enablejsapi", "1");
    try {
      params.set("origin", location.origin);
    } catch {}
    const embedUrl = `https://www.youtube.com/embed/${id}${
      params.toString() ? "?" + params.toString() : ""
    }`;
    return { id, embedUrl };
  } catch {
    return null;
  }
}

async function addUrl(urlText) {
  const text = (urlText || "").trim();
  if (!text) return;
  try {
    const u = new URL(text);
    const items = await readItems();
    const href = u.href;
    const yt = parseYouTube(href);
    if (yt) {
      items.push(
        createBase({ type: "youtube", src: yt.embedUrl, w: 360, h: 203 })
      );
      await writeItems(items);
      await render();
      URL_INPUT.value = "";
      return;
    }
    const treatAsImage = isProbablyImageUrl(href) || (await canLoadImage(href));
    if (treatAsImage) {
      items.push(createBase({ type: "image", src: href, w: 300, h: 200 }));
    } else if (isProbablyVideoUrl(href)) {
      items.push(createBase({ type: "video", src: href, w: 360, h: 240 }));
    } else {
      items.push(
        createBase({ type: "link", url: href, title: href, w: 300, h: 120 })
      );
    }
    await writeItems(items);
    await render();
    URL_INPUT.value = "";
  } catch {
    alert("Invalid URL");
  }
}

function createBase(partial) {
  // Place new item at board center (viewport center translated to content coords)
  const view = BOARD.getBoundingClientRect();
  const centerClientX = view.left + view.width / 2;
  const centerClientY = view.top + view.height / 2;
  const local = clientToLocal(centerClientX, centerClientY);
  const baseX = Math.max(0, Math.floor(local.x - (partial.w || 200) / 2));
  const baseY = Math.max(0, Math.floor(local.y - (partial.h || 150) / 2));
  const cx = snapToGridEnabled ? snapToGrid(baseX) : baseX;
  const cy = snapToGridEnabled ? snapToGrid(baseY) : baseY;
  return {
    id: `wb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    x: cx,
    y: cy,
    z: ++zIndexCounter, // Use the global counter
    ...partial,
  };
}

async function handleFiles(files) {
  const items = await readItems();
  const readAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  for (const file of files) {
    if (file.type.startsWith("image/")) {
      const dataUrl = await readAsDataUrl(file);
      items.push(createBase({ type: "image", src: dataUrl, w: 320, h: 240 }));
    } else if (file.type.startsWith("video/")) {
      const dataUrl = await readAsDataUrl(file);
      items.push(createBase({ type: "video", src: dataUrl, w: 360, h: 240 }));
    }
  }
  await writeItems(items);
  await render();
}

// Events
ADD_URL_BTN.addEventListener("click", () => addUrl(URL_INPUT.value));
URL_INPUT.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addUrl(URL_INPUT.value);
});
FILE_INPUT.addEventListener("change", (e) => {
  const files = /** @type {HTMLInputElement} */ (e.target).files;
  if (files) handleFiles(Array.from(files));
});
CLEAR_BTN.addEventListener("click", async () => {
  if (confirm("Clear all items?")) {
    await API.storage.local.set({ whiteboardItems: [] });
    await render();
  }
});

// Zoom events
ZOOM_IN_BTN.addEventListener("click", zoomIn);
ZOOM_OUT_BTN.addEventListener("click", zoomOut);
BOARD.addEventListener("wheel", handleWheelZoom, { passive: false });

// Panning events
BOARD.addEventListener("mousedown", startPan);

// Double-click to reset zoom
BOARD.addEventListener("dblclick", (e) => {
  e.preventDefault();
  resetZoom();
});

// Paste support (images/screenshots from clipboard)
document.addEventListener("paste", async (e) => {
  const items = await readItems();
  const clipboardItems = e.clipboardData?.items || [];
  let added = false;
  for (const it of clipboardItems) {
    if (it.type.startsWith("image/")) {
      const file = it.getAsFile();
      if (file) {
        const dataUrl = await blobToDataUrl(file);
        items.push(createBase({ type: "image", src: dataUrl, w: 320, h: 240 }));
        added = true;
      }
    }
    if (it.type === "text/plain") {
      const text = await new Promise((res) => it.getAsString(res));
      const maybe = (text || "").trim();
      try {
        const u = new URL(maybe);
        const href = u.href;
        const yt = parseYouTube(href);
        if (yt) {
          items.push(
            createBase({ type: "youtube", src: yt.embedUrl, w: 360, h: 203 })
          );
        } else {
          const treatAsImage =
            isProbablyImageUrl(href) || (await canLoadImage(href));
          if (treatAsImage) {
            items.push(
              createBase({ type: "image", src: href, w: 300, h: 200 })
            );
          } else if (isProbablyVideoUrl(href)) {
            items.push(
              createBase({ type: "video", src: href, w: 360, h: 240 })
            );
          } else {
            items.push(
              createBase({
                type: "link",
                url: href,
                title: href,
                w: 300,
                h: 120,
              })
            );
          }
        }
        added = true;
      } catch {}
    }
  }
  if (added) {
    await writeItems(items);
    await render();
  }
});

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

// Bring item to front
function bringToFront(itemElement) {
  // Remove the class from others (optional—keeps only one "active")
  const otherFrontItems = document.querySelectorAll(".wb-item.bring-front");
  otherFrontItems.forEach((el) => {
    el.classList.remove("bring-front");
  });

  itemElement.classList.add("bring-front");

  // Use a very high z-index value to ensure it's on top
  const newZIndex = ++zIndexCounter;
  itemElement.style.setProperty("z-index", newZIndex, "important");
  // Ensure DOM order places this item last within its container
  if (itemElement.parentNode) {
    itemElement.parentNode.appendChild(itemElement);
  }

  // Persist z-order to storage so re-renders keep this on top
  const id = itemElement.dataset.id;
  if (id) {
    readItems().then((items) => {
      const idx = items.findIndex((i) => i.id === id);
      if (idx !== -1) {
        items[idx].z = newZIndex;
        API.storage.local.set({ whiteboardItems: items });
      }
    });
  }

  // Force a style recalculation
  itemElement.offsetHeight;
}

// Apply transform to the board content
function applyTransform() {
  // Clamp translate so content always covers the viewport (no empty spaces)
  const view = BOARD.getBoundingClientRect();
  const contentW = BOARD_CONTENT.scrollWidth;
  const contentH = BOARD_CONTENT.scrollHeight;
  const scaledW = contentW * scale;
  const scaledH = contentH * scale;
  const minTx = Math.min(0, view.width - scaledW);
  const minTy = Math.min(0, view.height - scaledH);
  tx = Math.min(0, Math.max(minTx, tx));
  ty = Math.min(0, Math.max(minTy, ty));

  BOARD_CONTENT.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  ZOOM_LEVEL.textContent = Math.round(scale * 100) + "%";

  // Update board class for styling
  if (scale !== 1) {
    BOARD.classList.add("zoomed");
  } else {
    BOARD.classList.remove("zoomed");
  }
}

// Center the board content on first load if at default transform
function centerIfDefault() {
  if (scale !== 1 || tx !== 0 || ty !== 0) return;
  const view = BOARD.getBoundingClientRect();
  const contentW = BOARD_CONTENT.scrollWidth;
  const contentH = BOARD_CONTENT.scrollHeight;
  const scaledW = contentW * scale;
  const scaledH = contentH * scale;
  // Center offsets (will be clamped in applyTransform)
  tx = (view.width - scaledW) / 2;
  ty = (view.height - scaledH) / 2;
}

// Convert client coordinates to local content coordinates
function clientToLocal(x, y) {
  const r = BOARD.getBoundingClientRect();
  const sx = x - r.left; // screen x within viewport
  const sy = y - r.top; // screen y within viewport
  // convert to content local (pre-transform) coords
  return { x: (sx - tx) / scale, y: (sy - ty) / scale };
}

// Zoom functions
function zoomIn() {
  const newScale = Math.min(MAX_ZOOM, scale + ZOOM_STEP);
  scale = newScale;
  applyTransform();
}

function zoomOut() {
  const newScale = Math.max(MIN_ZOOM, scale - ZOOM_STEP);
  scale = newScale;
  applyTransform();
}

function resetZoom() {
  scale = 1;
  tx = 0;
  ty = 0;
  applyTransform();
}

// Handle mouse wheel zoom
function handleWheelZoom(e) {
  e.preventDefault();

  const local = clientToLocal(e.clientX, e.clientY);

  const zoom = Math.exp(-e.deltaY * 0.001);
  const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale * zoom));

  // Keep the same local point under the cursor: solve for new translate
  const r = BOARD.getBoundingClientRect();
  const cursorX = e.clientX - r.left;
  const cursorY = e.clientY - r.top;

  tx = cursorX - local.x * newScale;
  ty = cursorY - local.y * newScale;
  scale = newScale;

  applyTransform();
}

// Panning functionality
function startPan(e) {
  // Only start panning if not clicking on an item
  if (e.target.closest(".wb-item")) return;

  isPanning = true;
  panStartX = e.clientX;
  panStartY = e.clientY;
  BOARD.style.cursor = "grabbing";

  document.addEventListener("mousemove", handlePan);
  document.addEventListener("mouseup", endPan);
}

function handlePan(e) {
  if (!isPanning) return;

  e.preventDefault();

  tx += e.clientX - panStartX;
  ty += e.clientY - panStartY;
  panStartX = e.clientX;
  panStartY = e.clientY;

  applyTransform();
}

function endPan() {
  isPanning = false;
  BOARD.style.cursor = "grab";

  document.removeEventListener("mousemove", handlePan);
  document.removeEventListener("mouseup", endPan);
}

// Show success feedback for crop operation
function showCropSuccessFeedback() {
  const feedback = document.createElement("div");
  feedback.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #10b981;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    font-weight: 500;
    z-index: 999999;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    animation: slideIn 0.3s ease;
  `;
  feedback.textContent = "Image cropped successfully!";

  // Add animation styles
  const style = document.createElement("style");
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(feedback);

  // Remove after 3 seconds
  setTimeout(() => {
    feedback.remove();
    style.remove();
  }, 3000);
}

// Cropping functionality
function startCrop(node, item) {
  const img = node.querySelector("img");
  if (!img) return;

  // Create crop overlay
  const overlay = document.createElement("div");
  overlay.className = "wb-crop-overlay";

  const container = document.createElement("div");
  container.className = "wb-crop-container";

  const cropImg = document.createElement("img");
  cropImg.className = "wb-crop-image";
  cropImg.crossOrigin = "anonymous"; // Try to allow cross-origin access
  cropImg.src = img.src;
  cropImg.alt = "Crop image";

  const selection = document.createElement("div");
  selection.className = "wb-crop-selection";

  const controls = document.createElement("div");
  controls.className = "wb-crop-controls";

  const cropBtn = document.createElement("button");
  cropBtn.className = "wb-crop-btn";
  cropBtn.textContent = "Crop";
  cropBtn.style.backgroundColor = "green"; // Make it more visible for testing
  cropBtn.style.fontSize = "14px";
  cropBtn.style.padding = "8px 16px";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "wb-crop-btn cancel";
  cancelBtn.textContent = "Cancel";

  controls.appendChild(cropBtn);
  controls.appendChild(cancelBtn);

  console.log("Controls created:", controls);
  console.log("Crop button:", cropBtn);
  console.log("Cancel button:", cancelBtn);

  container.appendChild(cropImg);
  container.appendChild(selection);
  overlay.appendChild(container);
  overlay.appendChild(controls);

  // Prevent container and controls clicks from closing the overlay
  container.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  controls.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  document.body.appendChild(overlay);
  document.body.classList.add("wb-crop-overlay-active");

  // Initialize crop selection
  let isDragging = false;
  let isResizing = false;
  let resizeHandle = null;
  let startX = 0,
    startY = 0;
  let selectionRect = { x: 50, y: 50, width: 200, height: 150 };

  function updateSelection() {
    selection.style.left = selectionRect.x + "px";
    selection.style.top = selectionRect.y + "px";
    selection.style.width = selectionRect.width + "px";
    selection.style.height = selectionRect.height + "px";
  }

  function createHandles() {
    const handles = ["nw", "ne", "sw", "se"];
    handles.forEach((handle) => {
      const handleEl = document.createElement("div");
      handleEl.className = `wb-crop-handle wb-crop-handle-${handle}`;
      handleEl.addEventListener("mousedown", (e) => startResize(e, handle));
      selection.appendChild(handleEl);
    });
  }

  function startResize(e, handle) {
    e.preventDefault();
    e.stopPropagation();
    isResizing = true;
    resizeHandle = handle;
    startX = e.clientX;
    startY = e.clientY;

    document.addEventListener("mousemove", onResizeMove);
    document.addEventListener("mouseup", onResizeEnd);
  }

  function onResizeMove(e) {
    if (!isResizing) return;

    e.preventDefault();
    e.stopPropagation(); // Prevent event from bubbling to overlay

    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    const containerRect = container.getBoundingClientRect();

    switch (resizeHandle) {
      case "se": // southeast - bottom right
        selectionRect.width = Math.max(
          50,
          Math.min(
            selectionRect.width + deltaX,
            containerRect.width - selectionRect.x
          )
        );
        selectionRect.height = Math.max(
          50,
          Math.min(
            selectionRect.height + deltaY,
            containerRect.height - selectionRect.y
          )
        );
        break;
      case "sw": // southwest - bottom left
        const newWidthSW = Math.max(
          50,
          Math.min(
            selectionRect.width - deltaX,
            selectionRect.x + selectionRect.width
          )
        );
        const newHeightSW = Math.max(
          50,
          Math.min(
            selectionRect.height + deltaY,
            containerRect.height - selectionRect.y
          )
        );
        selectionRect.x = selectionRect.x + (selectionRect.width - newWidthSW);
        selectionRect.width = newWidthSW;
        selectionRect.height = newHeightSW;
        break;
      case "ne": // northeast - top right
        const newHeightNE = Math.max(
          50,
          Math.min(
            selectionRect.height - deltaY,
            selectionRect.y + selectionRect.height
          )
        );
        const newWidthNE = Math.max(
          50,
          Math.min(
            selectionRect.width + deltaX,
            containerRect.width - selectionRect.x
          )
        );
        selectionRect.y =
          selectionRect.y + (selectionRect.height - newHeightNE);
        selectionRect.width = newWidthNE;
        selectionRect.height = newHeightNE;
        break;
      case "nw": // northwest - top left
        const newHeightNW = Math.max(
          50,
          Math.min(
            selectionRect.height - deltaY,
            selectionRect.y + selectionRect.height
          )
        );
        const newWidthNW = Math.max(
          50,
          Math.min(
            selectionRect.width - deltaX,
            selectionRect.x + selectionRect.width
          )
        );
        selectionRect.x = selectionRect.x + (selectionRect.width - newWidthNW);
        selectionRect.y =
          selectionRect.y + (selectionRect.height - newHeightNW);
        selectionRect.width = newWidthNW;
        selectionRect.height = newHeightNW;
        break;
    }

    updateSelection();
    startX = e.clientX;
    startY = e.clientY;
  }

  function onResizeEnd(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation(); // Prevent event from bubbling to overlay
    }
    isResizing = false;
    resizeHandle = null;
    document.removeEventListener("mousemove", onResizeMove);
    document.removeEventListener("mouseup", onResizeEnd);
  }

  // Selection dragging
  selection.addEventListener("mousedown", (e) => {
    if (e.target.classList.contains("wb-crop-handle")) return;
    e.preventDefault();
    e.stopPropagation(); // Prevent event from bubbling to overlay
    isDragging = true;
    startX = e.clientX - selectionRect.x;
    startY = e.clientY - selectionRect.y;

    document.addEventListener("mousemove", onSelectionMove);
    document.addEventListener("mouseup", onSelectionEnd);
  });

  function onSelectionMove(e) {
    if (!isDragging) return;

    e.preventDefault();
    e.stopPropagation(); // Prevent event from bubbling to overlay

    const containerRect = container.getBoundingClientRect();
    const newX = e.clientX - startX;
    const newY = e.clientY - startY;

    // Constrain selection within image bounds
    selectionRect.x = Math.max(
      0,
      Math.min(newX, containerRect.width - selectionRect.width)
    );
    selectionRect.y = Math.max(
      0,
      Math.min(newY, containerRect.height - selectionRect.height)
    );

    updateSelection();
  }

  function onSelectionEnd(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation(); // Prevent event from bubbling to overlay
    }
    isDragging = false;
    document.removeEventListener("mousemove", onSelectionMove);
    document.removeEventListener("mouseup", onSelectionEnd);
  }

  // Initialize
  updateSelection();
  createHandles();

  // Event listeners
  cropBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Show loading state
    const originalText = cropBtn.textContent;
    cropBtn.textContent = "Cropping...";
    cropBtn.disabled = true;
    cropBtn.style.opacity = "0.6";

    try {
      console.log("Crop button clicked, starting crop process...");
      await performCrop(node, item, cropImg, selectionRect);
      console.log("Crop completed successfully");

      // Show success feedback
      showCropSuccessFeedback();

      document.body.removeChild(overlay);
      document.body.classList.remove("wb-crop-overlay-active");
    } catch (error) {
      console.error("Error during crop:", error);

      // Show detailed error message
      let errorMessage = "Error cropping image: " + error.message;

      // Provide specific guidance based on error type
      if (
        error.message.includes("security restrictions") ||
        error.message.includes("CORS")
      ) {
        errorMessage +=
          "\n\nTip: Try uploading the image directly instead of using a URL, or the image server may not allow cross-origin access.";
      } else if (error.message.includes("Proxy failed")) {
        errorMessage +=
          "\n\nTip: The image may be too large or the server may be blocking requests. Try downloading and uploading the image directly.";
      }

      alert(errorMessage);
    } finally {
      // Restore button state
      cropBtn.textContent = originalText;
      cropBtn.disabled = false;
      cropBtn.style.opacity = "1";
    }
  });

  cancelBtn.addEventListener("click", () => {
    document.body.removeChild(overlay);
    document.body.classList.remove("wb-crop-overlay-active");
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      document.body.removeChild(overlay);
      document.body.classList.remove("wb-crop-overlay-active");
    }
  });
}

async function performCrop(node, item, cropImg, selectionRect) {
  console.log("performCrop called with:", { item: item.id, selectionRect });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  // Set canvas size to crop dimensions
  canvas.width = selectionRect.width;
  canvas.height = selectionRect.height;
  console.log("Canvas size:", canvas.width, "x", canvas.height);

  // Calculate scale factors
  const imgRect = cropImg.getBoundingClientRect();
  const scaleX = cropImg.naturalWidth / imgRect.width;
  const scaleY = cropImg.naturalHeight / imgRect.height;
  console.log("Scale factors:", { scaleX, scaleY });
  console.log("Image dimensions:", {
    naturalWidth: cropImg.naturalWidth,
    naturalHeight: cropImg.naturalHeight,
    displayWidth: imgRect.width,
    displayHeight: imgRect.height,
  });

  // Calculate source coordinates
  const sourceX = selectionRect.x * scaleX;
  const sourceY = selectionRect.y * scaleY;
  const sourceWidth = selectionRect.width * scaleX;
  const sourceHeight = selectionRect.height * scaleY;
  console.log("Source coordinates:", {
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
  });

  // Try to draw the image, with fallback for CORS issues
  let croppedDataUrl;
  try {
    ctx.drawImage(
      cropImg,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height
    );
    console.log("Image drawn to canvas");
    croppedDataUrl = canvas.toDataURL("image/png");
  } catch (error) {
    console.error("Canvas drawImage failed:", error);

    // Fallback: Use proxy to fetch image as data URL
    try {
      console.log("Trying proxy method for external image...");
      const originalImg = node.querySelector("img");

      if (originalImg && !originalImg.src.startsWith("data:")) {
        // External URL - use proxy
        console.log("Using proxy for external image:", originalImg.src);
        const response = await API.runtime.sendMessage({
          action: "proxyImageToDataUrl",
          imageUrl: originalImg.src,
        });

        if (response.success) {
          console.log("Proxy succeeded, creating temp image...");
          const tempImg = new Image();

          await new Promise((resolve, reject) => {
            tempImg.onload = resolve;
            tempImg.onerror = reject;
            tempImg.src = response.dataUrl;
          });

          // Now crop from the temp image
          ctx.drawImage(
            tempImg,
            sourceX,
            sourceY,
            sourceWidth,
            sourceHeight,
            0,
            0,
            canvas.width,
            canvas.height
          );
          croppedDataUrl = canvas.toDataURL("image/png");
          console.log("Proxy method succeeded");
        } else {
          throw new Error(response.error || "Proxy failed");
        }
      } else if (originalImg && originalImg.src.startsWith("data:")) {
        // Already a data URL
        console.log("Using existing data URL...");
        const tempImg = new Image();

        await new Promise((resolve, reject) => {
          tempImg.onload = resolve;
          tempImg.onerror = reject;
          tempImg.src = originalImg.src;
        });

        ctx.drawImage(
          tempImg,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          canvas.width,
          canvas.height
        );
        croppedDataUrl = canvas.toDataURL("image/png");
        console.log("Data URL method succeeded");
      } else {
        throw new Error("No valid image source found");
      }
    } catch (fallbackError) {
      console.error("Fallback method also failed:", fallbackError);
      throw new Error(
        `Cannot crop this image: ${fallbackError.message}. Try uploading the image directly instead of using a URL.`
      );
    }
  }

  console.log("Data URL created, length:", croppedDataUrl.length);

  // Update item with cropped image
  const items = await readItems();
  const idx = items.findIndex((i) => i.id === item.id);
  console.log("Found item at index:", idx);

  if (idx !== -1) {
    items[idx].src = croppedDataUrl;
    await writeItems(items);
    console.log("Items updated in storage");
    await render();
    console.log("Whiteboard re-rendered");
  } else {
    console.error("Item not found in storage");
  }
}

// Initialize z-index counter from existing items
async function initializeZIndexCounter() {
  const items = await readItems();
  if (items.length > 0) {
    // Normalize z values to small sequential ints based on existing order
    const itemsByZ = [...items].sort((a, b) => (a.z || 0) - (b.z || 0));
    let nextZ = 10;
    for (const it of itemsByZ) {
      it.z = nextZ++;
    }
    await API.storage.local.set({ whiteboardItems: items });
    zIndexCounter = nextZ;
  }
}

// (removed) addTestButton - debug helper no longer needed

// Initial render and subscribe to storage changes from background
initializeZIndexCounter().then(() => {
  render();
  centerIfDefault();
  applyTransform(); // Initialize transform
});
API.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.whiteboardItems) {
    render();
  }
});
