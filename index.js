const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp({
  databaseURL: "https://propuski-791e4-default-rtdb.europe-west1.firebasedatabase.app/",
});

const BOT_TOKEN = defineSecret("BOT_TOKEN");
const norm = (s) => String(s || "").trim().toLowerCase().replace(/^@+/, "");

// Проверка подписи данных Telegram Login Widget
function verify(data, token) {
  const { hash, ...rest } = data || {};
  if (!hash) return false;
  const check = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("\n");
  const secret = crypto.createHash("sha256").update(token).digest();
  const calc = crypto.createHmac("sha256", secret).update(check).digest("hex");
  const a = Buffer.from(calc, "hex");
  const b = Buffer.from(String(hash), "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  // подпись не должна быть старше суток
  return Date.now() / 1000 - Number(rest.auth_date) < 86400;
}

exports.tgLogin = onRequest(
  { region: "europe-west1", secrets: [BOT_TOKEN], cors: true },
  async (req, res) => {
    if (req.method !== "POST") return res.status(405).json({ error: "method" });
    const data = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!verify(data, BOT_TOKEN.value())) {
      return res.status(401).json({ error: "Подпись Telegram не прошла проверку." });
    }

    const db = admin.database();
    const [studentsSnap, cfgSnap] = await Promise.all([
      db.ref("journal/students").get(),
      db.ref("journal/cfg").get(),
    ]);
    const students = studentsSnap.val() || [];
    const cfg = cfgSnap.val() || {};
    const tgIds = cfg.tgId || {}; // { telegramId: "Фамилия Имя" }
    const tgNames = cfg.tg || {}; // { "Фамилия Имя": "username" }
    const id = String(data.id);

    // 1) уже привязанный Telegram ID
    let name = tgIds[id];

    // 2) первый вход: сопоставление по @username, затем привязка ID
    if (!name && data.username) {
      const u = norm(data.username);
      name = students.find((s) => norm(tgNames[s]) === u);
      if (name) await db.ref("journal/cfg/tgId/" + id).set(name);
    }

    if (!name || !students.includes(name)) {
      return res.status(403).json({
        error: "Этот Telegram не привязан ни к одному студенту. Попросите старосту вписать ваш @юзернейм.",
      });
    }
    res.json({ name });
  }
);
