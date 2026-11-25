/* Дневник: вопросы семинара открываются в отдельной шторке, а не раскрываются в карточке.
   Настоящий <ol> с вопросами временно переезжает в шторку (чтобы работали «Беру» и копирование)
   и возвращается в карточку при закрытии. */
(function () {
  "use strict";
  var sched = document.getElementById("schedule");
  if (!sched) return;

  var back, sheet, titleEl, subEl, bodyEl, footEl, statusEl;
  var cur = null; // { details, ol, ph }
  var closeTimer = 0;

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function build() {
    if (sheet) return;
    back = el("div", "qs-back");
    sheet = el("section", "qs-sheet");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-labelledby", "qsTitle");
    sheet.innerHTML =
      '<div class="qs-grab"></div>' +
      '<header class="qs-head"><div><p class="qs-sub"></p><h2 id="qsTitle"></h2></div>' +
      '<button type="button" class="qs-x" aria-label="Закрыть">\u00d7</button></header>' +
      '<div class="qs-body"></div>' +
      '<footer class="qs-foot"><button type="button" class="qs-ai">Скопировать вопросы для ИИ</button>' +
      '<span class="qs-status" role="status" aria-live="polite"></span></footer>';
    document.body.appendChild(back);
    document.body.appendChild(sheet);
    titleEl = sheet.querySelector("#qsTitle");
    subEl = sheet.querySelector(".qs-sub");
    bodyEl = sheet.querySelector(".qs-body");
    footEl = sheet.querySelector(".qs-foot");
    statusEl = sheet.querySelector(".qs-status");

    back.addEventListener("click", close);
    sheet.querySelector(".qs-x").addEventListener("click", close);
    sheet.querySelector(".qs-ai").addEventListener("click", copyForAi);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && cur) close();
    });

    // «Беру» — родной обработчик живёт на #schedule, а <ol> теперь вне него
    bodyEl.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".q-vote");
      if (!b || b.disabled) return;
      var li = b.closest("li[data-pk]");
      if (li && typeof togglePick === "function") togglePick(li);
    });

    bindDrag();
  }

  /* ───── открыть / закрыть ───── */
  function open(details) {
    var ol = details.querySelector("ol");
    if (!ol) return;
    build();
    clearTimeout(closeTimer);
    if (cur) restore();

    var card = details.closest(".lesson-card");
    var subj = card && card.querySelector(".subject");
    var sum = details.querySelector("summary");
    titleEl.textContent = subj ? subj.textContent.trim() : "Вопросы";
    subEl.textContent = sum ? sum.textContent.trim() : "";
    statusEl.textContent = "";

    var ph = document.createComment("qs");
    ol.parentNode.insertBefore(ph, ol);
    bodyEl.innerHTML = "";
    bodyEl.appendChild(ol);
    bodyEl.scrollTop = 0;
    cur = { details: details, ol: ol, ph: ph };
    try { if (typeof paintPicks === "function") paintPicks(ol); } catch (e) {}

    document.documentElement.classList.add("qs-lock");
    sheet.style.removeProperty("--dy");
    sheet.classList.remove("drag");
    // два кадра: сначала в DOM в закрытом состоянии, потом анимация
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        back.classList.add("on");
        sheet.classList.add("on");
      });
    });
    try { sheet.querySelector(".qs-x").focus({ preventScroll: true }); } catch (e) {}
  }

  function restore() {
    if (!cur) return;
    var c = cur;
    cur = null;
    if (c.ph && c.ph.parentNode) {
      c.ph.parentNode.insertBefore(c.ol, c.ph);
      c.ph.parentNode.removeChild(c.ph);
    } // если карточку успели перерисовать — просто выбрасываем
  }

  function close() {
    if (!sheet) return;
    back.classList.remove("on");
    sheet.classList.remove("on", "drag");
    sheet.style.removeProperty("--dy");
    document.documentElement.classList.remove("qs-lock");
    closeTimer = setTimeout(restore, 360);
  }

  /* ───── «Скопировать для ИИ» — через родную кнопку в карточке ───── */
  function copyForAi() {
    if (!cur) return;
    var c = cur;
    var btn = c.details.querySelector(".ask-deepseek");
    if (!btn) return;
    // родной обработчик собирает .q-text из <details>, поэтому на миг возвращаем список
    var ph = c.ph;
    if (ph && ph.parentNode) {
      ph.parentNode.insertBefore(c.ol, ph);
      btn.click();
      bodyEl.appendChild(c.ol);
    } else {
      btn.click();
    }
    var st = c.details.querySelector(".ask-deepseek-status");
    statusEl.textContent = "Копирую…";
    setTimeout(function () { if (st && st.textContent) statusEl.textContent = st.textContent; }, 250);
    setTimeout(function () { if (st && st.textContent) statusEl.textContent = st.textContent; }, 1200);
  }

  /* ───── свайп вниз ───── */
  function bindDrag() {
    var y0 = 0, dy = 0, on = false;
    function start(e) {
      if (!sheet.classList.contains("on")) return;
      on = true; dy = 0; y0 = e.touches[0].clientY;
      sheet.classList.add("drag");
    }
    function move(e) {
      if (!on) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      sheet.style.setProperty("--dy", dy + "px");
      if (e.cancelable) e.preventDefault();
    }
    function end() {
      if (!on) return;
      on = false;
      sheet.classList.remove("drag");
      if (dy > 90) close(); else sheet.style.removeProperty("--dy");
    }
    [sheet.querySelector(".qs-grab"), sheet.querySelector(".qs-head")].forEach(function (h) {
      h.addEventListener("touchstart", start, { passive: true });
      h.addEventListener("touchmove", move, { passive: false });
      h.addEventListener("touchend", end);
      h.addEventListener("touchcancel", end);
    });
  }

  /* ───── клик по «Вопросы к семинару» в карточке ───── */
  document.addEventListener("click", function (e) {
    var s = e.target.closest && e.target.closest("#schedule details.seminar-q > summary");
    if (!s) return;
    e.preventDefault();
    open(s.parentNode);
  }, true);

  /* ───── счётчик вопросов и «мой вопрос» на кнопке ───── */
  function myPick(ol) {
    try {
      if (typeof myName !== "function" || typeof pickers !== "function") return "";
      var me = myName();
      if (!me) return "";
      var found = "";
      ol.querySelectorAll("li[data-pk]").forEach(function (li) {
        if (found) return;
        var i = +li.dataset.qi;
        if (pickers(li.dataset.pk, i).indexOf(me) > -1) found = String(i + 1);
      });
      return found;
    } catch (e) { return ""; }
  }
  function mark(details, ol) {
    var s = details.querySelector("summary");
    if (!s || !ol) return;
    var n = ol.querySelectorAll("li.seminar-q-item").length;
    if (n && s.dataset.n !== String(n)) s.dataset.n = String(n);
    var m = myPick(ol);
    if (m) { if (s.dataset.mine !== m) s.dataset.mine = m; }
    else if (s.dataset.mine) delete s.dataset.mine;
  }

  /* ───── прошедшие пары + прокрутка к текущей ───── */
  var START = new Date(2026, 7, 31), DAYS = ["mon", "tue", "wed", "thu", "fri", "sat"], lastKey = "";
  function toMin(t) {
    var m = /(\d{1,2})[:.](\d{2})/.exec(t || "");
    return m ? +m[1] * 60 + +m[2] : null;
  }
  function fade() {
    var panel = sched.querySelector(".panel.active");
    if (!panel) return;
    var m = /panel-[^-]+-([a-z]+)-(\d+)/.exec(panel.className);
    var cards = panel.querySelectorAll(".lesson-card");
    var now = new Date(), isToday = false;
    if (m && DAYS.indexOf(m[1]) > -1) {
      var d = new Date(START.getFullYear(), START.getMonth(), START.getDate() + (+m[2]) * 7 + DAYS.indexOf(m[1]));
      isToday = d.toDateString() === now.toDateString();
    }
    var mins = now.getHours() * 60 + now.getMinutes(), firstLive = null;
    cards.forEach(function (c) {
      var i = c.querySelector(".lesson-time i");
      var end = toMin(i && i.textContent);
      var past = isToday && end != null && mins >= end;
      c.classList.toggle("qs-past", past);
      if (!past && !firstLive) firstLive = c;
    });
    if (isToday && firstLive && firstLive !== cards[0] && lastKey !== panel.className + "|" + now.toDateString()) {
      lastKey = panel.className + "|" + now.toDateString();
      if ((window.scrollY || 0) < 80) setTimeout(function () {
        try { firstLive.scrollIntoView({ block: "start", behavior: "smooth" }); } catch (e) {}
      }, 120);
    }
  }

  var raf = 0;
  function decorate() {
    raf = 0;
    sched.querySelectorAll("details.seminar-q").forEach(function (d) {
      var ol = d.querySelector("ol");
      if (ol) mark(d, ol);
    });
    if (cur) mark(cur.details, cur.ol);
    fade();
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(decorate); }
  new MutationObserver(schedule).observe(sched, { childList: true, subtree: true });
  setInterval(function () { if (!document.hidden) fade(); }, 30000);
  // после «Беру» в шторке и после чужих голосов
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest(".qs-body .q-vote")) setTimeout(schedule, 60);
  });
  var oldPaint = window._dvPaint;
  if (typeof oldPaint === "function") window._dvPaint = function () { var r = oldPaint.apply(this, arguments); schedule(); return r; };
  var oldClose = close;
  close = function () { oldClose(); setTimeout(schedule, 400); };
  decorate();
})();
