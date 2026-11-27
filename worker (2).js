// Cloudflare Worker: проверка входа через Telegram для «Журнала пропусков».
// Секрет BOT_TOKEN задаётся в настройках Worker (Settings → Variables and Secrets).
// Необязательная переменная GROUP_CODE — код группы для первой привязки (по умолчанию 4501).

const DB = "https://propuski-791e4-default-rtdb.europe-west1.firebasedatabase.app/journal";

// Стартовая привязка администратора по @юзернейму (дальше привязка идёт по Telegram ID)
const SEED = { "imgrut234": "Сарычев Арсений" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const norm = (s) => String(s || "").trim().toLowerCase().replace(/^@+/, "");
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function verify(data, token) {
  const { hash, ...rest } = data || {};
  if (!hash) return false;
  const check = Object.keys(rest).sort().map((k) => `${k}=${rest[k]}`).join("\n");
  const enc = new TextEncoder();
  const secret = await crypto.subtle.digest("SHA-256", enc.encode(token));
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const calc = hex(await crypto.subtle.sign("HMAC", key, enc.encode(check)));
  if (calc !== String(hash).toLowerCase()) return false;
  return Date.now() / 1000 - Number(rest.auth_date) < 86400; // не старше суток
}

const bind = (id, name) =>
  fetch(DB + "/cfg/tgId/" + encodeURIComponent(id) + ".json", {
    method: "PUT",
    body: JSON.stringify(name),
  });

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "POST") return json({ error: "Метод не поддерживается." }, 405);
    if (!env.BOT_TOKEN) return json({ error: "На сервере не задан BOT_TOKEN." }, 500);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "Неверный запрос." }, 400); }
    const data = body.tg || body;
    const claim = body.claim || null;

    if (!(await verify(data, env.BOT_TOKEN))) {
      return json({ error: "Подпись Telegram не прошла проверку. Нажмите кнопку входа ещё раз." }, 401);
    }

    const [students, cfg] = await Promise.all([
      fetch(DB + "/students.json").then((r) => r.json()),
      fetch(DB + "/cfg.json").then((r) => r.json()),
    ]);
    const list = students || [];
    const tgIds = (cfg && cfg.tgId) || {};   // { telegramId: "Фамилия Имя" }
    const tgNames = (cfg && cfg.tg) || {};   // { "Фамилия Имя": "username" }
    const id = String(data.id);

    // 1) уже привязанный Telegram ID
    let name = tgIds[id];
    if (name && list.includes(name)) return json({ name });

    // 2) совпадение по @username или стартовая привязка администратора
    if (data.username) {
      const u = norm(data.username);
      name = list.find((s) => norm(tgNames[s]) === u) || (SEED[u] && list.includes(SEED[u]) ? SEED[u] : undefined);
      if (name) {
        await bind(id, name);
        return json({ name });
      }
    }

    // 3) первая привязка без @username: выбрать своё имя + код группы
    const taken = new Set(Object.values(tgIds));
    if (claim) {
      const code = String(env.GROUP_CODE || "4501");
      if (String(claim.code) !== code) return json({ error: "Неверный код группы." }, 403);
      if (!list.includes(claim.name)) return json({ error: "Такого имени нет в списке." }, 400);
      if (taken.has(claim.name)) {
        return json({ error: "Это имя уже привязано к другому Telegram. Обратитесь к старосте." }, 403);
      }
      await bind(id, claim.name);
      return json({ name: claim.name });
    }

    return json({
      needClaim: true,
      free: list.filter((s) => !taken.has(s)),
    }, 403);
  },
};
