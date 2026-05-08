var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var HA_URL = env.HA_URL;
var WEBHOOK_ID = env.WEBHOOK_ID;
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" }
  });
}
__name(json, "json");
var ResultWaiter = class {
  static {
    __name(this, "ResultWaiter");
  }
  constructor(state) {
    this.state = state;
    this.resolve = null;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/wait") {
      const result = await new Promise((resolve) => {
        this.resolve = resolve;
        setTimeout(() => resolve({ status: "timeout" }), 12e3);
      });
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json"
         },
      });
    }
    if (request.method === "POST" && url.pathname === "/resolve") {
      const body = await request.json();
      if (this.resolve) {
        this.resolve({ status: body.status });
        this.resolve = null;
      }
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  }
};
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    if (request.method === "POST" && url.pathname === "/trigger") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "bad_request" }, 400);
      }
      if (!body.pin || body.lat === void 0 || body.lon === void 0) {
        return json({ error: "missing_fields" }, 400);
      }
      const requestId = crypto.randomUUID();
      const callbackUrl = `${url.origin}/callback`;
      await fetch(`${HA_URL}/api/webhook/${WEBHOOK_ID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json",
                    "CF-Access-Client-Id":     env.CF_CLIENT_ID,
                    "CF-Access-Client-Secret": env.CF_CLIENT_SECRET,
        },
        body: JSON.stringify({
          pin: String(body.pin),
          lat: body.lat,
          lon: body.lon,
          request_id: requestId,
          callback_url: callbackUrl,
          secret: env.CALLBACK_SECRET
        })
      });
      return json({ requestId });
    }
    if (request.method === "GET" && url.pathname.startsWith("/result/")) {
      const requestId = url.pathname.split("/result/")[1];
      if (!requestId) return json({ error: "missing_id" }, 400);
      const id = env.RESULT_WAITER.idFromName(requestId);
      const stub = env.RESULT_WAITER.get(id);
      const result = await stub.fetch("https://do/wait");
      const data = await result.json();
      return json(data);
    }
    if (request.method === "POST" && url.pathname === "/callback") {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response("bad_request", { status: 400 });
      }
      if (!body.secret || body.secret !== env.CALLBACK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      const id = env.RESULT_WAITER.idFromName(body.request_id);
      const stub = env.RESULT_WAITER.get(id);
      await stub.fetch("https://do/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: body.status })
      });
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  }
};
export {
  ResultWaiter,
  worker_default as default
};
//# sourceMappingURL=worker.js.map
