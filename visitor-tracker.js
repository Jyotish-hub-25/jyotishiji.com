(() => {
  "use strict";

  const script = document.currentScript;
  const BASE = (script?.dataset?.endpoint || "").replace(/\/+$/, "");
  if (!BASE) {
    console.warn("Visitor tracker: data-endpoint missing.");
    return;
  }

  const VISITOR_KEY = "jy_visitor_id_v1";
  const SESSION_KEY = "jy_session_id_v1";
  const SESSION_LAST_KEY = "jy_session_last_v1";
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  const HEARTBEAT_MS = 15 * 1000;

  function makeId(prefix) {
    const raw = (crypto.randomUUID?.() ||
      Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join(""))
      .replace(/-/g, "");
    return prefix + "_" + raw;
  }

  function getOrCreateVisitor() {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = makeId("v");
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  }

  function getOrCreateSession() {
    const now = Date.now();
    let id = localStorage.getItem(SESSION_KEY);
    const last = Number(localStorage.getItem(SESSION_LAST_KEY) || 0);
    if (!id || !last || now - last > SESSION_TIMEOUT_MS) {
      id = makeId("s");
      localStorage.setItem(SESSION_KEY, id);
    }
    localStorage.setItem(SESSION_LAST_KEY, String(now));
    return id;
  }

  const visitorId = getOrCreateVisitor();
  const sessionId = getOrCreateSession();

  function post(path, payload, beacon = false) {
    const body = JSON.stringify(payload);

    if (beacon && navigator.sendBeacon) {
      const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
      return navigator.sendBeacon(BASE + path, blob);
    }

    return fetch(BASE + path, {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      keepalive: true,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body,
    }).catch(() => {});
  }

  post("/api/start", { visitor_id: visitorId, session_id: sessionId });

  let activeStartedAt = null;
  let pendingSeconds = 0;

  function isActive() {
    return document.visibilityState === "visible" && document.hasFocus();
  }

  function beginActive() {
    if (activeStartedAt === null && isActive()) activeStartedAt = performance.now();
  }

  function endActive() {
    if (activeStartedAt === null) return;
    pendingSeconds += (performance.now() - activeStartedAt) / 1000;
    activeStartedAt = null;
  }

  function flush(beacon = false) {
    const sendSeconds = Math.min(Math.floor(pendingSeconds), 30);
    if (sendSeconds < 1) return;
    pendingSeconds -= sendSeconds;
    localStorage.setItem(SESSION_LAST_KEY, String(Date.now()));
    post("/api/heartbeat", {
      visitor_id: visitorId,
      session_id: sessionId,
      delta_seconds: sendSeconds,
    }, beacon);
  }

  function checkpoint(beacon = false) {
    const wasActive = activeStartedAt !== null;
    if (wasActive) endActive();
    flush(beacon);
    if (!beacon) beginActive();
  }

  window.addEventListener("focus", beginActive, { passive: true });
  window.addEventListener("blur", () => { endActive(); flush(false); }, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      endActive();
      flush(true);
    } else {
      beginActive();
    }
  }, { passive: true });
  window.addEventListener("pagehide", () => { endActive(); flush(true); }, { passive: true });

  setInterval(() => checkpoint(false), HEARTBEAT_MS);
  beginActive();
})();
