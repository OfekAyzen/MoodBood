// Whiteboard front-end
// Supports adding images/links, uploading images, pasting images, drag-to-move, z-order, delete

const API = typeof browser !== "undefined" ? browser : chrome;
const BOARD = document.getElementById("board");
const URL_INPUT = document.getElementById("imageUrl");
const ADD_URL_BTN = document.getElementById("addUrlBtn");
const FILE_INPUT = document.getElementById("fileInput");
const CLEAR_BTN = document.getElementById("clearBtn");

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
  node.style.zIndex = String(item.z || 1);
  node.style.width = (item.w || 200) + "px";
  node.style.height = item.h || "auto";
  node.dataset.id = item.id;

  const body = node.querySelector(".wb-item-body");
  if (item.type === "image" && item.src) {
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
    if (ev.button !== 0) return;

    // Don't start drag if clicking on buttons or resize handles
    if (
      ev.target.classList.contains("wb-resize-handle") ||
      ev.target.classList.contains("wb-close") ||
      ev.target.classList.contains("wb-crop") ||
      ev.target.closest(".wb-close") ||
      ev.target.closest(".wb-crop")
    ) {
      return;
    }

    // For video items, only allow dragging from the header
    if (
      (item.type === "youtube" || item.type === "video") &&
      !ev.target.closest(".wb-video-header")
    ) {
      return; // Don't start drag if not clicking on header
    }

    ev.preventDefault();
    ev.stopPropagation();

    dragging = true;
    // Bring to front
    item.z = Date.now();
    node.style.zIndex = String(item.z);
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

    // Persist final position
    const items = await readItems();
    const idx = items.findIndex((i) => i.id === item.id);
    if (idx !== -1) {
      items[idx].x = parseInt(node.style.left, 10) || 0;
      items[idx].y = parseInt(node.style.top, 10) || 0;
      items[idx].z = item.z;
      await writeItems(items);
    }
  }

  function onMouseMove(ev) {
    if (!dragging) return;

    ev.preventDefault();
    const x = ev.clientX - offsetX;
    const y = ev.clientY - offsetY;
    node.style.left = x + "px";
    node.style.top = y + "px";
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
    node.style.left = newLeft + "px";
    node.style.top = newTop + "px";
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
  BOARD.innerHTML = "";
  const items = await readItems();
  for (const item of items) {
    BOARD.appendChild(createItemElement(item));
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
  return {
    id: `wb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    x: Math.floor(80 + Math.random() * 200),
    y: Math.floor(80 + Math.random() * 140),
    z: Date.now(),
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
  container.appendChild(controls);
  overlay.appendChild(container);

  document.body.appendChild(overlay);
  document.body.classList.add("wb-crop-overlay-active");

  // Initialize crop selection
  let isDragging = false;
  let isResizing = false;
  let resizeHandle = null;
  let startX = 0,
    startY = 0;
  let selectionRect = { x: 50, y: 50, width: 200, height: 150 };
  let initialAspectRatio = selectionRect.width / selectionRect.height;

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

    // Store initial aspect ratio
    initialAspectRatio = selectionRect.width / selectionRect.height;

    document.addEventListener("mousemove", onResizeMove);
    document.addEventListener("mouseup", onResizeEnd);
  }

  function onResizeMove(e) {
    if (!isResizing) return;

    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    const containerRect = container.getBoundingClientRect();

    switch (resizeHandle) {
      case "se":
        selectionRect.width = Math.max(
          50,
          Math.min(
            selectionRect.width + deltaX,
            containerRect.width - selectionRect.x
          )
        );
        selectionRect.height = selectionRect.width / initialAspectRatio;
        // Ensure height doesn't exceed container bounds
        if (selectionRect.y + selectionRect.height > containerRect.height) {
          selectionRect.height = containerRect.height - selectionRect.y;
          selectionRect.width = selectionRect.height * initialAspectRatio;
        }
        break;
      case "sw":
        const newWidth = Math.max(
          50,
          Math.min(
            selectionRect.width - deltaX,
            selectionRect.x + selectionRect.width
          )
        );
        const newHeight = newWidth / initialAspectRatio;
        // Ensure height doesn't exceed container bounds
        if (selectionRect.y + newHeight > containerRect.height) {
          selectionRect.height = containerRect.height - selectionRect.y;
          selectionRect.width = selectionRect.height * initialAspectRatio;
        } else {
          selectionRect.width = newWidth;
          selectionRect.height = newHeight;
        }
        selectionRect.x = selectionRect.x + (selectionRect.width - newWidth);
        break;
      case "ne":
        const newHeightNE = Math.max(
          50,
          Math.min(
            selectionRect.height - deltaY,
            selectionRect.y + selectionRect.height
          )
        );
        const newWidthNE = newHeightNE * initialAspectRatio;
        // Ensure width doesn't exceed container bounds
        if (selectionRect.x + newWidthNE > containerRect.width) {
          selectionRect.width = containerRect.width - selectionRect.x;
          selectionRect.height = selectionRect.width / initialAspectRatio;
        } else {
          selectionRect.width = newWidthNE;
          selectionRect.height = newHeightNE;
        }
        selectionRect.y =
          selectionRect.y + (selectionRect.height - newHeightNE);
        break;
      case "nw":
        const newHeightNW = Math.max(
          50,
          Math.min(
            selectionRect.height - deltaY,
            selectionRect.y + selectionRect.height
          )
        );
        const newWidthNW = newHeightNW * initialAspectRatio;
        // Ensure width doesn't exceed container bounds
        if (newWidthNW > selectionRect.x + selectionRect.width) {
          selectionRect.width = selectionRect.x + selectionRect.width;
          selectionRect.height = selectionRect.width / initialAspectRatio;
        } else {
          selectionRect.width = newWidthNW;
          selectionRect.height = newHeightNW;
        }
        selectionRect.x = selectionRect.x + (selectionRect.width - newWidthNW);
        selectionRect.y =
          selectionRect.y + (selectionRect.height - newHeightNW);
        break;
    }

    updateSelection();
    startX = e.clientX;
    startY = e.clientY;
  }

  function onResizeEnd() {
    isResizing = false;
    resizeHandle = null;
    document.removeEventListener("mousemove", onResizeMove);
    document.removeEventListener("mouseup", onResizeEnd);
  }

  // Selection dragging
  selection.addEventListener("mousedown", (e) => {
    if (e.target.classList.contains("wb-crop-handle")) return;
    e.preventDefault();
    isDragging = true;
    startX = e.clientX - selectionRect.x;
    startY = e.clientY - selectionRect.y;

    document.addEventListener("mousemove", onSelectionMove);
    document.addEventListener("mouseup", onSelectionEnd);
  });

  function onSelectionMove(e) {
    if (!isDragging) return;

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

  function onSelectionEnd() {
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
    try {
      console.log("Crop button clicked, starting crop process...");
      await performCrop(node, item, cropImg, selectionRect);
      console.log("Crop completed successfully");
      document.body.removeChild(overlay);
      document.body.classList.remove("wb-crop-overlay-active");
    } catch (error) {
      console.error("Error during crop:", error);
      alert("Error cropping image: " + error.message);
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

    // Fallback: try to convert the original image to data URL first
    try {
      console.log("Trying fallback method...");
      const originalImg = node.querySelector("img");
      if (originalImg && originalImg.src.startsWith("data:")) {
        // If it's already a data URL, we can use it directly
        const tempCanvas = document.createElement("canvas");
        const tempCtx = tempCanvas.getContext("2d");
        const tempImg = new Image();

        await new Promise((resolve, reject) => {
          tempImg.onload = resolve;
          tempImg.onerror = reject;
          tempImg.src = originalImg.src;
        });

        tempCanvas.width = tempImg.naturalWidth;
        tempCanvas.height = tempImg.naturalHeight;
        tempCtx.drawImage(tempImg, 0, 0);

        // Now crop from the temp canvas
        ctx.drawImage(
          tempCanvas,
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
        console.log("Fallback method succeeded");
      } else {
        throw new Error(
          "Cannot crop this image due to security restrictions. Try uploading the image directly instead of using a URL."
        );
      }
    } catch (fallbackError) {
      console.error("Fallback method also failed:", fallbackError);
      throw new Error(
        "Cannot crop this image due to security restrictions. Try uploading the image directly instead of using a URL."
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

// Initial render and subscribe to storage changes from background
render();
API.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.whiteboardItems) {
    render();
  }
});
