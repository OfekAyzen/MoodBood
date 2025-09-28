// Content script for image hover detection
const API = typeof browser !== "undefined" ? browser : chrome;

// Content script loaded
console.log("Content script loaded on:", window.location.href);

// Create the hover icon element
function createHoverIcon() {
  const icon = document.createElement("div");
  icon.id = "moodbood-hover-icon";
  icon.innerHTML = "📌";
  icon.style.cssText = `
    position: absolute;
    width: 24px;
    height: 24px;
    background: rgba(0, 0, 0, 0.8);
    border: 2px solid #60a5fa;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    cursor: pointer;
    z-index: 2147483647;
    pointer-events: auto;
    transition: all 0.2s ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    /* Add invisible padding area for easier targeting */
    padding: 6px;
    margin: -6px;
  `;

  // Add hover effect
  icon.addEventListener("mouseenter", () => {
    icon.style.transform = "scale(1.2)";
    icon.style.background = "rgba(255, 68, 68, 0.9)";
    icon.style.border = "3px solid #ffffff";
  });

  icon.addEventListener("mouseleave", () => {
    icon.style.transform = "scale(1)";
    icon.style.background = "rgba(0, 0, 0, 0.9)";
    icon.style.border = "2px solid #ff4444";
  });

  return icon;
}

// Show hover icon on image
function showHoverIcon(img, event) {
  // Remove any existing icon
  hideHoverIcon();

  const icon = createHoverIcon();
  document.body.appendChild(icon);

  // Position the icon near the image
  const rect = img.getBoundingClientRect();

  // Use fixed positioning for better compatibility
  icon.style.setProperty("position", "fixed", "important");
  icon.style.setProperty("z-index", "2147483647", "important");
  icon.style.setProperty("pointer-events", "auto", "important");

  // Position icon at top-right of image
  icon.style.left = rect.right - 30 + "px";
  icon.style.top = rect.top + 10 + "px";

  // Add click handler
  icon.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openBoardPicker((boardId) => {
      addImageToWhiteboard(img.src, img.alt || "Image", boardId);
      hideHoverIcon();
    });
  });
}

// Hide hover icon
function hideHoverIcon() {
  const existingIcon = document.getElementById("moodbood-hover-icon");
  if (existingIcon) {
    existingIcon.remove();
  }
}

function openBoardPicker(onSelect) {
  const existing = document.getElementById("moodbood-board-picker");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "moodbood-board-picker";
  overlay.style.cssText = `position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:rgba(0,0,0,0.45);`;
  const panel = document.createElement("div");
  panel.style.cssText = `width:min(90vw,520px);max-height:85vh;overflow:auto;background:#111827;color:#e5e7eb;border:1px solid rgba(255,255,255,0.1);border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,0.4);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;`;
  panel.innerHTML = `
    <div style="padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;justify-content:space-between;align-items:center;">
      <div style="font-weight:600;font-size:14px;">Choose a board</div>
      <button id="mb-close" style="background:transparent;border:none;color:#9ca3af;font-size:18px;cursor:pointer;">×</button>
    </div>
    <div id="mb-cards" style="padding:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;"></div>
    <div style="padding:10px 12px;display:flex;gap:8px;border-top:1px solid rgba(255,255,255,0.08);justify-content:flex-end;">
      <button id="mb-new" style="margin-right:auto;background:#374151;border:none;color:#e5e7eb;padding:8px 10px;border-radius:8px;cursor:pointer;">New board</button>
      <button id="mb-cancel" style="background:#374151;border:none;color:#e5e7eb;padding:8px 10px;border-radius:8px;cursor:pointer;">Cancel</button>
    </div>`;
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  panel.querySelector("#mb-close")?.addEventListener("click", close);
  panel.querySelector("#mb-cancel")?.addEventListener("click", close);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });

  API.storage.local.get(
    { whiteboardBoards: { active: "default", list: ["default"] } },
    async (obj) => {
      const meta = obj.whiteboardBoards || {
        active: "default",
        list: ["default"],
      };
      const listEl = panel.querySelector("#mb-cards");
      if (!meta.list || !meta.list.length) {
        const empty = document.createElement("div");
        empty.style.color = "#9ca3af";
        empty.textContent = "No boards yet. Create one.";
        listEl?.appendChild(empty);
      } else {
        for (const id of meta.list) {
          const key = `whiteboardItems_${id}`;
          const obj2 = await new Promise((r) =>
            API.storage.local.get({ [key]: [] }, r)
          );
          const items = obj2[key] || [];
          const imgs = items
            .filter((it) => it && it.type === "image" && it.src)
            .slice(0, 3)
            .map((it) => it.src);

          const card = document.createElement("button");
          card.style.cssText =
            "text-align:left;background:#0b1220;border:1px solid rgba(255,255,255,0.1);color:#e5e7eb;border-radius:12px;cursor:pointer;overflow:hidden;";

          const collage = document.createElement("div");
          collage.style.cssText =
            "display:grid;grid-template-columns:2fr 1fr;grid-template-rows:repeat(2,80px);gap:2px;padding:8px;border-bottom:1px solid rgba(255,255,255,0.06);";

          const left = document.createElement("div");
          left.style.cssText =
            "grid-row:1 / span 2; grid-column:1; border-radius:8px; overflow:hidden; background:#111827;";
          if (imgs[0]) {
            const im = document.createElement("img");
            im.src = imgs[0];
            im.referrerPolicy = "no-referrer";
            im.style.cssText =
              "width:100%;height:100%;object-fit:cover;display:block;";
            left.appendChild(im);
          } else {
            const ph = document.createElement("div");
            ph.style.cssText = "width:100%;height:100%;background:#111827;";
            left.appendChild(ph);
          }
          const rt = document.createElement("div");
          rt.style.cssText =
            "grid-row:1; grid-column:2; border-radius:8px; overflow:hidden; background:#111827;";
          if (imgs[1]) {
            const im = document.createElement("img");
            im.src = imgs[1];
            im.referrerPolicy = "no-referrer";
            im.style.cssText =
              "width:100%;height:100%;object-fit:cover;display:block;";
            rt.appendChild(im);
          } else {
            const ph = document.createElement("div");
            ph.style.cssText = "width:100%;height:100%;background:#111827;";
            rt.appendChild(ph);
          }
          const rb = document.createElement("div");
          rb.style.cssText =
            "grid-row:2; grid-column:2; border-radius:8px; overflow:hidden; background:#111827;";
          if (imgs[2]) {
            const im = document.createElement("img");
            im.src = imgs[2];
            im.referrerPolicy = "no-referrer";
            im.style.cssText =
              "width:100%;height:100%;object-fit:cover;display:block;";
            rb.appendChild(im);
          } else {
            const ph = document.createElement("div");
            ph.style.cssText = "width:100%;height:100%;background:#111827;";
            rb.appendChild(ph);
          }
          collage.appendChild(left);
          collage.appendChild(rt);
          collage.appendChild(rb);

          const metaRow = document.createElement("div");
          metaRow.style.cssText = "padding:10px 12px;";
          const title = document.createElement("div");
          title.textContent = id;
          title.style.cssText =
            "font-weight:700;font-size:16px;margin-bottom:6px;";
          const sub = document.createElement("div");
          sub.style.cssText = "font-size:12px;color:#9ca3af;";
          sub.textContent = `${items.length} Pins · Just now`;
          metaRow.appendChild(title);
          metaRow.appendChild(sub);

          card.appendChild(collage);
          card.appendChild(metaRow);
          card.addEventListener("click", () => {
            onSelect && onSelect(id);
            overlay.remove();
          });
          listEl?.appendChild(card);
        }
      }

      panel.querySelector("#mb-new")?.addEventListener("click", () => {
        const name = prompt("New board name:");
        if (!name) return;
        const safe = name.trim().slice(0, 40);
        if (!safe) return;
        const next = new Set(meta.list || []);
        next.add(safe);
        const updated = { active: safe, list: Array.from(next) };
        API.storage.local.set({ whiteboardBoards: updated }, () => {
          overlay.remove();
          openBoardPicker(onSelect);
        });
      });
    }
  );
}

// Add image to whiteboard
async function addImageToWhiteboard(src, alt, boardId) {
  try {
    console.log("Sending message to background script:", {
      action: "addImageToWhiteboard",
      src: src,
      alt: alt,
      boardId,
    });

    // Send message to background script to add image
    API.runtime.sendMessage({
      action: "addImageToWhiteboard",
      src,
      alt,
      boardId,
    });

    // Show visual feedback
    showSuccessFeedback();
  } catch (error) {
    console.error("Error adding image to whiteboard:", error);
  }
}

// Show success feedback
function showSuccessFeedback() {
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
  feedback.textContent = "Image added to whiteboard!";

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

// Check if element is an image
function isImage(element) {
  // Basic checks
  if (element.tagName !== "IMG" || !element.src) return false;

  // For Google Images, allow everything
  if (window.location.hostname.includes("google.com")) {
    return true;
  }

  // Skip data URLs for other sites (usually small icons)
  if (element.src.startsWith("data:")) {
    return false;
  }

  // For other image sites, be more permissive with thumbnails
  if (
    window.location.hostname.includes("pinterest.com") ||
    window.location.hostname.includes("unsplash.com") ||
    window.location.hostname.includes("pexels.com") ||
    window.location.hostname.includes("shutterstock.com")
  ) {
    return true;
  }

  // Default: allow images that are reasonably sized
  return element.naturalWidth > 50 && element.naturalHeight > 50;
}

// Add event listeners to images
function addImageListeners() {
  const images = document.querySelectorAll("img");
  let processedCount = 0;

  images.forEach((img) => {
    if (isImage(img)) {
      processedCount++;
      addImageEventListeners(img);
    }
  });

  console.log(
    `Processed ${processedCount}/${images.length} images on ${window.location.hostname}`
  );
}

// Handle dynamically added images
function observeNewImages() {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.tagName === "IMG" && isImage(node)) {
            addImageEventListeners(node);
          }

          // Check for images within the added node
          const images = node.querySelectorAll
            ? node.querySelectorAll("img")
            : [];
          images.forEach((img) => {
            if (isImage(img)) {
              addImageEventListeners(img);
            }
          });
        }
      });
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Global mouse tracking
let currentHoveredImage = null;
let mouseX = 0;
let mouseY = 0;

// Track mouse position globally
document.addEventListener("mousemove", (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;

  // Find all images and check if cursor is within their bounds
  const allImages = document.querySelectorAll("img");
  let imageUnderCursor = null;

  for (const img of allImages) {
    if (!isImage(img)) continue;

    const rect = img.getBoundingClientRect();
    if (
      mouseX >= rect.left &&
      mouseX <= rect.right &&
      mouseY >= rect.top &&
      mouseY <= rect.bottom
    ) {
      imageUnderCursor = img;
      break;
    }
  }

  if (imageUnderCursor) {
    if (currentHoveredImage !== imageUnderCursor) {
      // New image under cursor
      hideHoverIcon();
      currentHoveredImage = imageUnderCursor;
      showHoverIcon(imageUnderCursor, e);
    }
  } else {
    // No image under cursor
    if (currentHoveredImage) {
      hideHoverIcon();
      currentHoveredImage = null;
    }
  }
});

// Helper function to add event listeners to an image
function addImageEventListeners(img) {
  // No need for individual event listeners since we're using global mouse tracking
}

// Script is working
console.log("Content script initialized");

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    console.log("DOM loaded, initializing...");
    addImageListeners();
    observeNewImages();

    // For image sites, also check after a delay to catch lazy-loaded images
    if (
      window.location.hostname.includes("google.com") ||
      window.location.hostname.includes("pinterest.com")
    ) {
      setTimeout(() => {
        addImageListeners();
      }, 1000);

      setTimeout(() => {
        addImageListeners();
      }, 3000);
    }
  });
} else {
  console.log("DOM already loaded, initializing...");
  addImageListeners();
  observeNewImages();

  // For image sites, also check after a delay to catch lazy-loaded images
  if (
    window.location.hostname.includes("google.com") ||
    window.location.hostname.includes("pinterest.com")
  ) {
    setTimeout(() => {
      addImageListeners();
    }, 1000);

    setTimeout(() => {
      addImageListeners();
    }, 3000);
  }
}

// Clean up on page unload
window.addEventListener("beforeunload", () => {
  hideHoverIcon();
});
