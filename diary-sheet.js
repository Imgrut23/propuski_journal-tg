/* Дневник: вопросы семинара открываются в отдельной шторке, а не раскрываются в карточке.
   Настоящий <ol> с вопросами временно переезжает в шторку (чтобы работали «Беру» и копирование)
   и возвращается в карточку при закрытии. */
(function () {
  "use strict";
  var sched = document.getElementById("schedule");
  if (!sched) return;

  var back, sheet, titleEl, subEl, bodyEl, footEl, statusEl, plateEl;
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
      '<div class="qs-plate" hidden></div>' +
      '<div class="qs-body"></div>' +
      '<footer class="qs-foot"><button type="button" class="qs-ai">Скопировать вопросы для ИИ</button>' +
      '<span class="qs-status" role="status" aria-live="polite"></span></footer>';
    document.body.appendChild(back);
    document.body.appendChild(sheet);
    titleEl = sheet.querySelector("#qsTitle");
    subEl = sheet.querySelector(".qs-sub");
    bodyEl = sheet.querySelector(".qs-body");
    plateEl = sheet.querySelector(".qs-plate");
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
  function toast(t) { try { if (window.hzToast) { window.hzToast(t); return; } } catch (e) {} }

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
    var sumText = "";
    if (sum) sumText = sum.textContent.trim();
    subEl.textContent = sumText;
    statusEl.textContent = "";

    var ph = document.createComment("qs");
    ol.parentNode.insertBefore(ph, ol);
    bodyEl.innerHTML = "";
    bodyEl.appendChild(ol);
    bodyEl.scrollTop = 0;
    cur = { details: details, ol: ol, ph: ph };
    try { if (typeof paintPicks === "function") paintPicks(ol); } catch (e) {}
    paintPlate();

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

  /* ───── плашка «Вопросы мне»: кто какие вопросы взял; видят все ───── */
  function escH(t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function paintPlate() {
    if (!plateEl) return;
    var ol = cur && cur.ol, groups = {}, order = [], me = "";
    try { me = typeof myName === "function" ? myName() || "" : ""; } catch (e) {}
    if (ol && typeof pickers === "function") {
      ol.querySelectorAll("li[data-pk]").forEach(function (li) {
        var qi = +li.dataset.qi, tx = ((li.querySelector(".q-text") || {}).textContent || "").trim();
        pickers(li.dataset.pk, qi).forEach(function (n) {
          if (!groups[n]) { groups[n] = []; order.push(n); }
          groups[n].push({ n: qi + 1, t: tx });
        });
      });
    }
    order.sort(function (a, b) { return (a === me ? -1 : 0) - (b === me ? -1 : 0) || String(a).localeCompare(String(b), "ru"); });
    if (!order.length) { plateEl.hidden = true; plateEl.innerHTML = ""; return; }
    var h = order.map(function (n) {
      var mine = n === me;
      return '<div class="qs-pl' + (mine ? " me" : "") + '"><b>' + (mine ? "Вопросы мне" : "Вопросы: " + escH(n)) + '</b>' +
        groups[n].map(function (q) { return '<button type="button" class="qs-pq" data-qn="' + q.n + '"><i>' + q.n + '</i><span>' + escH(q.t) + '</span></button>'; }).join("") + "</div>";
    }).join("");
    if (plateEl.dataset.h !== h) { plateEl.dataset.h = h; plateEl.innerHTML = h; }
    plateEl.hidden = false;
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".qs-plate .qs-pq");
    if (!b || !cur) return;
    var li = cur.ol.querySelectorAll("li[data-pk]")[+b.dataset.qn - 1];
    if (li) { try { li.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (x) { li.scrollIntoView(); } }
  });

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
    var old = s.querySelector(".qs-mine"); if (old) old.remove(); // кнопка «Мне на ответ» убрана
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

  /* ───── день без прокрутки: если пары не влезли — включаем «плотный» вид ───── */
  function fit() {
    var sv = document.getElementById("schedView"), l = sv && sv.querySelector("#schedule .panel.active .lessons");
    if (!sv || !l || sv.classList.contains("hidden")) return;
    var nav = document.getElementById("bnav"), navTop = nav && nav.offsetHeight ? nav.getBoundingClientRect().top : window.innerHeight;
    var room = Math.min(window.innerHeight, navTop) - 6;
    var fits = function () { return l.getBoundingClientRect().bottom <= room; };
    sv.classList.remove("dv-tight");
    if (!fits()) sv.classList.add("dv-tight");
  }
  var fitT = 0;
  function fitSoon() { clearTimeout(fitT); fitT = setTimeout(fit, 60); }
  window.addEventListener("resize", fitSoon);
  window.addEventListener("orientationchange", fitSoon);

  var raf = 0;
  function decorate() {
    raf = 0;
    sched.querySelectorAll("details.seminar-q").forEach(function (d) {
      var ol = d.querySelector("ol");
      if (ol) mark(d, ol);
    });
    if (cur) { mark(cur.details, cur.ol); paintPlate(); }
    fade();
    fitSoon();
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
  // тап по свёрнутой прошедшей паре раскрывает её (и сворачивает обратно)
  sched.addEventListener("click", function (e) {
    var c = e.target.closest && e.target.closest(".lesson-card.qs-past");
    if (!c || (e.target.closest && e.target.closest("button,a,summary,details,input,select,textarea"))) return;
    c.classList.toggle("qs-open");
  });
  decorate();
})();

/* ───── «Ответ» рядом с «Беру»: текст + фото. Кнопка появляется, когда вопрос взят. ─────
   Текст лежит в записи выбора: /picks/<пара>/<студент>/a, признак фото — .../ph.
   Само фото (сжатый JPEG) хранится отдельно: /pimg/<группа>/<пара>/<студент>, чтобы не раздувать основную базу. */
(function () {
  "use strict";
  var box, back, ta, mq, prev, img, st, saveBtn, fileIn, addLbl;
  var cur = null;              // { pk, key, li }
  var ph = { data: null, changed: false, removed: false, busy: false };
  var CACHE = {};

  function toast(t) { try { if (window.hzToast) window.hzToast(t); } catch (e) {} }
  function mkey() { return k(myName()); }
  function rec(pk) { return ((db.picks || {})[pk] || {})[mkey()]; }
  function recPath(pk) { return "/picks/" + pk + "/" + encodeURIComponent(mkey()); }
  function imgUrl(pk, key) { return ROOT_URL() + "/pimg/" + encodeURIComponent(GROUP) + "/" + pk + "/" + encodeURIComponent(key) + ".json"; }

  function build() {
    if (box) return;
    back = document.createElement("div"); back.className = "qa-back";
    box = document.createElement("section"); box.className = "qa-box";
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-labelledby", "qaT");
    box.innerHTML =
      '<header class="qa-head"><h3 id="qaT">Мой вопрос и ответ</h3><button type="button" class="qa-x" aria-label="Закрыть">\u00d7</button></header>' +
      '<p class="qa-q"></p>' +
      '<label class="qa-lab" for="qaMq">Вопрос</label>' +
      '<textarea class="qa-text qa-mq" id="qaMq" rows="3" maxlength="1000" placeholder="Твой вопрос по этой теме (его увидят остальные)\u2026" aria-label="Мой вопрос"></textarea>' +
      '<label class="qa-lab" for="qaAns">Ответ</label>' +
      '<textarea class="qa-text" id="qaAns" rows="6" maxlength="4000" placeholder="Ответ на этот вопрос, тезисы, заметки\u2026" aria-label="Текст ответа"></textarea>' +
      '<div class="qa-ph"><label class="qa-add">\uD83D\uDCF7 <span>Прикрепить фото</span><input type="file" accept="image/*" class="qa-file"></label>' +
      '<div class="qa-prev" hidden><img alt="Фото к ответу"><button type="button" class="qa-rm">Убрать фото</button></div></div>' +
      '<p class="qa-st" role="status" aria-live="polite"></p>' +
      '<div class="qa-foot"><button type="button" class="qa-cancel">Отмена</button><button type="button" class="qa-save">Сохранить</button></div>';
    document.body.appendChild(back); document.body.appendChild(box);
    ta = box.querySelector("#qaAns"); mq = box.querySelector("#qaMq"); prev = box.querySelector(".qa-prev"); img = prev.querySelector("img");
    st = box.querySelector(".qa-st"); saveBtn = box.querySelector(".qa-save"); fileIn = box.querySelector(".qa-file"); addLbl = box.querySelector(".qa-add span");
    back.addEventListener("click", close);
    box.querySelector(".qa-x").addEventListener("click", close);
    box.querySelector(".qa-cancel").addEventListener("click", close);
    saveBtn.addEventListener("click", commit);
    box.querySelector(".qa-rm").addEventListener("click", function () {
      ph.data = null; ph.changed = false; ph.removed = true; paintPhoto();
    });
    fileIn.addEventListener("change", function () {
      var f = fileIn.files && fileIn.files[0]; fileIn.value = "";
      if (!f) return;
      st.textContent = "Обрабатываю фото\u2026";
      shrink(f).then(function (d) {
        ph.data = d; ph.changed = true; ph.removed = false; st.textContent = ""; paintPhoto();
      }, function () { st.textContent = "Не удалось прочитать фото. Попробуй другое."; });
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && cur && !ph.busy) close(); });
  }

  /* сжатие: длинная сторона ≤ 1280 px, JPEG ~70% (обычно 80–200 КБ) */
  function shrink(file) {
    function toCanvas(src, w, h) {
      var max = 1280, k1 = Math.min(1, max / Math.max(w, h)), cw = Math.max(1, Math.round(w * k1)), ch = Math.max(1, Math.round(h * k1));
      var c = document.createElement("canvas"); c.width = cw; c.height = ch;
      var x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, cw, ch); x.drawImage(src, 0, 0, cw, ch);
      var d = c.toDataURL("image/jpeg", 0.72);
      if (d.length > 420000) d = c.toDataURL("image/jpeg", 0.55);
      return d;
    }
    function viaImg() {
      return new Promise(function (ok, no) {
        var u = URL.createObjectURL(file), im = new Image();
        im.onload = function () { try { ok(toCanvas(im, im.naturalWidth, im.naturalHeight)); } catch (e) { no(e); } URL.revokeObjectURL(u); };
        im.onerror = function () { URL.revokeObjectURL(u); no(new Error("img")); };
        im.src = u;
      });
    }
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: "from-image" }).then(function (bm) {
        var d = toCanvas(bm, bm.width, bm.height); try { bm.close(); } catch (e) {} return d;
      }).catch(viaImg);
    }
    return viaImg();
  }

  function paintPhoto() {
    var has = !!ph.data;
    prev.hidden = !has;
    if (has) img.src = ph.data;
    addLbl.textContent = has ? "Заменить фото" : "Прикрепить фото";
  }

  function open(li) {
    if (typeof myName !== "function" || !myName()) { toast("Войди в свой профиль"); return; }
    var pk = li.dataset.pk, r = rec(pk);
    if (!r) { toast("Сначала нажми «Беру»"); return; }
    build();
    cur = { pk: pk, key: mkey(), li: li };
    ph = { data: null, changed: false, removed: false, busy: false };
    box.querySelector(".qa-q").textContent = (+li.dataset.qi + 1) + ". " + (((li.querySelector(".q-text") || {}).textContent) || "").trim();
    ta.value = r.a || ""; mq.value = r.mq || ""; st.textContent = ""; saveBtn.disabled = false; saveBtn.textContent = "Сохранить";
    paintPhoto();
    document.documentElement.classList.add("qa-lock");
    requestAnimationFrame(function () { back.classList.add("on"); box.classList.add("on"); });
    if (r.ph) {
      var ck = pk + "|" + cur.key;
      if (CACHE[ck]) { ph.data = CACHE[ck]; paintPhoto(); }
      else {
        st.textContent = "Загружаю фото\u2026";
        fetch(imgUrl(pk, cur.key)).then(function (x) { return x.json(); }).then(function (d) {
          if (!cur || cur.pk !== pk) return;
          if (typeof d === "string" && d.indexOf("data:image") === 0) { CACHE[ck] = d; if (!ph.changed && !ph.removed) { ph.data = d; paintPhoto(); } st.textContent = ""; }
          else st.textContent = "Фото не найдено на сервере";
        }).catch(function () { if (cur && cur.pk === pk) st.textContent = "Не удалось загрузить фото (нет сети?)"; });
      }
    }
    setTimeout(function () { try { ta.focus({ preventScroll: true }); } catch (e) {} }, 350);
  }

  function close() {
    if (!box || ph.busy) return;
    back.classList.remove("on"); box.classList.remove("on");
    document.documentElement.classList.remove("qa-lock");
    try { ta.blur(); mq.blur(); } catch (e) {}
    cur = null;
  }

  function repaint(li) {
    try { if (typeof paintPicks === "function") paintPicks(li.closest("ol")); } catch (e) {}
  }

  function commit() {
    if (!cur || ph.busy) return;
    var c = cur, r = rec(c.pk);
    if (!r) { toast("Вопрос уже не выбран"); close(); return; }
    var text = ta.value.trim(), mqt = mq.value.trim();
    if (text) r.a = text; else delete r.a;
    if (mqt) r.mq = mqt; else delete r.mq;
    try { save(); } catch (e) {}
    net(recPath(c.pk) + "/a", text || null);
    net(recPath(c.pk) + "/mq", mqt || null);
    var path = recPath(c.pk), ck = c.pk + "|" + c.key, job = Promise.resolve(true);
    if (ph.changed && ph.data) {
      ph.busy = true; saveBtn.disabled = true; st.textContent = "Загружаю фото\u2026"; saveBtn.textContent = "Сохраняю\u2026";
      job = fetch(imgUrl(c.pk, c.key), { method: "PUT", body: JSON.stringify(ph.data) }).then(function (x) {
        if (!x.ok) throw new Error("http " + x.status);
        CACHE[ck] = ph.data; r.ph = 1; try { save(); } catch (e) {} net(path + "/ph", 1); return true;
      }).catch(function () { return false; });
    } else if (ph.removed && r.ph) {
      delete r.ph; delete CACHE[ck]; try { save(); } catch (e) {}
      net(path + "/ph", null);
      fetch(imgUrl(c.pk, c.key), { method: "DELETE" }).catch(function () {});
    }
    job.then(function (okPhoto) {
      ph.busy = false; repaint(c.li);
      if (!okPhoto) {
        st.textContent = "Текст сохранён, а фото не загрузилось (нет сети или сервер не разрешил). Попробуй ещё раз.";
        saveBtn.disabled = false; saveBtn.textContent = "Сохранить"; return;
      }
      toast("Вопрос и ответ сохранены"); close();
    });
  }

  // снял «Беру» → убираем и фото на сервере
  window.hzPickGone = function (pk, key, r) {
    try { delete CACHE[pk + "|" + key]; } catch (e) {}
    if (r && r.ph) fetch(imgUrl(pk, key), { method: "DELETE" }).catch(function () {});
  };

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".qs-body .q-ans");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var li = b.closest("li[data-pk]"); if (li) open(li);
  }, true);
})();
