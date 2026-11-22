export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json; charset=utf-8",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: corsHeaders });

    if (!env.CHAT_KV) {
      return json({ ok: false, error: "MISSING_CHAT_KV_BINDING" }, 500);
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const MSG_TTL_SEC = 1800;
    const ONLINE_TTL_SEC = 90;

    try {
      if (request.method === "GET" && path === "/messages") {
        const afterId = Number(url.searchParams.get("after") || 0);
        const rawList = await env.CHAT_KV.get("messages_list", "json");
        let messages = Array.isArray(rawList) ? rawList : [];

        messages = messages.filter((m) => nowSec - Number(m.time || 0) <= MSG_TTL_SEC);

        const filtered = afterId > 0
          ? messages.filter((m) => Number(m.id || 0) > afterId)
          : messages.slice(-30);

        return json({
          ok: true,
          messages: filtered,
          serverTime: nowSec,
        });
      }

      if (request.method === "POST" && path === "/send") {
        const body = await request.json().catch(() => null);
        if (!body || typeof body.text !== "string") {
          return json({ ok: false, error: "INVALID_PAYLOAD" }, 400);
        }

        const cleanText = body.text.trim().slice(0, 200);
        if (!cleanText) {
          return json({ ok: false, error: "EMPTY_TEXT" }, 400);
        }

        const safeUser = String(body.user || "Player").slice(0, 40);
        const safeDisplay = String(body.displayName || safeUser).slice(0, 50);
        const safeUserId = Number(body.userId) || 0;
        const safeServer = String(body.server || "Global").slice(0, 24);

        const rawList = await env.CHAT_KV.get("messages_list", "json");
        let messages = Array.isArray(rawList) ? rawList : [];

        messages = messages.filter((m) => nowSec - Number(m.time || 0) <= MSG_TTL_SEC);

        const lastId = messages.length > 0 ? Number(messages[messages.length - 1].id || 0) : 0;
        const nextId = Math.max(lastId + 1, Date.now());

        const newMsg = {
          id: nextId,
          user: safeUser,
          displayName: safeDisplay,
          userId: safeUserId,
          text: cleanText,
          time: nowSec,
          server: safeServer,
        };

        messages.push(newMsg);
        if (messages.length > 60) {
          messages = messages.slice(-60);
        }

        await env.CHAT_KV.put("messages_list", JSON.stringify(messages), {
          expirationTtl: MSG_TTL_SEC,
        });

        return json({
          ok: true,
          id: nextId,
          message: newMsg,
        });
      }

      if (request.method === "POST" && path === "/ping") {
        const body = await request.json().catch(() => ({}));
        const safeUser = String(body.user || "").trim().slice(0, 40);
        const safeDisplay = String(body.displayName || safeUser).slice(0, 50);
        const safeUserId = Number(body.userId) || 0;

        const rawUsers = await env.CHAT_KV.get("online_users", "json");
        const usersMap = rawUsers && typeof rawUsers === "object" ? rawUsers : {};

        for (const key of Object.keys(usersMap)) {
          if (nowSec - Number(usersMap[key].lastSeen || 0) > ONLINE_TTL_SEC) {
            delete usersMap[key];
          }
        }

        if (safeUser && safeUser !== "Player") {
          usersMap[safeUser] = {
            user: safeUser,
            displayName: safeDisplay,
            userId: safeUserId,
            lastSeen: nowSec,
          };
        }

        await env.CHAT_KV.put("online_users", JSON.stringify(usersMap), {
          expirationTtl: 300,
        });

        return json({
          ok: true,
          users: Object.values(usersMap),
        });
      }

      if (request.method === "GET" && path === "/") {
        return json({
          ok: true,
          status: "Hirose x Miyano Cross-Chat Worker Ready",
          time: nowSec,
        });
      }

      return json({ ok: false, error: "NOT_FOUND" }, 404);
    } catch (err) {
      return json(
        { ok: false, error: "INTERNAL_ERROR", detail: String(err?.message || err) },
        500
      );
    }
  },
};
      
