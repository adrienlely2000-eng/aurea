/* Aurea — stockage local. Toutes les données restent dans le navigateur. */

const Store = (() => {
  const KEY = "aurea.finance.v1";
  const VAULT_KEY = "aurea.vault.v1";
  const SESSION_KEY = "aurea.session.v1";
  const API_BASE = (location.protocol === "http:" || location.protocol === "https:")
    ? ""
    : "http://127.0.0.1:3847";

  const CATEGORIES = [
    { id: "cat-logement", name: "Logement", icon: "⌂", color: "#c4a574", kind: "expense" },
    { id: "cat-courses", name: "Courses", icon: "◍", color: "#7eb39a", kind: "expense" },
    { id: "cat-transport", name: "Transport", icon: "▷", color: "#7aa2c4", kind: "expense" },
    { id: "cat-forfaits", name: "Forfaits & abos", icon: "◎", color: "#b794c4", kind: "expense" },
    { id: "cat-energie", name: "Énergie", icon: "✦", color: "#d4b06a", kind: "expense" },
    { id: "cat-assurances", name: "Assurances", icon: "◇", color: "#8aa0b8", kind: "expense" },
    { id: "cat-sante", name: "Santé", icon: "+", color: "#d4899a", kind: "expense" },
    { id: "cat-sorties", name: "Sorties", icon: "○", color: "#d4926a", kind: "expense" },
    { id: "cat-restaurant", name: "Restaurant", icon: "🍽", color: "#d4a07a", kind: "expense" },
    { id: "cat-loisirs", name: "Loisirs", icon: "✶", color: "#8ab4c8", kind: "expense" },
    { id: "cat-voyage", name: "Voyage", icon: "✈", color: "#6a9ec4", kind: "expense" },
    { id: "cat-cadeaux", name: "Cadeaux", icon: "❀", color: "#c48aa0", kind: "expense" },
    { id: "cat-animaux", name: "Animaux", icon: "🐾", color: "#a8835e", kind: "expense" },
    { id: "cat-dettes", name: "Dettes & crédits", icon: "▭", color: "#c4a080", kind: "expense" },
    { id: "cat-epargne", name: "Épargne", icon: "▣", color: "#9aaf88", kind: "expense" },
    { id: "cat-autre", name: "Autre", icon: "·", color: "#9aa3b0", kind: "expense" },
    { id: "cat-salaire", name: "Salaire", icon: "◆", color: "#7eb8c9", kind: "income" },
    { id: "cat-aides", name: "Aides & primes", icon: "◇", color: "#8bc4b0", kind: "income" },
    { id: "cat-remb", name: "Remboursement", icon: "↩", color: "#a8b8c8", kind: "income" },
    { id: "cat-autre-in", name: "Autre revenu", icon: "·", color: "#9aa3b0", kind: "income" }
  ];

  const TEMPLATES = [
    { name: "Loyer", categoryId: "cat-logement", frequency: "monthly" },
    { name: "Internet", categoryId: "cat-forfaits", frequency: "monthly" },
    { name: "Forfait mobile", categoryId: "cat-forfaits", frequency: "monthly" },
    { name: "Électricité", categoryId: "cat-energie", frequency: "monthly" },
    { name: "Gaz", categoryId: "cat-energie", frequency: "monthly" },
    { name: "Assurance habitation", categoryId: "cat-assurances", frequency: "monthly" },
    { name: "Assurance auto", categoryId: "cat-assurances", frequency: "monthly" },
    { name: "Mutuelle", categoryId: "cat-sante", frequency: "monthly" },
    { name: "Streaming", categoryId: "cat-forfaits", frequency: "monthly" },
    { name: "Amazon Prime", categoryId: "cat-forfaits", frequency: "monthly" },
    { name: "Spotify", categoryId: "cat-forfaits", frequency: "monthly" },
    { name: "Transport / Navigo", categoryId: "cat-transport", frequency: "monthly" }
  ];

  function uid(prefix = "id") {
    const rand = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
    return prefix + "-" + rand;
  }

  function blank() {
    return {
      version: 1,
      settings: {
        firstName: "",
        currency: "EUR",
        theme: "dark",
        monthStartDay: 1,
        setupDone: false,
        safetyBuffer: 0,
        focusAccountId: ""
      },
      accounts: [],
      categories: CATEGORIES.map((c) => ({ ...c, budget: 0 })),
      transactions: [],
      recurrings: [],
      goals: []
    };
  }

  function dataKey(id) {
    return KEY + "." + id;
  }

  function hydrate(parsed) {
    const next = Object.assign(blank(), parsed || {});
    next.settings = Object.assign(blank().settings, (parsed && parsed.settings) || {});
    if (!Array.isArray(next.categories) || next.categories.length === 0) {
      next.categories = CATEGORIES.map((c) => ({ ...c, budget: 0 }));
    } else {
      CATEGORIES.forEach((c) => {
        if (!next.categories.find((x) => x.id === c.id)) next.categories.push({ ...c, budget: 0 });
      });
    }
    next.accounts = next.accounts || [];
    next.transactions = next.transactions || [];
    next.recurrings = next.recurrings || [];
    next.goals = next.goals || [];
    return next;
  }

  async function sha256Hex(str) {
    if (crypto.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0") + String(str.length);
  }

  function randomSalt() {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function hashPassword(password, salt) {
    return sha256Hex(salt + "\0" + String(password));
  }

  let data = blank();
  let vault = { version: 1, profiles: [] };
  let activeProfileId = null;
  let apiToken = "";
  let cloudOn = false;
  let saveTimer = 0;

  async function api(method, path, body) {
    const opts = {
      method,
      headers: { "Content-Type": "application/json" }
    };
    if (apiToken) opts.headers.Authorization = "Bearer " + apiToken;
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(API_BASE + path, opts);
    let json = {};
    try { json = await res.json(); } catch (err) { json = {}; }
    if (!res.ok) {
      const err = new Error((json && json.error) || "Erreur serveur");
      err.status = res.status;
      throw err;
    }
    return json;
  }

  function persistLocal() {
    if (activeProfileId) localStorage.setItem(dataKey(activeProfileId), JSON.stringify(data));
    saveVault();
  }

  function pushCloudSoon() {
    if (!cloudOn || !apiToken || !activeProfileId) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      api("PUT", "/api/data", data).catch(() => {});
    }, 400);
  }

  function loadVault() {
    try {
      const raw = localStorage.getItem(VAULT_KEY);
      if (raw) vault = Object.assign({ version: 1, profiles: [] }, JSON.parse(raw));
      if (!Array.isArray(vault.profiles)) vault.profiles = [];
    } catch (err) {
      console.warn("Aurea: coffre illisible.", err);
      vault = { version: 1, profiles: [] };
    }
  }

  function saveVault() {
    localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
  }

  function peekLegacy() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function hasLegacyData() {
    return !vault.profiles.length && !!localStorage.getItem(KEY);
  }

  function legacyName() {
    const parsed = peekLegacy();
    return (parsed && parsed.settings && parsed.settings.firstName) || "";
  }

  function loadFromProfile(id) {
    try {
      const raw = localStorage.getItem(dataKey(id));
      if (!raw) {
        data = blank();
        return data;
      }
      data = hydrate(JSON.parse(raw));
      return data;
    } catch (err) {
      console.warn("Aurea: données illisibles, réinitialisation.", err);
      data = blank();
      return data;
    }
  }

  function load() {
    if (!activeProfileId) return data;
    return loadFromProfile(activeProfileId);
  }

  function save() {
    persistLocal();
    pushCloudSoon();
    return data;
  }

  function get() {
    return data;
  }

  function replace(next) {
    data = hydrate(next);
    save();
    return data;
  }

  function reset() {
    data = blank();
    save();
    return data;
  }

  function exportJson() {
    return JSON.stringify(data, null, 2);
  }

  function importJson(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") throw new Error("Fichier invalide");
    data = hydrate(parsed);
    save();
    return data;
  }

  function profiles() {
    return vault.profiles.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt }));
  }

  function isUnlocked() {
    return !!activeProfileId;
  }

  function activeProfile() {
    const p = vault.profiles.find((x) => x.id === activeProfileId);
    return p ? { id: p.id, name: p.name } : (activeProfileId ? { id: activeProfileId, name: data.settings.firstName || "Vous" } : null);
  }

  async function verifyPassword(id, password) {
    const p = vault.profiles.find((x) => x.id === id);
    if (!p || !p.passwordHash) return false;
    const hash = await hashPassword(password, p.salt);
    return hash === p.passwordHash;
  }

  function writeSession() {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      userId: activeProfileId,
      token: apiToken || ""
    }));
  }

  async function unlock(id, password) {
    if (cloudOn) {
      try {
        const res = await api("POST", "/api/login", { id, password });
        apiToken = res.token;
        activeProfileId = res.profile.id;
        data = hydrate(res.payload);
        if (!vault.profiles.find((p) => p.id === activeProfileId)) {
          vault.profiles.push({ id: res.profile.id, name: res.profile.name, createdAt: Date.now() });
        } else {
          vault.profiles.find((p) => p.id === activeProfileId).name = res.profile.name;
        }
        persistLocal();
        writeSession();
        return true;
      } catch (err) {
        return false;
      }
    }
    if (!(await verifyPassword(id, password))) return false;
    activeProfileId = id;
    loadFromProfile(id);
    writeSession();
    return true;
  }

  function lock() {
    if (cloudOn && apiToken) api("POST", "/api/logout").catch(() => {});
    activeProfileId = null;
    apiToken = "";
    sessionStorage.removeItem(SESSION_KEY);
    data = blank();
    data.settings.setupDone = true;
  }

  async function createProfile(name, password, options = {}) {
    const label = String(name || "").trim();
    const pass = String(password || "");
    if (label.length < 1) return { ok: false, error: "Indique un prénom." };
    if (pass.length < 4) return { ok: false, error: "Le mot de passe doit faire au moins 4 caractères." };

    let next = blank();
    next.settings.firstName = label;
    const isFirstLocal = vault.profiles.length === 0;
    if (isFirstLocal) {
      const legacy = peekLegacy();
      if (legacy) {
        next = hydrate(legacy);
        if (!next.settings.firstName) next.settings.firstName = label;
        localStorage.removeItem(KEY);
      }
    }

    const switchTo = options.switchTo !== false;

    if (cloudOn) {
      try {
        const res = await api("POST", "/api/register", {
          name: label,
          password: pass,
          payload: next
        });
        vault.profiles.push({ id: res.profile.id, name: res.profile.name, createdAt: Date.now() });
        saveVault();
        if (switchTo) {
          apiToken = res.token;
          activeProfileId = res.profile.id;
          data = hydrate(next);
          persistLocal();
          writeSession();
        }
        return { ok: true, profile: res.profile };
      } catch (err) {
        return { ok: false, error: err.message || "Création impossible" };
      }
    }

    const salt = randomSalt();
    const passwordHash = await hashPassword(pass, salt);
    const id = uid("usr");
    const profile = { id, name: label, salt, passwordHash, createdAt: Date.now() };
    vault.profiles.push(profile);
    saveVault();
    if (switchTo) {
      activeProfileId = id;
      data = next;
      save();
      writeSession();
    } else {
      localStorage.setItem(dataKey(id), JSON.stringify(next));
    }
    return { ok: true, profile: { id, name: label } };
  }

  async function changePassword(oldPassword, newPassword) {
    if (!activeProfileId) return { ok: false, error: "Aucun espace ouvert." };
    if (String(newPassword || "").length < 4) return { ok: false, error: "Le nouveau mot de passe doit faire au moins 4 caractères." };
    if (cloudOn && apiToken) {
      try {
        await api("POST", "/api/password", { current: oldPassword, next: newPassword });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message || "Changement impossible" };
      }
    }
    if (!(await verifyPassword(activeProfileId, oldPassword))) return { ok: false, error: "Mot de passe actuel incorrect." };
    const p = vault.profiles.find((x) => x.id === activeProfileId);
    p.salt = randomSalt();
    p.passwordHash = await hashPassword(newPassword, p.salt);
    saveVault();
    return { ok: true };
  }

  function renameActive(name) {
    const label = String(name || "").trim();
    const p = vault.profiles.find((x) => x.id === activeProfileId);
    if (p && label) {
      p.name = label;
      saveVault();
    }
    if (cloudOn && apiToken && label) api("POST", "/api/rename", { name: label }).catch(() => {});
  }

  function restoreSession() {
    loadVault();
    let sid = "";
    let tok = "";
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        if (raw.charAt(0) === "{") {
          const parsed = JSON.parse(raw);
          sid = parsed.userId || "";
          tok = parsed.token || "";
        } else sid = raw;
      }
    } catch (err) { sid = ""; }
    apiToken = tok;
    if (sid && (vault.profiles.some((p) => p.id === sid) || tok)) {
      activeProfileId = sid;
      loadFromProfile(sid);
      return true;
    }
    activeProfileId = null;
    apiToken = "";
    data = blank();
    data.settings.setupDone = true;
    return false;
  }

  async function migrateLocalToCloud() {
    if (!vault.profiles.length) return;
    const blobs = {};
    vault.profiles.forEach((p) => {
      try {
        const raw = localStorage.getItem(dataKey(p.id));
        blobs[p.id] = raw ? JSON.parse(raw) : {};
      } catch (err) {
        blobs[p.id] = {};
      }
    });
    await api("POST", "/api/migrate", { profiles: vault.profiles, data: blobs });
  }

  async function boot() {
    loadVault();
    try {
      await api("GET", "/api/health");
      cloudOn = true;
      await migrateLocalToCloud();
      const list = await api("GET", "/api/users");
      if (Array.isArray(list) && list.length) {
        vault.profiles = list.map((p) => {
          const old = vault.profiles.find((x) => x.id === p.id) || {};
          return { id: p.id, name: p.name, createdAt: p.createdAt, salt: old.salt, passwordHash: old.passwordHash };
        });
        saveVault();
      }
    } catch (err) {
      cloudOn = false;
    }
    restoreSession();
    if (cloudOn && apiToken && activeProfileId) {
      try {
        const payload = await api("GET", "/api/data");
        data = hydrate(payload);
        persistLocal();
      } catch (err) {
        apiToken = "";
        activeProfileId = null;
        sessionStorage.removeItem(SESSION_KEY);
        data = blank();
        data.settings.setupDone = true;
      }
    }
    return { cloudOn };
  }

  function isCloud() {
    return cloudOn;
  }

  restoreSession();

  return {
    KEY,
    CATEGORIES,
    TEMPLATES,
    uid,
    blank,
    load,
    save,
    get,
    replace,
    reset,
    exportJson,
    importJson,
    profiles,
    isUnlocked,
    activeProfile,
    unlock,
    lock,
    createProfile,
    changePassword,
    renameActive,
    hasLegacyData,
    legacyName,
    restoreSession,
    boot,
    isCloud
  };
})();
