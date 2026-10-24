/* Card Grader v2.0.1 — mobile camera and file picker fix */
(function () {
  "use strict";
  const API = String(window.CARD_GRADER_API || window.location.origin).replace(/\/+$/, "");
  const $ = (id) => document.getElementById(id);

  const state = {
    sessionId: null,
    imgW: 0,
    imgH: 0,
    image: null,
    scale: 1,
    physical: { tl: { x: 0.06, y: 0.06 }, tr: { x: 0.94, y: 0.06 }, br: { x: 0.94, y: 0.94 }, bl: { x: 0.06, y: 0.94 } },
    border: { tl: { x: 0.1, y: 0.1 }, tr: { x: 0.9, y: 0.1 }, br: { x: 0.9, y: 0.9 }, bl: { x: 0.1, y: 0.9 } },
    showP: true,
    showB: true,
    region: "top-left",
    mag: 11,
    drag: null,
  };

  const labels = {
    "top-left": "Top-left", "top-right": "Top-right",
    "bottom-right": "Bottom-right", "bottom-left": "Bottom-left",
    top: "Top edge", right: "Right edge", bottom: "Bottom edge", left: "Left edge",
  };

  const canvas = $("canvas");
  const ctx = canvas.getContext("2d");
  const svg = $("guides");
  const loupe = $("loupe");
  const lctx = loupe.getContext("2d");
  let stream = null;
  let loupeAbort = null;

  function status(msg) { $("status").textContent = msg || ""; }

  function absGuides() {
    const w = state.imgW, h = state.imgH;
    const conv = (g) => {
      if (g.tl.x > 1.5) return g;
      return {
        tl: { x: g.tl.x * w, y: g.tl.y * h },
        tr: { x: g.tr.x * w, y: g.tr.y * h },
        br: { x: g.br.x * w, y: g.br.y * h },
        bl: { x: g.bl.x * w, y: g.bl.y * h },
      };
    };
    state.physical = conv(state.physical);
    state.border = conv(state.border);
  }

  function guidesJSON(which) {
    const g = which === "border" ? state.border : state.physical;
    return {
      top_left: { x: g.tl.x, y: g.tl.y },
      top_right: { x: g.tr.x, y: g.tr.y },
      bottom_right: { x: g.br.x, y: g.br.y },
      bottom_left: { x: g.bl.x, y: g.bl.y },
    };
  }

  async function loadFile(file) {
    stopCamera();
    status("Loading image…");
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    state.image = img;
    state.imgW = img.naturalWidth;
    state.imgH = img.naturalHeight;
    state.physical = { tl: { x: 0.06, y: 0.06 }, tr: { x: 0.94, y: 0.06 }, br: { x: 0.94, y: 0.94 }, bl: { x: 0.06, y: 0.94 } };
    state.border = { tl: { x: 0.1, y: 0.1 }, tr: { x: 0.9, y: 0.1 }, br: { x: 0.9, y: 0.9 }, bl: { x: 0.1, y: 0.9 } };
    absGuides();

    // Render the selected photo immediately. Do not make the visible card wait
    // for the Python upload/API, which may be slow or unreachable.
    $("workspace").hidden = false;
    fit();
    draw();
    drawGuides();
    requestLoupe();
    URL.revokeObjectURL(url);

    status("Card loaded locally. Connecting to grading API…");
    const fd = new FormData();
    fd.append("file", file, file.name || "card.jpg");
    try {
      const r = await fetch(`${API}/upload`, { method: "POST", body: fd });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      // Accept the common session-id spellings used by Python API wrappers.
      state.sessionId = j.session_id || j.sessionId || j.session?.id || j.id || null;
      if (!state.sessionId) {
        throw new Error("Upload endpoint responded, but did not return a session ID. Expected session_id in its JSON response.");
      }
      status(`${j.width || state.imgW}×${j.height || state.imgH} ready — grading API connected`);
    } catch (e) {
      state.sessionId = null;
      status("API offline — loupe is client-only. " + e.message);
    }

  }

  function fit() {
    const stage = $("stage");
    const maxW = stage.clientWidth || 400;
    const maxH = Math.min(window.innerHeight * 0.5, 480);
    const s = Math.min(maxW / state.imgW, maxH / state.imgH, 1);
    const dw = Math.round(state.imgW * s);
    const dh = Math.round(state.imgH * s);
    canvas.width = dw;
    canvas.height = dh;
    canvas.style.width = dw + "px";
    canvas.style.height = dh + "px";
    svg.setAttribute("viewBox", `0 0 ${dw} ${dh}`);
    svg.style.width = dw + "px";
    svg.style.height = dh + "px";
    state.scale = s;
  }

  function draw() {
    if (!state.image) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(state.image, 0, 0, canvas.width, canvas.height);
  }

  function toCanvas(p) {
    return { x: p.x * state.scale, y: p.y * state.scale };
  }
  function toImg(cx, cy) {
    return { x: cx / state.scale, y: cy / state.scale };
  }

  function drawGuides() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const ns = "http://www.w3.org/2000/svg";
    const line = (a, b, color, w) => {
      const el = document.createElementNS(ns, "line");
      el.setAttribute("x1", a.x); el.setAttribute("y1", a.y);
      el.setAttribute("x2", b.x); el.setAttribute("y2", b.y);
      el.setAttribute("stroke", color);
      el.setAttribute("stroke-width", w);
      el.setAttribute("stroke-linecap", "round");
      svg.appendChild(el);
    };
    const handle = (pt, color, type, corner, gset) => {
      const c = toCanvas(pt);
      const center = {
        x: (state.physical.tl.x + state.physical.br.x) / 2,
        y: (state.physical.tl.y + state.physical.br.y) / 2,
      };
      const dx = center.x - pt.x, dy = center.y - pt.y;
      const len = Math.hypot(dx, dy) || 1;
      const inset = 78 / state.scale;
      const hx = c.x + (dx / len) * inset * state.scale;
      const hy = c.y + (dy / len) * inset * state.scale;
      line(c, { x: hx, y: hy }, color, 2.5);
      const mark = document.createElementNS(ns, "circle");
      mark.setAttribute("cx", c.x); mark.setAttribute("cy", c.y);
      mark.setAttribute("r", 5); mark.setAttribute("fill", color);
      mark.setAttribute("stroke", "#fff"); mark.setAttribute("stroke-width", 1.5);
      svg.appendChild(mark);
      const g = document.createElementNS(ns, "g");
      g.classList.add("handle");
      g.dataset.type = type;
      g.dataset.corner = corner;
      const circle = document.createElementNS(ns, "circle");
      circle.setAttribute("cx", hx); circle.setAttribute("cy", hy);
      circle.setAttribute("r", 22); circle.setAttribute("fill", color);
      circle.setAttribute("fill-opacity", "0.9");
      circle.setAttribute("stroke", "#fff"); circle.setAttribute("stroke-width", 2.5);
      g.appendChild(circle);
      svg.appendChild(g);
      g.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        // The large grab handle is intentionally inset from the real corner.
        // Preserve that screen-space offset while dragging, so the corner follows
        // the finger instead of jumping to the handle's starting position.
        const rect = canvas.getBoundingClientRect();
        const sx = canvas.width / Math.max(1, rect.width);
        const sy = canvas.height / Math.max(1, rect.height);
        const pointerX = (ev.clientX - rect.left) * sx;
        const pointerY = (ev.clientY - rect.top) * sy;
        const cornerCanvas = toCanvas(pt);
        const grabOffsetX = pointerX - cornerCanvas.x;
        const grabOffsetY = pointerY - cornerCanvas.y;

        state.drag = { type, corner, id: ev.pointerId, grabOffsetX, grabOffsetY };
        // Capture on the persistent SVG root; individual handles are redrawn
        // during movement, so capturing on the handle itself would lose capture.
        try { svg.setPointerCapture(ev.pointerId); } catch (_) {}

        const move = (e) => {
          if (!state.drag || e.pointerId !== state.drag.id) return;
          e.preventDefault();
          const rect = canvas.getBoundingClientRect();
          const sx = canvas.width / Math.max(1, rect.width);
          const sy = canvas.height / Math.max(1, rect.height);
          const x = (e.clientX - rect.left) * sx - state.drag.grabOffsetX;
          const y = (e.clientY - rect.top) * sy - state.drag.grabOffsetY;
          const p = toImg(x, y);
          p.x = Math.max(0, Math.min(state.imgW, p.x));
          p.y = Math.max(0, Math.min(state.imgH, p.y));
          (type === "physical" ? state.physical : state.border)[corner] = p;
          drawGuides();
        };
        const finish = (e) => {
          if (!state.drag || e.pointerId !== state.drag.id) return;
          state.drag = null;
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", finish);
          window.removeEventListener("pointercancel", finish);
          try {
            if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
          } catch (_) {}
          requestLoupe();
        };
        window.addEventListener("pointermove", move, { passive: false });
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
      });
    };

    if (state.showP) {
      const p = state.physical;
      const a = toCanvas(p.tl), b = toCanvas(p.tr), c = toCanvas(p.br), d = toCanvas(p.bl);
      line(a, b, "#38bdf8", 2); line(b, c, "#38bdf8", 2); line(c, d, "#38bdf8", 2); line(d, a, "#38bdf8", 2);
      handle(p.tl, "#38bdf8", "physical", "tl");
      handle(p.tr, "#38bdf8", "physical", "tr");
      handle(p.br, "#38bdf8", "physical", "br");
      handle(p.bl, "#38bdf8", "physical", "bl");
    }
    if (state.showB) {
      const p = state.border;
      const a = toCanvas(p.tl), b = toCanvas(p.tr), c = toCanvas(p.br), d = toCanvas(p.bl);
      line(a, b, "#c4b5fd", 1.5); line(b, c, "#c4b5fd", 1.5); line(c, d, "#c4b5fd", 1.5); line(d, a, "#c4b5fd", 1.5);
      handle(p.tl, "#c4b5fd", "border", "tl");
      handle(p.tr, "#c4b5fd", "border", "tr");
      handle(p.br, "#c4b5fd", "border", "br");
      handle(p.bl, "#c4b5fd", "border", "bl");
    }
  }

  async function requestLoupe() {
    $("loupe-title").textContent = labels[state.region] || state.region;
    $("z-label").textContent = `${state.mag}× nearest`;
    if (!state.sessionId) return clientLoupe();
    if (loupeAbort) loupeAbort.abort();
    loupeAbort = new AbortController();
    try {
      const r = await fetch(`${API}/crop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: loupeAbort.signal,
        body: JSON.stringify({
          session_id: state.sessionId,
          region: state.region,
          guides: guidesJSON("physical"),
          magnification: state.mag,
          method: "nearest",
          edge_padding_px: 22,
          crop_size_px: 256,
        }),
      });
      if (!r.ok) throw new Error("crop failed");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const size = Math.min($("loupe-wrap").clientWidth || 280, 360);
      loupe.width = size; loupe.height = size;
      lctx.imageSmoothingEnabled = false;
      lctx.clearRect(0, 0, size, size);
      const sc = Math.min(size / img.width, size / img.height);
      const dw = img.width * sc, dh = img.height * sc;
      lctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
      URL.revokeObjectURL(url);
    } catch (e) {
      if (e.name !== "AbortError") clientLoupe();
    }
  }

  function clientLoupe() {
    if (!state.image) return;
    const p = state.physical;
    let cx, cy;
    const r = state.region;
    if (r === "top-left") { cx = p.tl.x; cy = p.tl.y; }
    else if (r === "top-right") { cx = p.tr.x; cy = p.tr.y; }
    else if (r === "bottom-right") { cx = p.br.x; cy = p.br.y; }
    else if (r === "bottom-left") { cx = p.bl.x; cy = p.bl.y; }
    else if (r === "top") { cx = (p.tl.x + p.tr.x) / 2; cy = (p.tl.y + p.tr.y) / 2; }
    else if (r === "right") { cx = (p.tr.x + p.br.x) / 2; cy = (p.tr.y + p.br.y) / 2; }
    else if (r === "bottom") { cx = (p.bl.x + p.br.x) / 2; cy = (p.bl.y + p.br.y) / 2; }
    else { cx = (p.tl.x + p.bl.x) / 2; cy = (p.tl.y + p.bl.y) / 2; }
    const midX = (p.tl.x + p.br.x) / 2, midY = (p.tl.y + p.br.y) / 2;
    const dx = midX - cx, dy = midY - cy, L = Math.hypot(dx, dy) || 1;
    cx += (dx / L) * 22;
    cy += (dy / L) * 22;
    const half = Math.max(16, Math.round(128 / state.mag));
    const tmp = document.createElement("canvas");
    tmp.width = half * 2; tmp.height = half * 2;
    tmp.getContext("2d").drawImage(state.image, cx - half, cy - half, half * 2, half * 2, 0, 0, half * 2, half * 2);
    const outW = half * 2 * state.mag, outH = half * 2 * state.mag;
    const out = document.createElement("canvas");
    out.width = outW; out.height = outH;
    const octx = out.getContext("2d");
    octx.imageSmoothingEnabled = false;
    octx.drawImage(tmp, 0, 0, outW, outH);
    const size = Math.min($("loupe-wrap").clientWidth || 280, 360);
    loupe.width = size; loupe.height = size;
    lctx.imageSmoothingEnabled = false;
    lctx.clearRect(0, 0, size, size);
    const sc = Math.min(size / outW, size / outH);
    lctx.drawImage(out, (size - outW * sc) / 2, (size - outH * sc) / 2, outW * sc, outH * sc);
  }

  function setScore(el, val) {
    if (val != null && val !== undefined) {
      el.textContent = Number(val).toFixed(1);
      el.style.color = "var(--ok)";
    } else {
      el.textContent = "—";
      el.style.color = "var(--muted)";
    }
  }

  async function gradeAll() {
    if (!state.sessionId) return status("Grading unavailable: the upload API has not supplied a session ID. Check the upload status above; if it says API offline, the Python API/proxy is unreachable.");
    status("Scoring subgrades…");
    try {
      const r = await fetch(`${API}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: state.sessionId,
          guides: guidesJSON("physical"),
          border_guides: guidesJSON("border"),
          magnification: state.mag,
          edge_padding_px: 22,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const g = await r.json();
      setScore($("g-overall"), g.overall?.score);
      $("g-overall-why").textContent = g.overall?.explanation || "";
      setScore($("g-cen"), g.centering?.score);
      $("g-cen-why").textContent = g.centering?.explanation || "";
      setScore($("g-cor"), g.corners?.score);
      $("g-cor-why").textContent = g.corners?.explanation || "";
      setScore($("g-edg"), g.edges?.score);
      $("g-edg-why").textContent = g.edges?.explanation || "";
      setScore($("g-sur"), g.surface?.score);
      $("g-sur-why").textContent = g.surface?.explanation || "";
      status("Subgrades ready.");
    } catch (e) {
      status("Grade error: " + e.message);
    }
  }

  async function downloadLabel() {
    if (!state.sessionId) return status("Region analysis unavailable: the upload API has not supplied a session ID. Check the upload status above; if it says API offline, the Python API/proxy is unreachable.");
    status("Building label…");
    try {
      const r = await fetch(`${API}/report-card`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: state.sessionId,
          guides: guidesJSON("physical"),
          border_guides: guidesJSON("border"),
          magnification: 8,
          edge_padding_px: 22,
        }),
      });
      if (!r.ok) throw new Error("download failed");
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "card-grader-subgrades.png";
      a.click();
      status("Label downloaded.");
    } catch (e) {
      status("Download error: " + e.message);
    }
  }

  async function analyzeRegion() {
    if (!state.sessionId) return status("API required.");
    status("Analyzing region…");
    try {
      const r = await fetch(`${API}/assess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: state.sessionId,
          region: state.region,
          guides: guidesJSON("physical"),
          magnification: state.mag,
          method: "nearest",
          edge_padding_px: 22,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      $("region-result").hidden = false;
      setScore($("r-score"), d.inconclusive ? null : d.preliminary_score);
      $("r-why").textContent = d.score_explanation || d.explanation || "";
      $("r-warn").innerHTML = "";
      (d.warnings || []).forEach((w) => {
        const li = document.createElement("li");
        li.textContent = w;
        $("r-warn").appendChild(li);
      });
      status("Region done.");
    } catch (e) {
      status("Region error: " + e.message);
    }
  }

  // events
  function openPhotoPicker(useCamera) {
    const input = $(useCamera ? "camera-input" : "file-input");
    if (!input) {
      status("Photo picker is unavailable. Refresh the page and try again.");
      return;
    }
    // Reset first so choosing the same photo twice still fires change.
    input.value = "";
    input.click();
  }

  ["file-input", "camera-input"].forEach((id) => {
    const input = $(id);
    if (!input) return;
    input.addEventListener("change", (e) => {
      const target = e.currentTarget;
      const file = target.files && target.files[0];
      if (file) loadFile(file).catch((err) => status("Image error: " + (err.message || err)));
      target.value = "";
    });
  });
  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    const video = $("cam");
    if (video) {
      video.pause();
      video.srcObject = null;
      video.hidden = true;
    }
    if ($("btn-shutter")) $("btn-shutter").hidden = true;
  }

  function cameraErrorMessage(error) {
    const name = error && error.name;
    if (!window.isSecureContext) return "Camera access requires HTTPS. Open this site using its https:// address.";
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      return "This browser does not provide camera access. Update your browser or use Upload to choose a photo.";
    }
    if (name === "NotAllowedError" || name === "SecurityError") return "Camera permission was denied. Allow camera access for this site in your browser settings, then try again.";
    if (name === "NotFoundError" || name === "DevicesNotFoundError") return "No camera was found. You can still use Upload to choose a photo.";
    if (name === "NotReadableError" || name === "TrackStartError") return "The camera is busy in another app. Close other camera apps and try again.";
    if (name === "OverconstrainedError") return "The requested camera mode is unavailable. Try again or use Upload.";
    return "Could not start the camera" + (error && error.message ? ": " + error.message : ". Try Upload instead.");
  }

  $("btn-camera").addEventListener("click", async () => {
    stopCamera();
    // Android browsers sometimes expose no getUserMedia despite HTTPS.
    // Fall back to the OS camera/photo chooser rather than leaving Camera inert.
    if (!window.isSecureContext ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== "function") {
      status("Opening your phone's camera/photo chooser…");
      openPhotoPicker(true);
      return;
    }
    const button = $("btn-camera");
    button.disabled = true;
    status("Requesting camera permission…");
    try {
      // Use the rear camera when available, but do not require that exact lens.
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      const video = $("cam");
      video.srcObject = stream;
      video.hidden = false;
      await video.play();
      $("btn-shutter").hidden = false;
      status("Camera ready. Position the card and tap Capture.");
    } catch (e) {
      stopCamera();
      status(cameraErrorMessage(e) + " Opening the phone's camera/photo chooser…");
      // Still offer a working capture route when browser camera permission/API
      // is blocked by the embedded browser or site permission state.
      openPhotoPicker(true);
    } finally {
      button.disabled = false;
    }
  });
  $("btn-shutter").addEventListener("click", async () => {
    const video = $("cam");
    if (!video.videoWidth || !video.videoHeight) {
      status("Camera is still starting. Wait a moment and tap Capture again.");
      return;
    }
    const c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
    const blob = await new Promise((resolve) => c.toBlob(resolve, "image/jpeg", 0.95));
    stopCamera();
    if (!blob) {
      status("Could not capture the photo. Please try again or use Upload.");
      return;
    }
    try {
      await loadFile(new File([blob], "capture.jpg", { type: "image/jpeg" }));
    } catch (e) {
      status("Could not load the captured photo: " + (e.message || e));
    }
  });
  window.addEventListener("pagehide", stopCamera);
  $("tog-physical").addEventListener("change", (e) => { state.showP = e.target.checked; drawGuides(); });
  $("tog-border").addEventListener("change", (e) => { state.showB = e.target.checked; drawGuides(); });
  $("tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-r]");
    if (!b) return;
    $("tabs").querySelectorAll("button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    state.region = b.dataset.r;
    $("region-result").hidden = true;
    requestLoupe();
  });
  $("z-range").addEventListener("input", () => {
    state.mag = parseFloat($("z-range").value);
    requestLoupe();
  });
  $("z-in").addEventListener("click", () => {
    $("z-range").value = Math.min(30, parseFloat($("z-range").value) + 1);
    $("z-range").dispatchEvent(new Event("input"));
  });
  $("z-out").addEventListener("click", () => {
    $("z-range").value = Math.max(2, parseFloat($("z-range").value) - 1);
    $("z-range").dispatchEvent(new Event("input"));
  });
  $("btn-grade").addEventListener("click", gradeAll);
  $("btn-dl").addEventListener("click", downloadLabel);
  $("btn-region").addEventListener("click", analyzeRegion);
  $("btn-reset").addEventListener("click", () => {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    state.sessionId = null;
    state.image = null;
    $("workspace").hidden = true;
    $("file-input").value = "";
    status("");
  });
  window.addEventListener("resize", () => {
    if (state.image) { fit(); draw(); drawGuides(); }
  });

  status("Upload a card photo to begin.");
  // Inline button fallbacks stay active until all event handlers initialize.
  window.CARD_GRADER_APP_READY = true;
})();
