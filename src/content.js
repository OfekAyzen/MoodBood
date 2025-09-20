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
    addImageToWhiteboard(img.src, img.alt || "Image");
    hideHoverIcon();
  });
}

// Hide hover icon
function hideHoverIcon() {
  const existingIcon = document.getElementById("moodbood-hover-icon");
  if (existingIcon) {
    existingIcon.remove();
  }
}

// Add image to whiteboard
async function addImageToWhiteboard(src, alt) {
  try {
    console.log("Sending message to background script:", {
      action: "addImageToWhiteboard",
      src: src,
      alt: alt,
    });

    // Send message to background script to add image
    API.runtime.sendMessage({
      action: "addImageToWhiteboard",
      src: src,
      alt: alt,
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
