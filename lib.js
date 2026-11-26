// Лекции: список папки Google Диска + «Доступно офлайн» (хранится в браузере, работает на iPhone и Android).
(function () {
  "use strict";
  var ROOT = "1uhkJoeVkKWGur3FtXbzJRynd_Itu3DJM";
  var KEY = window.LIB_KEY || "AIzaSyDSyjlz_qU38FX06noiXbJ2a2WNtH6TPg8"; // ← сюда вставь API-ключ Google (Drive API), см. инструкцию
  var DRIVE_URL = "https://drive.google.com/drive/folders/" + ROOT;
  var API = "https://www.googleapis.com/drive/v3/files";
  var CHUNK = 8 * 1024 * 1024;
  var GAPPS = {
    "application/vnd.google-apps.document": ["application/pdf", ".pdf"],
    "application/vnd.google-apps.presentation": ["application/pdf", ".pdf"],
    "application/vnd.google-apps.spreadsheet": ["application/pdf", ".pdf"],
    "application/vnd.google-apps.drawing": ["application/pdf", ".pdf"]
  };
  var FOLDER = "application/vnd.google-apps.folder";

  /* ───────── IndexedDB ───────── */
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (ok, no) {
      var r = indexedDB.open("lib1", 1);
      r.onupgradeneeded = function () {
        var d = r.result;
        d.createObjectStore("meta", { keyPath: "id" });
        d.createObjectStore("chunks");
        d.createObjectStore("lists", { keyPath: "id" });
      };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { no(r.error); };
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (ok, no) {
        var t = d.transaction(store, mode), res;
        var out = fn(t.objectStore(store));
        if (out && "onsuccess" in out) out.onsuccess = function () { res = out.result; };
        t.oncomplete = function () { ok(res); };
        t.onerror = t.onabort = function () { no(t.error || new Error("idb")); };
      });
    });
  }
  var idbGet = function (s, k) { return tx(s, "readonly", function (o) { return o.get(k); }); };
  var idbAll = function (s) { return tx(s, "readonly", function (o) { return o.getAll(); }); };
  var idbPut = function (s, v, k) { return tx(s, "readwrite", function (o) { return k === undefined ? o.put(v) : o.put(v, k); }); };
  var idbDel = function (s, k) { return tx(s, "readwrite", function (o) { return o.delete(k); }); };
  function chunkRange(id) { return IDBKeyRange.bound(id + ":", id + ":￿"); }
  function delChunks(id) { return tx("chunks", "readwrite", function (o) { return o.delete(chunkRange(id)); }); }
  function getChunks(id) { return tx("chunks", "readonly", function (o) { return o.getAll(chunkRange(id)); }); }

  /* ───────── состояние ───────── */
  var S = { tab: navigator.onLine ? "drive" : "off", stack: [{ id: ROOT, name: "Лекции" }], items: [], loading: false, err: "", cached: false, have: {}, prog: {}, batch: null, ready: null, info: "", offDir: [] };
  var aborts = {};
  var el = {};

  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  function fmt(n) {
    n = +n || 0;
    if (n < 1024) return n + " Б";
    if (n < 1048576) return Math.round(n / 1024) + " КБ";
    if (n < 1073741824) return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + " МБ";
    return (n / 1073741824).toFixed(2) + " ГБ";
  }
  function icon(m) {
    if (m === FOLDER) return "📁";
    if (/pdf/.test(m)) return "📕";
    if (/word|document/.test(m)) return "📄";
    if (/presentation|powerpoint/.test(m)) return "📊";
    if (/sheet|excel/.test(m)) return "📗";
    if (/^image/.test(m)) return "🖼️";
    if (/^video/.test(m)) return "🎞️";
    if (/^audio/.test(m)) return "🎧";
    return "📎";
  }
  function dt(s) { try { return new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return ""; } }

  /* ───────── Drive API ───────── */
  function api(url) {
    var ac = ("AbortController" in window) ? new AbortController() : null;
    var timer = ac ? setTimeout(function () { ac.abort(); }, 8000) : null;
    return fetch(url, ac ? { signal: ac.signal } : undefined).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) return r.text().then(function (t) { var e = new Error("HTTP " + r.status); e.status = r.status; e.body = t; throw e; });
      return r;
    }, function (e) { if (timer) clearTimeout(timer); throw e; });
  }
  function why(e) {
    try { var m = JSON.parse(e.body).error.message; return m ? ": " + String(m).slice(0, 200) : ""; } catch (x) { return ""; }
  }
  function listFolder(id) {
    var out = [];
    function page(tok) {
      var q = encodeURIComponent("'" + id + "' in parents and trashed=false");
      var u = API + "?q=" + q + "&pageSize=1000&orderBy=" + encodeURIComponent("folder,name") +
        "&fields=" + encodeURIComponent("nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)") +
        "&supportsAllDrives=true&includeItemsFromAllDrives=true&key=" + encodeURIComponent(KEY) + (tok ? "&pageToken=" + tok : "");
      return api(u).then(function (r) { return r.json(); }).then(function (j) {
        out = out.concat(j.files || []);
        return j.nextPageToken ? page(j.nextPageToken) : out;
      });
    }
    return page("");
  }
  function sortItems(a) {
    return a.slice().sort(function (x, y) {
      var fx = x.mimeType === FOLDER ? 0 : 1, fy = y.mimeType === FOLDER ? 0 : 1;
      return fx - fy || String(x.name).localeCompare(String(y.name), "ru", { numeric: true });
    });
  }
  function load() {
    var cur = S.stack[S.stack.length - 1];
    S.loading = true; S.err = ""; S.cached = false; render();
    var done = function (items, cached) { S.items = sortItems(items); S.loading = false; S.cached = !!cached; render(); };
    if (!KEY) { S.loading = false; S.err = "nokey"; render(); return; }
    listFolder(cur.id).then(function (items) {
      idbPut("lists", { id: cur.id, items: items, t: Date.now() }).catch(function () {});
      done(items, false);
    }).catch(function (e) {
      idbGet("lists", cur.id).then(function (c) {
        if (c) done(c.items, true);
        else { S.items = []; S.loading = false; S.err = navigator.onLine ? "Не удалось загрузить список (" + (e.status || "сеть") + ")" + why(e) : "Нет интернета, а эта папка ещё не открывалась онлайн"; render(); }
      }).catch(function () { S.loading = false; S.err = "Не удалось загрузить список"; render(); });
    });
  }
  function refreshHave() {
    return idbAll("meta").then(function (a) {
      S.have = {}; a.forEach(function (m) { S.have[m.id] = m; });
    }).catch(function () {});
  }

  /* «Скачано»: файлы, сохранённые раньше (без пути), раскладываем по папкам как на Диске */
  var folderCache = {}, fixTried = {}, fixing = false;
  function getMeta(id) {
    if (folderCache[id]) return Promise.resolve(folderCache[id]);
    return fetch(API + "/" + id + "?fields=id,name,parents&supportsAllDrives=true&key=" + encodeURIComponent(KEY)).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) { return (folderCache[id] = j); });
  }
  function resolvePath(fileId) {
    var chain = [];
    function up(id, n) {
      return getMeta(id).then(function (m) {
        var p = m.parents && m.parents[0];
        if (!p || n > 12) return null;
        if (p === ROOT) return chain;
        return getMeta(p).then(function (pm) { chain.unshift({ id: pm.id, name: pm.name }); return up(p, n + 1); });
      });
    }
    return up(fileId, 0);
  }
  function fixPaths() {
    if (fixing || !KEY || !navigator.onLine) return;
    var todo = Object.keys(S.have).filter(function (k) { return !Array.isArray(S.have[k].path) && !fixTried[k]; });
    if (!todo.length) return;
    fixing = true;
    todo.reduce(function (p, k) {
      return p.then(function () {
        fixTried[k] = 1;
        return resolvePath(k).then(function (ch) {
          var m = S.have[k];
          if (!ch || !m) return;
          m.path = [{ id: ROOT, name: S.stack[0].name }].concat(ch);
          return idbPut("meta", m);
        }).catch(function () {});
      });
    }, Promise.resolve()).then(function () { fixing = false; render(); });
  }

  /* ───────── скачивание ───────── */
  function dlUrl(f) {
    var g = GAPPS[f.mimeType];
    return g ? API + "/" + f.id + "/export?mimeType=" + encodeURIComponent(g[0]) + "&key=" + encodeURIComponent(KEY)
      : API + "/" + f.id + "?alt=media&supportsAllDrives=true&key=" + encodeURIComponent(KEY);
  }
  function paintProg(id) {
    paintDiary();
    var p = S.prog[id], n = el.root && el.root.querySelectorAll('[data-p="' + id + '"]');
    if (!n) return;
    for (var i = 0; i < n.length; i++) {
      var pc = p && p.total ? Math.min(100, Math.round(p.got / p.total * 100)) : null;
      n[i].textContent = p ? (pc === null ? fmt(p.got) : pc + "% · " + fmt(p.got)) : "";
    }
    var b = el.root.querySelectorAll('[data-pb="' + id + '"]');
    for (var j = 0; j < b.length; j++) b[j].style.transform = "scaleX(" + (p && p.total ? Math.min(1, p.got / p.total) : 0) + ")";
  }
  // путь папок от корня: [{id,name}, …]; хранится вместе с файлом, чтобы «Скачано» выглядело как «Папки»
  function curPath() { return S.stack.map(function (c) { return { id: c.id, name: c.name }; }); }
  function download(f, path) {
    if (S.prog[f.id] || S.have[f.id]) return Promise.resolve();
    path = path || f._path || curPath();
    var g = GAPPS[f.mimeType];
    var ac = ("AbortController" in window) ? new AbortController() : null;
    aborts[f.id] = ac;
    S.prog[f.id] = { got: 0, total: +f.size || 0 };
    render();
    var idx = 0, parts = [], size = 0, got = 0;
    var flush = function () {
      if (!size) return Promise.resolve();
      var b = new Blob(parts), i = idx++;
      parts = []; size = 0;
      return idbPut("chunks", b, f.id + ":" + String(i).padStart(5, "0"));
    };
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    return fetch(dlUrl(f), ac ? { signal: ac.signal } : undefined).then(function (r) {
      if (!r.ok) { var e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
      if (!r.body || !r.body.getReader) return r.blob().then(function (b) { parts.push(b); size = b.size; got = b.size; return flush(); });
      var rd = r.body.getReader();
      var pump = function () {
        return rd.read().then(function (x) {
          if (x.done) return flush();
          parts.push(x.value); size += x.value.length; got += x.value.length;
          S.prog[f.id].got = got; paintProg(f.id);
          return (size >= CHUNK ? flush() : Promise.resolve()).then(pump);
        });
      };
      return pump();
    }).then(function () {
      if (+f.size && !g && got !== +f.size) throw new Error("size");
      var m = { id: f.id, name: f.name + (g && !/\.pdf$/i.test(f.name) ? g[1] : ""), size: got, mime: g ? g[0] : (f.mimeType || "application/octet-stream"), chunks: idx, t: Date.now(), link: f.webViewLink || "", path: path };
      return idbPut("meta", m).then(function () { S.have[f.id] = m; });
    }).catch(function (e) {
      return delChunks(f.id).catch(function () {}).then(function () {
        if (e && e.name === "AbortError") return;
        var q = e && (e.name === "QuotaExceededError" || /quota/i.test(e.message || ""));
        S.err = q ? "Не хватает памяти на устройстве" : "Не удалось скачать «" + f.name + "»" + (e && e.status ? " (" + e.status + ")" : "");
      });
    }).then(function () { delete S.prog[f.id]; delete aborts[f.id]; render(); });
  }
  function remove(id) {
    return Promise.all([idbDel("meta", id), delChunks(id)]).then(function () { delete S.have[id]; render(); });
  }
  function cancel(id) { if (aborts[id]) aborts[id].abort(); }

  function walk(id, out, seen, path) {
    seen = seen || {};
    if (seen[id]) return Promise.resolve();
    seen[id] = 1;
    return listFolder(id).then(function (items) {
      var fs = items.filter(function (i) { return i.mimeType !== FOLDER; });
      fs.forEach(function (f) { f._path = path; });
      out.push.apply(out, fs);
      return items.filter(function (i) { return i.mimeType === FOLDER; }).reduce(function (p, d) { return p.then(function () { return walk(d.id, out, seen, path.concat([{ id: d.id, name: d.name }])); }); }, Promise.resolve());
    });
  }
  function downloadFolder(id, name) {
    if (S.batch) return;
    build();
    S.batch = { text: "Считаю файлы…", stop: false }; S.err = ""; render();
    var all = [], top = S.stack[S.stack.length - 1];
    var base = id === ROOT ? [{ id: ROOT, name: S.stack[0].name }] : top.id === id ? curPath() : curPath().concat([{ id: id, name: name }]);
    walk(id, all, null, base).then(function () {
      var need = all.filter(function (f) { return !S.have[f.id]; });
      var total = need.reduce(function (a, f) { return a + (+f.size || 0); }, 0);
      if (!need.length) { S.batch = null; S.err = ""; render(); return; }
      if (!confirm("Скачать для офлайна: " + need.length + " файл(ов), ≈ " + fmt(total) + "?")) { S.batch = null; render(); return; }
      var i = 0;
      S.batch.total = total; S.batch.base = 0; S.batch.n = need.length;
      var next = function () {
        if (S.batch.stop || i >= need.length) { S.batch = null; render(); return; }
        S.batch.text = "Скачиваю " + (i + 1) + " из " + need.length; render();
        var f = need[i++];
        return download(f, f._path).then(function () { if (S.batch) S.batch.base += +f.size || 0; return next(); });
      };
      return next();
    }).catch(function (e) { S.batch = null; S.err = "Не удалось получить список файлов папки" + (e && e.status ? " (" + e.status + ")" + why(e) : ""); render(); });
  }


  /* ───────── карточка в дневнике: «все лекции офлайн» без захода на Диск ───────── */
  function diaryCard() {
    var old = document.getElementById("lbDiary"); if (old) old.remove();
    return null; // карточка «Лекции без интернета» в дневнике убрана; лекции — через раздел «Лекции»
  }
  function diaryCardOld() {
    if (el.dv && document.contains(el.dv)) return el.dv;
    var sv = document.getElementById("schedView"), anchor = sv && (sv.querySelector("#status-bar") || sv.querySelector("#schedule"));
    if (!sv || !anchor) return null;
    var c = document.createElement("div");
    c.id = "lbDiary"; c.className = "lb-dv";
    c.innerHTML = '<div class="lb-dv-l"><b>Лекции без интернета</b><span class="lb-dv-s" id="lbDvS"></span><span class="lb-dv-b"><i id="lbDvB"></i></span></div>' +
      '<button type="button" class="lb-dv-btn" id="lbDvBtn"></button><button type="button" class="lb-dv-more" id="lbDvMore" aria-label="Открыть лекции">📚</button>';
    anchor.parentNode.insertBefore(c, anchor);
    c.querySelector("#lbDvBtn").addEventListener("click", function () {
      if (S.batch) { S.batch.stop = true; Object.keys(aborts).forEach(cancel); return; }
      var r = S.stack[0];
      downloadFolder(ROOT, r.name);
    });
    c.querySelector("#lbDvMore").addEventListener("click", function () { window.openLib(); });
    el.dv = c;
    return c;
  }
  function offText() {
    var ids = Object.keys(S.have), tot = ids.reduce(function (a, k) { return a + (S.have[k].size || 0); }, 0), t;
    if (S.batch) {
      var live = Object.keys(S.prog).reduce(function (a, k) { return a + S.prog[k].got; }, 0);
      return S.batch.total ? "Скачиваю " + Math.round(Math.min(1, ((S.batch.base || 0) + live) / S.batch.total) * 100) + "%" : "Считаю файлы…";
    }
    if (S.err) return "Лекции офлайн · ошибка";
    return ids.length ? "Лекции офлайн ✓ " + ids.length + " · " + fmt(tot) : "Лекции офлайн";
  }
  window.libOffText = function () { return offText(); };
  function paintTile(ids, tot) {
    var l = document.getElementById("libOffLbl");
    if (!l) return;
    var t;
    if (S.batch) {
      var live = Object.keys(S.prog).reduce(function (a, k) { return a + S.prog[k].got; }, 0);
      t = S.batch.total ? "Скачиваю " + Math.round(Math.min(1, ((S.batch.base || 0) + live) / S.batch.total) * 100) + "%" : "Считаю файлы…";
    } else if (S.err) t = "Ошибка, повторить";
    else t = ids.length ? "Офлайн ✓ " + ids.length + " · " + fmt(tot) : "Лекции офлайн";
    if (l.textContent !== t) l.textContent = t;
  }
  window.libOfflineAll = function () {
    if (!KEY || !window.indexedDB) { alert("Лекции офлайн: нет ключа Google в lib.js или браузер не поддерживает хранилище."); return; }
    if (S.batch) { if (confirm("Остановить скачивание лекций?")) { S.batch.stop = true; Object.keys(aborts).forEach(cancel); } return; }
    refreshHave().then(function () { downloadFolder(ROOT, "Лекции"); });
  };
  function paintDiary() {
    var ids0 = Object.keys(S.have);
    paintTile(ids0, ids0.reduce(function (a, k) { return a + (S.have[k].size || 0); }, 0));
    var c = diaryCard();
    if (!c) return;
    var st = c.querySelector("#lbDvS"), bar = c.querySelector("#lbDvB"), btn = c.querySelector("#lbDvBtn");
    var ids = Object.keys(S.have), tot = ids.reduce(function (a, k) { return a + (S.have[k].size || 0); }, 0);
    var pct = 0, text;
    if (S.batch) {
      var live = Object.keys(S.prog).reduce(function (a, k) { return a + S.prog[k].got; }, 0);
      pct = S.batch.total ? Math.min(1, ((S.batch.base || 0) + live) / S.batch.total) : 0;
      text = S.batch.text + (S.batch.total ? " · " + Math.round(pct * 100) + "% · " + fmt((S.batch.base || 0) + live) + " из " + fmt(S.batch.total) : "");
      btn.textContent = "Стоп";
    } else {
      text = S.err ? S.err : ids.length ? "Сохранено: " + ids.length + " файл(ов) · " + fmt(tot) : "Пока ничего не скачано";
      btn.textContent = ids.length ? "⤓ Обновить" : "⤓ Скачать все";
      pct = 0;
    }
    st.textContent = text;
    c.classList.toggle("is-err", !!S.err && !S.batch);
    bar.style.transform = "scaleX(" + pct + ")";
    c.classList.toggle("is-run", !!S.batch);
  }
  /* ───────── открыть файл ───────── */
  var OFFICE = { pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ppt: "application/vnd.ms-powerpoint", pps: "application/vnd.ms-powerpoint", ppsx: "application/vnd.openxmlformats-officedocument.presentationml.slideshow", odp: "application/vnd.oasis.opendocument.presentation", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel" };
  function extOf(n) { var m = /\.([a-z0-9]+)$/i.exec(n || ""); return m ? m[1].toLowerCase() : ""; }
  /* Файлы не сохраняются в «Загрузки» телефона: всё открывается внутри приложения.
     Что показать нельзя (старые .ppt/.doc/.xls) — открываем онлайн через Google Диск. */
  var dv = null, dvUrl = "", dvKill = null;
  function dvBuild() {
    if (dv) return dv;
    dv = document.createElement("div");
    dv.id = "libDoc"; dv.className = "ld-hide"; dv.setAttribute("role", "dialog");
    dv.innerHTML = '<div class="ld-top"><button type="button" class="ld-x" data-d="close" aria-label="Закрыть">✕</button><div class="ld-title"></div></div><div class="ld-stage"></div>';
    document.body.appendChild(dv);
    dv.addEventListener("click", function (e) {
      var t = e.target.closest("[data-d]"); if (!t) return;
      if (t.dataset.d === "close") dvClose();
      if (t.dataset.d === "drive") { var id = dv.dataset.id; openOnline(S.items.filter(function (i) { return i.id === id; })[0] || (S.have[id] && { id: id, webViewLink: S.have[id].link }) || { id: id }); }
    });
    return dv;
  }
  function dvStop() { if (dvKill) { try { dvKill(); } catch (e) {} dvKill = null; } }
  function dvClose() {
    if (!dv) return;
    dvStop();
    dv.classList.add("ld-hide");
    dv.querySelector(".ld-stage").innerHTML = "";
    if (dvUrl) { URL.revokeObjectURL(dvUrl); dvUrl = ""; }
  }
  function dvOpen(m, node, cls) {
    dvBuild();
    dvStop();
    if (dvUrl) { URL.revokeObjectURL(dvUrl); dvUrl = ""; }
    dv.dataset.id = m.id;
    dv.querySelector(".ld-title").textContent = m.name;
    var st = dv.querySelector(".ld-stage");
    st.className = "ld-stage" + (cls ? " " + cls : "");
    st.innerHTML = "";
    if (typeof node === "string") st.innerHTML = node; else st.appendChild(node);
    dv.classList.remove("ld-hide");
  }
  function dvMsg(m, text) {
    dvOpen(m, '<div class="ld-msg"><p>' + esc(text) + '</p><button type="button" class="ld-btn" data-d="drive">Открыть через Google Диск</button></div>', "ld-center");
  }
  // .docx → простой текст с абзацами, жирным и таблицами
  function docxHtml(blob) {
    return blob.arrayBuffer().then(function (buf) {
      var P = window.pptxView && window.pptxView._Pkg;
      if (!P) throw new Error("nopkg");
      var pkg = new P(buf);
      return pkg.xml("word/document.xml");
    }).then(function (root) {
      if (!root) throw new Error("docx");
      var W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
      function kids(n, name) { var o = []; for (var c = n.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) o.push(c); return o; }
      function para(p) {
        var h = "", ppr = kids(p, "pPr")[0], head = 0, list = false;
        if (ppr) {
          var ps = kids(ppr, "pStyle")[0], v = ps && (ps.getAttributeNS(W, "val") || "");
          var m = /^(?:Heading|Заголовок)\s*(\d)/i.exec(v) || /^Title$/i.exec(v) && [0, 1]; if (m) head = +m[1];
          list = !!kids(ppr, "numPr")[0];
        }
        (function walk(n) {
          for (var c = n.firstElementChild; c; c = c.nextElementSibling) {
            if (c.localName === "r") {
              var rp = kids(c, "rPr")[0], b = rp && kids(rp, "b")[0] && kids(rp, "b")[0].getAttributeNS(W, "val") !== "0", it = rp && kids(rp, "i")[0];
              var t = "";
              for (var x = c.firstElementChild; x; x = x.nextElementSibling) {
                if (x.localName === "t") t += x.textContent; else if (x.localName === "tab") t += "    "; else if (x.localName === "br") t += "\n";
              }
              if (t) { t = esc(t).replace(/\n/g, "<br>"); if (b) t = "<b>" + t + "</b>"; if (it) t = "<i>" + t + "</i>"; h += t; }
            } else if (c.localName === "hyperlink" || c.localName === "smartTag" || c.localName === "ins") walk(c);
          }
        })(p);
        if (!h) return "";
        return head ? "<h" + Math.min(4, head + 1) + ">" + h + "</h" + Math.min(4, head + 1) + ">" : "<p" + (list ? ' class="li"' : "") + ">" + (list ? "• " : "") + h + "</p>";
      }
      function block(n) {
        var o = "";
        for (var c = n.firstElementChild; c; c = c.nextElementSibling) {
          if (c.localName === "p") o += para(c);
          else if (c.localName === "tbl") {
            o += "<table>" + kids(c, "tr").map(function (tr) { return "<tr>" + kids(tr, "tc").map(function (tc) { return "<td>" + block(tc) + "</td>"; }).join("") + "</tr>"; }).join("") + "</table>";
          } else if (c.localName === "sdt") { var sc = kids(c, "sdtContent")[0]; if (sc) o += block(sc); }
        }
        return o;
      }
      var body = kids(root, "body")[0];
      var h = body ? block(body) : "";
      if (!h) throw new Error("empty");
      return h;
    });
  }
  function viewFile(id, m, blob, ext) {
    var mime = m.mime || "", url;
    if (/^(pptx|ppsx|pptm|ppsm)$/.test(ext) && window.pptxView) {
      return window.pptxView.open(blob, m.name, { more: function () { dvMsg(m, "Этот файл показывается только внутри приложения."); } }).then(function () {
        S.ready = null; S.info = ""; S.link = null; render();
      }, function (e) {
        try { console.warn("pptx view:", e); } catch (x) {}
        dvMsg(m, "Не удалось показать презентацию внутри приложения.");
      });
    }
    if (ext === "docx") {
      return docxHtml(blob).then(function (h) { dvOpen(m, '<article class="ld-doc">' + h + "</article>", "ld-scroll"); }, function () { dvMsg(m, "Не удалось показать документ внутри приложения."); });
    }
    if (/^image\//.test(mime) || /^(png|jpe?g|gif|webp|bmp|svg)$/.test(ext)) {
      url = dvUrl = URL.createObjectURL(new Blob([blob], { type: /^image\//.test(mime) ? mime : "image/" + (ext === "jpg" ? "jpeg" : ext) }));
      var im = new Image(); im.src = url; im.alt = m.name; dvOpen(m, im, "ld-center"); return;
    }
    if (/^(video|audio)\//.test(mime)) {
      url = dvUrl = URL.createObjectURL(blob);
      var el2 = document.createElement(/^video/.test(mime) ? "video" : "audio"); el2.controls = true; el2.src = url; el2.setAttribute("playsinline", ""); dvOpen(m, el2, "ld-center"); return;
    }
    if (mime === "application/pdf" || ext === "pdf") {
      // свой просмотрщик (pdf-view.js): все страницы, зум щипком, без перехода в другое приложение и без iframe
      var host = document.createElement("div"); host.className = "ld-pdfhost";
      dvOpen(m, host, "ld-pdf");
      var pdfBlob = new Blob([blob], { type: "application/pdf" }), cur = dv.dataset.id;
      return window.pdfView.attach(host, pdfBlob).then(function (h) {
        if (!h) return;
        if (dv.classList.contains("ld-hide") || dv.dataset.id !== cur) { h.destroy(); return; }
        dvKill = h.destroy;
      }, function (e) {
        try { console.warn("pdf view:", e); } catch (x) {}
        dvMsg(m, "Не удалось показать PDF внутри приложения.");
      });
    }
    if (/^text\//.test(mime) || /^(txt|md|csv|log)$/.test(ext)) {
      return blob.text().then(function (t) { dvOpen(m, '<pre class="ld-pre">' + esc(t) + "</pre>", "ld-scroll"); });
    }
    dvMsg(m, "Этот формат нельзя показать внутри приложения, а сохранять файл на телефон мы не будем.");
  }
  function openFile(id) {
    var m = S.have[id];
    if (!m) return Promise.resolve();
    var ext = extOf(m.name);
    return getChunks(id).then(function (parts) {
      var type = OFFICE[ext] || m.mime;
      return viewFile(id, m, new Blob(parts, { type: type }), ext);
    }).catch(function () { S.err = "Не удалось открыть файл"; render(); });
  }
  // нажали на файл: если скачан — открыть, если нет — скачать в память приложения и сразу открыть
  function tapFile(id, f) {
    S.info = ""; S.err = ""; S.link = null;
    if (S.have[id]) { S.ready = null; return openFile(id); }
    if (!f) return;
    if (KEY && navigator.onLine) {
      return download(f).then(function () { if (S.have[id]) return openFile(id); });
    }
    S.err = "Этот файл ещё не скачан, а интернета нет. Скачайте его заранее (значок ⤓).";
    render();
  }
  function openOnline(f) {
    var u = f.webViewLink || "https://drive.google.com/file/d/" + f.id + "/view";
    var tg = window.Telegram && window.Telegram.WebApp;
    if (tg && tg.initData && tg.openLink) { try { tg.openLink(u); return; } catch (e) {} }
    window.open(u, "_blank", "noopener");
  }

  /* ───────── интерфейс ───────── */
  function build() {
    if (el.root) return;
    var r = document.createElement("div");
    r.id = "libView"; r.setAttribute("role", "dialog"); r.setAttribute("aria-label", "Лекции"); r.className = "lb-hide";
    r.innerHTML = '<div class="lb-top"><button type="button" class="lb-x lb-back" data-a="back" id="lbBack" aria-label="Назад в предыдущую папку">‹</button><div class="lb-title" id="lbTitle">Лекции</div><button type="button" class="lb-x" data-a="close" aria-label="Закрыть">✕</button><span class="lb-net" id="lbNet"></span></div>' +
      '<div class="lb-tabs"><button type="button" data-a="tab" data-t="drive">Папки</button><button type="button" data-a="tab" data-t="off">Скачано</button></div>' +
      '<div class="lb-body" id="lbBody"></div>';
    document.body.appendChild(r);
    el.root = r; el.body = r.querySelector("#lbBody");
    r.addEventListener("click", onClick);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !r.classList.contains("lb-hide")) close(); });
    window.addEventListener("online", function () { if (!r.classList.contains("lb-hide")) { if (S.tab === "drive") load(); else render(); } });
    window.addEventListener("offline", function () { if (!r.classList.contains("lb-hide")) render(); });
  }
  function onClick(e) {
    var t = e.target.closest("[data-a]");
    if (!t) return;
    var a = t.dataset.a, id = t.dataset.id;
    var f = S.items.filter(function (i) { return i.id === id; })[0];
    if (a === "close") return close();
    if (a === "back") return goBack();
    if (a === "ready") { var rid = S.ready; return tapFile(rid); }
    if (a === "hideinfo") { S.info = ""; S.ready = null; S.link = null; render(); return; }
    if (a === "odir") { S.offDir.push({ id: id, name: t.dataset.name }); S.err = ""; S.info = ""; render(); return; }
    if (a === "ocrumb") { S.offDir = S.offDir.slice(0, +t.dataset.n); S.err = ""; S.info = ""; render(); return; }
    if (a === "odeldir") { if (confirm("Удалить папку «" + t.dataset.name + "» с устройства?")) removeDir(id); return; }
    if (a === "tab") { S.tab = t.dataset.t; S.err = ""; S.info = ""; if (S.tab === "drive") load(); else refreshHave().then(render); return; }
    if (a === "dir") { S.stack.push({ id: id, name: t.dataset.name }); S.err = ""; load(); return; }
    if (a === "crumb") { S.stack = S.stack.slice(0, +t.dataset.i + 1); S.err = ""; load(); return; }
    if (a === "get" && f) return download(f);
    if (a === "cancel") return cancel(id);
    if (a === "del") { if (confirm("Удалить с устройства?")) remove(id); return; }
    if (a === "open") { tapFile(id, f); return; }
    if (a === "drive1") return openOnline(f || { id: id });
    if (a === "dirget") return downloadFolder(id, t.dataset.name);
    if (a === "stop") { if (S.batch) { S.batch.stop = true; Object.keys(aborts).forEach(cancel); } return; }
    if (a === "retry") { S.err = ""; load(); return; }
    if (a === "drive") { window.open(DRIVE_URL, "_blank", "noopener"); return; }
  }
  function canUp() { return S.tab === "drive" ? S.stack.length > 1 : S.offDir.length > 0; }
  function upName() { return S.tab === "drive" ? S.stack[S.stack.length - 1].name : S.offDir[S.offDir.length - 1].name; }
  function up() {
    S.err = ""; S.info = "";
    if (S.tab === "drive") { S.stack.pop(); load(); } else { S.offDir.pop(); render(); }
  }
  function goBack() { if (canUp()) up(); else close(); }
  // «Скачано»: файлы лежат в тех же папках, что и на Диске (путь хранится в meta.path; у старых файлов его нет — они в корне)
  function offLevel() {
    var dir = S.offDir, files = [], dirs = {};
    Object.keys(S.have).forEach(function (k) {
      var m = S.have[k], rp = (m.path || []).slice(1), i;
      for (i = 0; i < dir.length; i++) if (!rp[i] || rp[i].id !== dir[i].id) return;
      if (rp.length === dir.length) files.push(m);
      else {
        var d = rp[dir.length], x = dirs[d.id] || (dirs[d.id] = { id: d.id, name: d.name, n: 0, size: 0 });
        x.n++; x.size += m.size || 0;
      }
    });
    var cmp = function (a, b) { return String(a.name).localeCompare(String(b.name), "ru", { numeric: true }); };
    return { files: files.sort(cmp), dirs: Object.keys(dirs).map(function (k) { return dirs[k]; }).sort(cmp) };
  }
  function removeDir(id) {
    var at = S.offDir.length, ids = Object.keys(S.have).filter(function (k) {
      var rp = (S.have[k].path || []).slice(1), i;
      for (i = 0; i < at; i++) if (!rp[i] || rp[i].id !== S.offDir[i].id) return false;
      return rp[at] && rp[at].id === id;
    });
    return Promise.all(ids.map(function (k) { return Promise.all([idbDel("meta", k), delChunks(k)]).then(function () { delete S.have[k]; }); })).then(render);
  }
  function storageLine() {
    if (!(navigator.storage && navigator.storage.estimate)) return;
    navigator.storage.estimate().then(function (e) {
      var n = el.root && el.root.querySelector("#lbSt");
      if (n && e && e.usage != null) n.textContent = "Занято на устройстве: " + fmt(e.usage) + (e.quota ? " из ~" + fmt(e.quota) : "") + " · lib v17";
    }).catch(function () {});
  }
  function row(f, off) {
    var dir = f.mimeType === FOLDER, h = S.have[f.id], p = S.prog[f.id];
    var meta = dir ? "Папка" : [fmt(f.size || (h && h.size)), f.modifiedTime ? dt(f.modifiedTime) : ""].filter(Boolean).join(" · ");
    var act = "";
    if (dir) act = '<button type="button" class="lb-ic" data-a="dirget" data-id="' + f.id + '" data-name="' + esc(f.name) + '" title="Скачать всю папку для офлайна" aria-label="Скачать папку">⤓</button>';
    else if (p) act = '<button type="button" class="lb-ic" data-a="cancel" data-id="' + f.id + '" aria-label="Отменить">✕</button>';
    else if (h) act = '<button type="button" class="lb-ic lb-ok" data-a="del" data-id="' + f.id + '" title="Доступно офлайн — удалить с устройства" aria-label="Удалить с устройства">✓</button>';
    else act = '<button type="button" class="lb-ic" data-a="get" data-id="' + f.id + '" title="Сохранить для офлайна" aria-label="Скачать">⤓</button>';
    var act1 = dir ? 'data-a="dir" data-id="' + f.id + '" data-name="' + esc(f.name) + '"' : 'data-a="open" data-id="' + f.id + '"';
    return '<div class="lb-row' + (h ? " is-off" : "") + '"><button type="button" class="lb-main" ' + act1 + '><span class="lb-i">' + icon(f.mimeType) + '</span><span class="lb-t"><b>' + esc(f.name) + '</b><i>' +
      (p ? '<span data-p="' + f.id + '"></span>' : esc(meta)) + (h && !dir ? ' · <u>офлайн</u>' : "") + '</i></span></button>' + act +
      (p ? '<span class="lb-bar"><i data-pb="' + f.id + '"></i></span>' : "") + "</div>";
  }
  function render() {
    paintDiary();
    if (!el.root) return;
    var net = el.root.querySelector("#lbNet"); net.textContent = navigator.onLine ? "" : "офлайн"; net.className = "lb-net" + (navigator.onLine ? "" : " on");
    el.root.querySelectorAll(".lb-tabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.t === S.tab); });
    var bk = el.root.querySelector("#lbBack"), tt = el.root.querySelector("#lbTitle");
    if (bk) bk.style.visibility = canUp() ? "visible" : "hidden";
    if (tt) tt.textContent = canUp() ? upName() : "Лекции";
    var h = "";
    if (S.ready && S.have[S.ready]) h += '<div class="lb-ready"><span>Файл скачан</span><button type="button" class="lb-btn lb-go" data-a="ready">Открыть в PowerPoint</button></div>';
    if (S.info) h += '<div class="lb-info"><span>' + esc(S.info) + '</span>' + (S.link ? '<button type="button" class="lb-btn" data-a="drive1" data-id="' + esc(S.link) + '">Google Диск</button>' : "") + '<button type="button" class="lb-btn" data-a="hideinfo">OK</button></div>';
    if (S.err === "nokey") {
      h = '<div class="lb-empty"><b>Нужен ключ Google Диска</b>Пока он не добавлен, список папки показать нельзя.<br><button type="button" class="lb-btn" data-a="drive">Открыть папку на Google Диске</button></div>';
      el.body.innerHTML = h; return;
    }
    if (S.tab === "off") {
      fixPaths();
      var lv = offLevel(), nAll = Object.keys(S.have).length, tot = Object.keys(S.have).reduce(function (a, k) { return a + (S.have[k].size || 0); }, 0);
      var oc = ['<button type="button" data-a="ocrumb" data-n="0">' + esc(S.stack[0].name) + "</button>"];
      S.offDir.forEach(function (c, i) { oc.push(i === S.offDir.length - 1 ? "<span>" + esc(c.name) + "</span>" : '<button type="button" data-a="ocrumb" data-n="' + (i + 1) + '">' + esc(c.name) + "</button>"); });
      if (S.offDir.length) h += '<div class="lb-crumbs">' + oc.join(" › ") + "</div>";
      h += '<div class="lb-sum">' + (nAll ? nAll + " файл(ов) · " + fmt(tot) : "Здесь появятся файлы, сохранённые для офлайна") + '</div>';
      if (lv.dirs.length || lv.files.length) {
        h += '<div class="lb-list">' + lv.dirs.map(function (d) {
          return '<div class="lb-row"><button type="button" class="lb-main" data-a="odir" data-id="' + esc(d.id) + '" data-name="' + esc(d.name) + '"><span class="lb-i">📁</span><span class="lb-t"><b>' + esc(d.name) + '</b><i>' + d.n + " файл(ов) · " + fmt(d.size) + '</i></span></button>' +
            '<button type="button" class="lb-ic" data-a="odeldir" data-id="' + esc(d.id) + '" data-name="' + esc(d.name) + '" title="Удалить папку с устройства" aria-label="Удалить папку с устройства">🗑</button></div>';
        }).join("") + lv.files.map(function (m) { return row({ id: m.id, name: m.name, mimeType: m.mime, size: m.size }, true); }).join("") + "</div>";
      }
    } else {
      var crumbs = S.stack.map(function (c, i) { return i === S.stack.length - 1 ? "<span>" + esc(c.name) + "</span>" : '<button type="button" data-a="crumb" data-i="' + i + '">' + esc(c.name) + "</button>"; }).join(" › ");
      h += '<div class="lb-crumbs">' + crumbs + "</div>";
      var cur = S.stack[S.stack.length - 1];
      var bt = S.batch ? '<div class="lb-batch"><span>' + esc(S.batch.text) + '</span><button type="button" class="lb-btn" data-a="stop">Стоп</button></div>' :
        '<div class="lb-tool"><button type="button" class="lb-btn" data-a="dirget" data-id="' + cur.id + '" data-name="' + esc(cur.name) + '">⤓ Скачать всё в этой папке</button></div>';
      h += bt;
      if (S.cached) h += '<div class="lb-note">Показан сохранённый список — нет связи с Диском</div>';
      if (S.loading) h += '<div class="lb-sum">Загрузка…</div>';
      else if (!S.items.length && !S.err) h += '<div class="lb-sum">Папка пуста</div>';
      h += '<div class="lb-list">' + S.items.map(function (f) { return row(f); }).join("") + "</div>";
    }
    if (S.err) h = '<div class="lb-err">' + esc(S.err) + (S.tab === "drive" ? ' <button type="button" class="lb-btn" data-a="retry">Повторить</button>' : "") + "</div>" + h;
    h += '<div class="lb-st" id="lbSt"></div>';
    el.body.innerHTML = h;
    Object.keys(S.prog).forEach(paintProg);
    storageLine();
  }
  function open() {
    build();
    el.root.classList.remove("lb-hide");
    document.documentElement.classList.add("lb-lock");
    // системная кнопка «назад» (Android) возвращает в прошлую папку, а не выкидывает из приложения
    try { if (!(history.state && history.state.lib)) history.pushState({ lib: 1 }, ""); } catch (e) {}
    refreshHave().then(function () { if (S.tab === "drive") load(); else render(); });
  }
  function close() {
    if (!el.root) return;
    el.root.classList.add("lb-hide");
    document.documentElement.classList.remove("lb-lock");
    try { if (history.state && history.state.lib) history.back(); } catch (e) {}
  }
  window.addEventListener("popstate", function () {
    if (!el.root || el.root.classList.contains("lb-hide")) return;
    if (canUp()) { try { history.pushState({ lib: 1 }, ""); } catch (e) {} up(); }
    else { el.root.classList.add("lb-hide"); document.documentElement.classList.remove("lb-lock"); }
  });

  if (KEY && window.indexedDB) {
    refreshHave().then(paintDiary); paintDiary();
    // сайт может перестроить дневник — следим, чтобы карточка была на месте
    setInterval(paintDiary, 2000);
  }

  window.openLib = function () {
    if (!KEY) { alert("Лекции: в lib.js не вставлен ключ Google. Открываю папку на Google Диске."); window.open(DRIVE_URL, "_blank", "noopener"); return; }
    if (!window.indexedDB) { alert("Лекции: этот браузер не поддерживает офлайн-хранилище. Открываю Google Диск."); window.open(DRIVE_URL, "_blank", "noopener"); return; }
    open();
  };
})();
