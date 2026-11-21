const memoryStore = {
  messages: [],
  users: new Map(),
  nextId: 1
};

const MAX_MESSAGES = 60;
const TTL_SECONDS = 1800;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

async function loadMessages(env) {
  if (env && env.CHAT_KV) {
    const raw = await env.CHAT_KV.get("messages_v1", "json");
    if (raw && Array.isArray(raw.items)) {
      return { items: raw.items, nextId: Number(raw.nextId) || 1 };
    }
    return { items: [], nextId: 1 };
  }
  return { items: memoryStore.messages, nextId: memoryStore.nextId };
}

async function saveMessages(env, state) {
  const trimmed = state.items.slice(-MAX_MESSAGES);
  const nextState = { items: trimmed, nextId: state.nextId };
  memoryStore.messages = trimmed;
  memoryStore.nextId = state.nextId;

  if (env && env.CHAT_KV) {
    await env.CHAT_KV.put("messages_v1", JSON.stringify(nextState), {
      expirationTtl: TTL_SECONDS
    });
  }
}

function cleanupAndListUsers(body) {
  const nowSec = Math.floor(Date.now() / 1000);
  if (body && body.user) {
    const uname = String(body.user).slice(0, 40);
    if (uname && uname !== "Player") {
      memoryStore.users.set(uname, {
        user: uname,
        displayName: String(body.displayName || uname).slice(0, 40),
        userId: Number(body.userId) || 0,
        server: String(body.server || "Global").slice(0, 20),
        seenAt: nowSec
      });
    }
  }

  const active = [];
  for (const [key, info] of memoryStore.users.entries()) {
    if (nowSec - info.seenAt > 120) {
      memoryStore.users.delete(key);
    } else {
      active.push({
        user: info.user,
        displayName: info.displayName,
        userId: info.userId,
        server: info.server
      });
    }
  }
  return active;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return jsonResponse({ ok: true });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/messages") {
      const afterId = Number(url.searchParams.get("after") || "0") || 0;
      const state = await loadMessages(env);
      const filtered = afterId > 0
        ? state.items.filter((m) => Number(m.id) > afterId)
        : state.items;

      return jsonResponse({
        ok: true,
        messages: filtered,
        latestId: state.nextId - 1
      });
    }

    if (request.method === "POST" && path === "/send") {
      let body = {};
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
      }

      const text = String(body.text || "").trim().slice(0, 200);
      if (!text) {
        return jsonResponse({ ok: false, error: "Empty message" }, 400);
      }

      const state = await loadMessages(env);
      const msg = {
        id: state.nextId++,
        user: String(body.user || "Player").slice(0, 40),
        displayName: String(body.displayName || body.user || "Player").slice(0, 40),
        userId: Number(body.userId) || 0,
        text,
        time: Number(body.time) || Math.floor(Date.now() / 1000),
        server: String(body.server || "Global").slice(0, 20)
      };

      state.items.push(msg);
      await saveMessages(env, state);

      return jsonResponse({ ok: true, id: msg.id, message: msg });
    }

    if (request.method === "POST" && path === "/ping") {
      let body = {};
      try {
        body = await request.json();
      } catch {
        body = {};
      }
      const users = cleanupAndListUsers(body);
      return jsonResponse({ ok: true, users });
    }

    return jsonResponse({
      ok: true,
      service: "hirose-chat-api",
      kvEnabled: Boolean(env && env.CHAT_KV)
    });
  }
};
