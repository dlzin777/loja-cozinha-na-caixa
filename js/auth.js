/**
 * Cliente da API com CSRF automático.
 * Nunca guarda senha/API key no localStorage.
 */

let csrfToken = null;

async function ensureCsrf() {
  if (csrfToken) return csrfToken;
  const res = await fetch("/api/csrf", { credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  csrfToken = data.csrf_token || null;
  return csrfToken;
}

async function api(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(options.headers || {}),
  };

  if (method !== "GET" && method !== "HEAD") {
    const token = await ensureCsrf();
    if (token) headers["X-CSRF-Token"] = token;
  }

  const res = await fetch(path, {
    ...options,
    method,
    headers,
    credentials: "same-origin",
  });

  const data = await res.json().catch(() => ({}));
  if (data.csrf_token) csrfToken = data.csrf_token;
  return { res, data };
}

async function getMe() {
  const { data } = await api("/api/me");
  if (data.csrf_token) csrfToken = data.csrf_token;
  return data.user || null;
}

function showMsg(el, text, type = "err") {
  if (!el) return;
  el.textContent = text;
  el.className = `auth-msg show ${type}`;
}

function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

document.addEventListener("DOMContentLoaded", () => {
  // Prefetch do CSRF assim que a página abre
  ensureCsrf().catch(() => {});

  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const msg = document.getElementById("authMsg");
  const next = qs("next") || "index.html";

  // Só permite redirect interno (anti open-redirect)
  function safeNext(url) {
    if (!url) return "index.html";
    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("//")) {
      return "index.html";
    }
    return url;
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;
      const { res, data } = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        showMsg(msg, data.error || "Não foi possível entrar.");
        return;
      }
      showMsg(msg, "Login feito! Redirecionando...", "ok");
      location.href = safeNext(next);
    });
  }

  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("name").value.trim();
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;
      const { res, data } = await api("/api/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      });
      if (!res.ok) {
        showMsg(msg, data.error || "Não foi possível criar a conta.");
        return;
      }
      showMsg(msg, "Conta criada! Redirecionando...", "ok");
      location.href = safeNext(next);
    });
  }
});

window.Auth = { api, getMe, ensureCsrf };
