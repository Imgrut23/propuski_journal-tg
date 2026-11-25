/* Настройки в стиле iOS: главный список -> отдельные экраны, переключатели, варианты с галочкой.
   Старая логика (settingsJs) остаётся источником правды: наши строки только нажимают её кнопки.
   Блоки группы/админа временно переезжают в экраны настроек и возвращаются при закрытии. */
(function () {
  "use strict";
  var moved = [], sh = null, box = null, ios = null, obs = null, msgObs = null, watching = false;

  function role() {
    try {
      if (isGuest || !isHead) return "user";
      return norm(me) === norm(SUPER_ADMIN) ? "admin" : "head";
    } catch (e) { return "user"; }
  }
  function $(id) { return document.getElementById(id); }
  function div(cls, html) { var d = document.createElement("div"); if (cls) d.className = cls; if (html != null) d.innerHTML = html; return d; }

  function take(el, into) {
    if (!el || !el.parentNode) return;
    var ph = document.createComment("sm");
    el.parentNode.insertBefore(ph, el);
    var t = el.getAttribute("data-t");
    if (t !== null) { el.removeAttribute("data-t"); el.classList.remove("tabhide"); }
    if (el.tagName === "DETAILS") el.open = true;
    el.querySelectorAll("details").forEach(function (d) { d.open = true; });
    into.appendChild(el);
    moved.push({ el: el, ph: ph, t: t });
  }
  function restore() {
    moved.forEach(function (m) {
      if (m.t !== null) m.el.setAttribute("data-t", m.t);
      if (m.ph.parentNode) { m.ph.parentNode.insertBefore(m.el, m.ph); m.ph.parentNode.removeChild(m.ph); }
    });
    moved = [];
    try { applyTab(); } catch (e) {}
  }

  /* ---------- строительные блоки ---------- */
  var COLORS = { blue: "#0a84ff", green: "#30b350", orange: "#ff9500", red: "#ff3b30", purple: "#af52de", gray: "#8e8e93", teal: "#30b0c7", pink: "#ff2d55" };
  function icon(emoji, color) {
    var s = div("ios-ic", emoji);
    s.style.background = COLORS[color] || COLORS.gray;
    return s;
  }
  function row(o) {
    var r = div("ios-row" + (o.cls ? " " + o.cls : ""));
    r.setAttribute("role", "button");
    if (o.icon) r.appendChild(icon(o.icon, o.color));
    var t = div("ios-t", ""); t.textContent = o.title; r.appendChild(t);
    if (o.value !== undefined) { var v = div("ios-v"); v.textContent = o.value; r.appendChild(v); r._v = v; }
    if (o.sw) { var sw = div("ios-sw", "<i></i>"); r.appendChild(sw); r._sw = sw; }
    else if (o.chev) r.appendChild(div("ios-chev", "›"));
    if (o.check) { var c = div("ios-ck", "✓"); r.appendChild(c); r._ck = c; }
    r.onclick = o.onclick || null;
    return r;
  }
  function group(caption, rows, foot) {
    var g = div("ios-grp");
    if (caption) { var c = div("ios-cap"); c.textContent = caption; g.appendChild(c); }
    var l = div("ios-list"); rows.forEach(function (r) { l.appendChild(r); }); g.appendChild(l);
    var f = null;
    if (foot !== undefined) { f = div("ios-foot"); f.textContent = foot || ""; g.appendChild(f); }
    g._foot = f;
    return g;
  }

  var pages = {}, cur = "root", titles = {}, ui = {};
  function addPage(id, title) {
    var p = div("ios-page"); p.dataset.id = id; titles[id] = title;
    ios.querySelector(".ios-body").appendChild(p);
    pages[id] = p;
    return p;
  }
  function go(id) {
    cur = id;
    Object.keys(pages).forEach(function (k) { pages[k].classList.toggle("on", k === id); });
    ios.querySelector(".ios-title").textContent = titles[id];
    ios.querySelector(".ios-back").style.visibility = id === "root" ? "hidden" : "visible";
    box.scrollTop = 0;
  }

  /* список вариантов с галочкой поверх старого переключателя-сегмента */
  function radios(segId) {
    var seg = $(segId), rows = [];
    if (!seg) return rows;
    seg.querySelectorAll("button").forEach(function (b) {
      var rw = row({ title: b.textContent, check: true, onclick: function () { b.click(); refresh(); } });
      rw._b = b; rw.classList.add("ios-radio");
      rows.push(rw);
    });
    return rows;
  }
  function pressed(segId) {
    var seg = $(segId), res = null;
    if (seg) seg.querySelectorAll("button").forEach(function (b) { if (b.getAttribute("aria-pressed") === "true") res = b; });
    return res;
  }

  function refresh() {
    if (!ios) return;
    ios.querySelectorAll(".ios-radio").forEach(function (r) {
      r.classList.toggle("sel", r._b.getAttribute("aria-pressed") === "true");
    });
    var th = pressed("sgTheme"); if (ui.theme) ui.theme._v.textContent = th ? th.textContent : "Авто";
    var vb = $("sgVib"), vOn = true;
    if (vb) { var off = vb.querySelector('button[data-v="0"]'); vOn = !(off && off.getAttribute("aria-pressed") === "true"); }
    if (ui.vib) ui.vib._sw.classList.toggle("on", vOn);
    var bio = $("stBio"), bOn = !!bio && bio.getAttribute("aria-pressed") === "true";
    if (ui.bioRow) ui.bioRow._v.textContent = bOn ? "Вкл" : "Выкл";
    if (ui.bioSw) { ui.bioSw._sw.classList.toggle("on", bOn); ui.bioSw.classList.toggle("dis", !!(bio && bio.disabled)); }
    if (ui.delayList) ui.delayList.classList.toggle("dim", !bOn);
    var m = $("stMsg"), txt = m ? m.textContent : "";
    ["bioFoot", "rootFoot"].forEach(function (k) { if (ui[k]) ui[k].textContent = txt; });
  }

  /* ---------- сборка ---------- */
  function titleOf(n) {
    var h = n.querySelector("h2"); if (h && h.textContent.trim()) return h.textContent.trim();
    var z = n.querySelector(".saZTx b"); if (z) return z.textContent.trim();
    var s = n.querySelector(":scope > summary"); if (s) return s.textContent.trim();
    return "Настройка";
  }
  var ICONS = [
    [/временный/i, "👑", "orange"], [/цквр/i, "🎖", "purple"], [/паролю/i, "🔑", "gray"],
    [/выход всех/i, "🚪", "red"], [/qr/i, "📲", "blue"], [/telegram/i, "✈️", "teal"],
    [/лимит/i, "🔢", "orange"], [/список/i, "👥", "green"], [/сброс данных/i, "♻️", "red"],
    [/обнулить пропуски у всех/i, "🗑", "red"], [/пропуски одного/i, "🧾", "blue"], [/функции/i, "🧩", "purple"]
  ];
  function iconFor(t) {
    for (var i = 0; i < ICONS.length; i++) if (ICONS[i][0].test(t)) return ICONS[i];
    return [null, "⚙️", "gray"];
  }
  function itemsOf(id) {
    var d = $(id), out = [];
    if (!d || d.classList.contains("hidden")) return out;
    var c = d.querySelector(":scope > .set-content");
    if (!c) return out;
    Array.prototype.forEach.call(c.children, function (n) {
      if (n.classList.contains("set-divider") || n.classList.contains("hidden") || n.tagName === "P") return;
      out.push(n);
    });
    return out;
  }
  function itemRows(ids, extraFirst) {
    var rows = [], first = true;
    ids.forEach(function (id) {
      itemsOf(id).forEach(function (n) {
        var t = titleOf(n), ic = iconFor(t), pid = "p_" + rows.length + "_" + id;
        var pg = addPage(pid, t);
        if (first && extraFirst) take(extraFirst, pg);
        first = false;
        take(n, pg);
        rows.push(row({ icon: ic[1], color: ic[2], title: t, chev: true, onclick: (function (p) { return function () { go(p); }; })(pid) }));
      });
    });
    return rows;
  }

  function build() {
    var old = box.querySelector(".ios");
    if (old) old.parentNode.removeChild(old);
    if (obs) obs.disconnect(); if (msgObs) msgObs.disconnect();
    pages = {}; titles = {}; ui = {};
    ios = div("ios",
      '<div class="ios-nav"><button type="button" class="ios-back">‹ Настройки</button><b class="ios-title">Настройки</b><button type="button" class="ios-done">Готово</button></div><div class="ios-body"></div>');
    box.appendChild(ios);
    ios.querySelector(".ios-done").onclick = function () { var ok = $("stOk"); ok && ok.click(); };
    ios.querySelector(".ios-back").onclick = function () { go("root"); };
    var r = role();

    var root = addPage("root", "Настройки");

    /* экран «Тема» */
    var pTheme = addPage("theme", "Тема");
    pTheme.appendChild(group("", radios("sgTheme"), "«Авто» следует теме вашего телефона."));
    /* экран «Биометрия» */
    var pBio = addPage("bio", "Вход по биометрии");
    ui.bioSw = row({ title: "Вход по биометрии", sw: true, onclick: function () { var b = $("stBio"); if (b && !b.disabled) b.click(); } });
    var gBio = group("", [ui.bioSw], "Отпечаток, Face ID или код телефона при открытии журнала.");
    ui.bioFoot = div("ios-foot ios-msg"); gBio.appendChild(ui.bioFoot);
    pBio.appendChild(gBio);
    var dl = group("Блокировать после сворачивания", radios("sgDelay"));
    ui.delayList = dl; pBio.appendChild(dl);

    /* главный экран */
    ui.theme = row({ icon: "🎨", color: "purple", title: "Тема", value: "", chev: true, onclick: function () { go("theme"); } });
    ui.vib = row({ icon: "📳", color: "green", title: "Вибрация", sw: true, onclick: function () {
      var vb = $("sgVib"); if (!vb) return;
      var off = vb.querySelector('button[data-v="0"]'), on = vb.querySelector('button[data-v="1"]');
      var isOn = !(off && off.getAttribute("aria-pressed") === "true");
      (isOn ? off : on).click(); refresh();
    } });
    ui.bioRow = row({ icon: "🔐", color: "blue", title: "Биометрия", value: "", chev: true, onclick: function () { go("bio"); } });
    root.appendChild(group("", [ui.theme, ui.vib, ui.bioRow]));

    if (r !== "user") {
      var gr = itemRows(["grpRoles", "grpSkin", "grpBase"]);
      if (gr.length) root.appendChild(group("Группа", gr));
    }
    if (r === "admin") {
      var ar = itemRows(["saCard"], $("saMsg"));
      if (ar.length) root.appendChild(group("Админ", ar));
    }
    var rep = row({ icon: "🛠", color: "gray", title: "Скопировать отчёт об ошибке", onclick: function () { var b = $("stRep"); b && b.click(); } });
    var gRep = group("", [rep], "");
    ui.rootFoot = gRep._foot;
    root.appendChild(gRep);

    obs = new MutationObserver(refresh);
    obs.observe(box, { attributes: true, subtree: true, attributeFilter: ["aria-pressed", "disabled"] });
    var m = $("stMsg");
    if (m) { msgObs = new MutationObserver(refresh); msgObs.observe(m, { childList: true, characterData: true, subtree: true }); }
    refresh();
    go("root");
  }

  function ensure() {
    sh = $("stSheet");
    box = sh && sh.querySelector(".st");
    if (!box) return false;
    if (!box.dataset.sm) {
      box.dataset.sm = "3";
      ["rPerf", "rOled"].forEach(function (id) {
        var n = box.querySelector("#" + id);
        if (n && n.parentNode) n.parentNode.removeChild(n);
      });
      try { localStorage.removeItem("set:oled"); document.documentElement.classList.remove("oled-opt"); } catch (e) {}
      var rs = box.querySelector("#stReset");
      if (rs && rs.parentNode) rs.parentNode.removeChild(rs);
    }
    if (!watching) {
      watching = true;
      new MutationObserver(function () {
        if (!sh.classList.contains("show")) restore();
      }).observe(sh, { attributes: true, attributeFilter: ["class"] });
    }
    return true;
  }

  function sync() {
    if (!ensure()) return;
    restore();
    build();
    setTimeout(refresh, 300); /* биометрия определяется асинхронно */
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest("#stTile")) setTimeout(sync, 40);
  }, true);
})();
