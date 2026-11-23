// Cloudflare Worker: проверка входа через Telegram для «Журнала пропусков».
// Секрет BOT_TOKEN задаётся в настройках Worker (Settings → Variables and Secrets).
// Для входа «Продолжить с Telegram» (OIDC) задайте ещё CLIENT_ID и CLIENT_SECRET (из BotFather → Login Widget).
// Необязательная переменная GROUP_CODE — код группы для первой привязки (по умолчанию 4501).

const ROOT = "https://propuski-791e4-default-rtdb.europe-west1.firebasedatabase.app";
// Группа 4501 хранится в /journal, остальные — в /journal_<номер>
const dbOf = (g) => ROOT + (g === "4501" ? "/journal" : "/journal_" + g);
const GROUP_RE = /^[0-9A-Za-zА-Яа-я_-]{2,12}$/;

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

const bind = (DB, id, name) =>
  fetch(DB + "/cfg/tgId/" + encodeURIComponent(id) + ".json", {
    method: "PUT",
    body: JSON.stringify(name),
  });

// ───── Вход через Telegram OIDC (oauth.telegram.org) ─────
const OIDC = "https://oauth.telegram.org";
const enc = new TextEncoder();
const toB64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(s + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0)); };
const textB64u = (s) => new TextDecoder().decode(fromB64u(s));

async function oidcIdentity(o, env) {
  if (!env.CLIENT_ID || !env.CLIENT_SECRET) return { error: "На сервере не заданы CLIENT_ID и CLIENT_SECRET." };
  if (!o || !o.code || !o.verifier || !o.redirect_uri) return { error: "Неверный запрос входа." };
  const r = await fetch(OIDC + "/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(env.CLIENT_ID + ":" + env.CLIENT_SECRET) },
    body: new URLSearchParams({ grant_type: "authorization_code", code: String(o.code), redirect_uri: String(o.redirect_uri), client_id: String(env.CLIENT_ID), code_verifier: String(o.verifier) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id_token) return { error: "Telegram не подтвердил вход. Нажмите кнопку ещё раз." };
  const [h, p, sig] = String(j.id_token).split(".");
  if (!h || !p || !sig) return { error: "Неверный ответ Telegram." };
  const head = JSON.parse(textB64u(h));
  if (head.alg !== "RS256") return { error: "Выберите алгоритм RS256 в BotFather (Login Widget → Advanced)." };
  const jwks = await fetch(OIDC + "/.well-known/jwks.json").then((x) => x.json());
  const jwk = (jwks.keys || []).find((k) => k.kid === head.kid);
  if (!jwk) return { error: "Не найден ключ подписи Telegram." };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64u(sig), enc.encode(h + "." + p)))) return { error: "Подпись Telegram не прошла проверку." };
  const c = JSON.parse(textB64u(p));
  const aud = [].concat(c.aud || []).map(String);
  if (c.iss !== OIDC || !aud.includes(String(env.CLIENT_ID)) || !(c.exp * 1000 > Date.now())) return { error: "Токен Telegram недействителен." };
  const id = c.id || c.sub;
  if (!id) return { error: "Telegram не передал ID пользователя." };
  return { id: String(id), username: c.preferred_username || "" };
}

// Короткий подписанный «билет», чтобы после первого входа привязка имени не требовала повторного кода Telegram
const tkKey = (env) => crypto.subtle.importKey("raw", enc.encode(env.TICKET_KEY || env.CLIENT_SECRET || env.BOT_TOKEN || ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
async function mkTicket(u, env) {
  const p = toB64u(enc.encode(JSON.stringify({ id: u.id, u: u.username, exp: Date.now() + 600000 })));
  return p + "." + toB64u(await crypto.subtle.sign("HMAC", await tkKey(env), enc.encode(p)));
}
async function readTicket(t, env) {
  try {
    const [p, s] = String(t).split(".");
    if (!p || !s || !(await crypto.subtle.verify("HMAC", await tkKey(env), fromB64u(s), enc.encode(p)))) return null;
    const d = JSON.parse(textB64u(p));
    return d.exp > Date.now() ? { id: d.id, username: d.u } : null;
  } catch (e) { return null; }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "POST") return json({ error: "Метод не поддерживается." }, 405);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "Неверный запрос." }, 400); }
    const raw = body.tg || body;
    const claim = body.claim || null;
    let data, ticket = null;

    if (raw.oidc) {            // «Продолжить с Telegram» (OIDC)
      const u = await oidcIdentity(raw.oidc, env).catch(() => ({ error: "Ошибка проверки входа Telegram." }));
      if (u.error) return json({ error: u.error }, 401);
      data = { id: u.id, username: u.username };
      ticket = await mkTicket(u, env);
    } else if (raw.ticket) {   // повтор после выбора имени
      const u = await readTicket(raw.ticket, env);
      if (!u) return json({ error: "Сессия входа истекла. Нажмите кнопку Telegram ещё раз." }, 401);
      data = { id: u.id, username: u.username };
    } else {                   // прежний вход (Login Widget / бот)
      if (!env.BOT_TOKEN) return json({ error: "На сервере не задан BOT_TOKEN." }, 500);
      if (!(await verify(raw, env.BOT_TOKEN))) {
        return json({ error: "Подпись Telegram не прошла проверку. Нажмите кнопку входа ещё раз." }, 401);
      }
      data = raw;
    }
    const ok = (name) => json({ name, username: data.username || "" });

    const group = String(body.group || "4501");
    if (!GROUP_RE.test(group)) return json({ error: "Неверная группа." }, 400);
    const DB = dbOf(group);
    const reg = await fetch(ROOT + "/registry/" + encodeURIComponent(group) + ".json").then((r) => r.json()).catch(() => null);
    if (reg && reg.deleted) return json({ error: "Такой группы нет." }, 404);
    // код группы: из реестра; для 4501 по умолчанию — прежний
    const groupCode = String((reg && reg.code) || (group === "4501" ? env.GROUP_CODE || "4501" : (group === "4502" || group === "4503" ? group : "")));

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
    if (name && list.includes(name)) return ok(name);

    // 2) совпадение по @username или стартовая привязка администратора
    if (data.username) {
      const u = norm(data.username);
      name = list.find((s) => norm(tgNames[s]) === u) || (SEED[u] && list.includes(SEED[u]) ? SEED[u] : undefined);
      if (name) {
        await bind(DB, id, name);
        return ok(name);
      }
      // главный администратор входит в любую группу, даже если его нет в её списке
      if (SEED[u]) return ok(SEED[u]);
    }

    // 3) первая привязка без @username: выбрать своё имя + код группы
    const taken = new Set(Object.values(tgIds));
    if (claim) {
      const code = groupCode;
      if (!code) return json({ error: "Для этой группы не задан код. Обратитесь к главному администратору." }, 403);
      if (String(claim.code) !== code) return json({ error: "Неверный код группы." }, 403);
      if (!list.includes(claim.name)) return json({ error: "Такого имени нет в списке." }, 400);
      if (taken.has(claim.name)) {
        return json({ error: "Это имя уже привязано к другому Telegram. Обратитесь к старосте." }, 403);
      }
      await bind(DB, id, claim.name);
      return ok(claim.name);
    }

    return json({
      needClaim: true,
      ticket,
      username: data.username || "",
      free: list.filter((s) => !taken.has(s)),
    }, 403);
  },
};
