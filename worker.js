export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    const h = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    const j = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: h });
    if (request.method === "OPTIONS") return new Response(null, { headers: h });
    if (u.pathname === "/" && request.method === "GET") return j({ ok: true, service: "Hirose x Miyanno Chat" });
    if (u.pathname === "/messages" && request.method === "GET") {
      const list = JSON.parse((await env.CHAT_KV.get("messages")) || "[]");
      const after = Number(u.searchParams.get("after") || 0);
      const msgs = after > 0 ? list.filter(m => m.id > after) : list;
      return j({ ok: true, count: msgs.length, messages: msgs });
    }
    if (u.pathname === "/send" && request.method === "POST") {
      let b; try { b = await request.json(); } catch { return j({ ok: false, error: "Invalid JSON" }, 400); }
      const text = typeof b.text === "string" ? b.text.trim() : "";
      if (!text) return j({ ok: false, error: "Empty" }, 400);
      if (text.length > 200) return j({ ok: false, error: "Max 200" }, 400);
      const list = JSON.parse((await env.CHAT_KV.get("messages")) || "[]");
      const msg = {
        id: Date.now(),
        user: String(b.user || "Player").replace(/[\r\n]/g, "").slice(0, 28) || "Player",
        text,
        server: String(b.server || "Global").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 16) || "Global"
      };
      list.push(msg);
      if (list.length > 50) list.shift();
      await env.CHAT_KV.put("messages", JSON.stringify(list));
      return j({ ok: true, message: msg });
    }
    return j({ ok: false, error: "Not found" }, 404);
  }
};
