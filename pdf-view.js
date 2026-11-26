/* Просмотр PDF прямо в приложении (iPhone, Android, Telegram, ПК, офлайн).
   Свой постраничный просмотрщик на pdf.js (лежит рядом, в корне: pdf.min.js, pdf.worker.min.js, *.wasm, *.pfb, *.ttf — ничего не грузится из интернета).
   window.pdfView.attach(root, blob) -> Promise<{destroy()}>  (reject, если PDF не удалось разобрать)
   Страницы рисуются только когда видны и освобождаются, когда далеко — не виснет даже на 300 слайдах. */
(function () {
  "use strict";
  var BASE = new URL("./", document.baseURI).href;
  var libP = null;

  function loadLib() {
    if (libP) return libP;
    libP = import(BASE + "pdf.min.js").then(function (m) {
      var L = m && m.getDocument ? m : (m && m.default) || window.pdfjsLib;
      if (!L || !L.getDocument) throw new Error("pdfjs");
      L.GlobalWorkerOptions.workerSrc = BASE + "pdf.worker.min.js";
      return L;
    }).catch(function (e) { libP = null; throw e; });
    return libP;
  }

  function attach(root, blob) {
    root.innerHTML =
      '<div class="pdv"><div class="pdv-scroll" tabindex="0"><div class="pdv-pages"></div></div>' +
      '<div class="pdv-load">Открываю PDF…</div>' +
      '<div class="pdv-bar" hidden><button type="button" data-z="out" aria-label="Уменьшить">−</button>' +
      '<button type="button" class="pdv-pg" data-z="fit" aria-label="По ширине"><span class="pdv-n">1</span> / <span class="pdv-t">1</span></button>' +
      '<button type="button" data-z="in" aria-label="Увеличить">+</button></div></div>';
    var V = root.querySelector(".pdv"), sc = V.querySelector(".pdv-scroll"), pages = V.querySelector(".pdv-pages"),
      bar = V.querySelector(".pdv-bar"), loadEl = V.querySelector(".pdv-load"),
      nEl = V.querySelector(".pdv-n"), tEl = V.querySelector(".pdv-t");
    var dead = false, doc = null, boxes = [], sizes = [], zoom = 1, PAD = 10, GAP = 10, io = null, ro = null;
    var queue = [], busy = 0, MAXBUSY = 2, hideT = 0;
    var DPR = Math.min(window.devicePixelRatio || 1, 2.5);

    function fitW() { return Math.max(120, sc.clientWidth - PAD * 2); }
    function cssW() { return fitW() * zoom; }
    function boxH(i) { var s = sizes[i] || sizes[0] || { w: 4, h: 3 }; return cssW() * s.h / s.w; }

    function layout() {
      var w = cssW();
      pages.style.width = w + "px";
      for (var i = 0; i < boxes.length; i++) {
        boxes[i].style.width = w + "px";
        boxes[i].style.height = boxH(i) + "px";
        if (boxes[i]._on) { unrender(boxes[i]); }
      }
      kick();
    }

    /* ── отрисовка страниц ── */
    function kick() {
      if (dead) return;
      for (var i = 0; i < boxes.length; i++) if (boxes[i]._vis && !boxes[i]._on && !boxes[i]._q) { boxes[i]._q = 1; queue.push(i); }
      pump();
    }
    function pump() {
      while (!dead && busy < MAXBUSY && queue.length) {
        // сначала ближайшие к центру экрана
        var mid = sc.scrollTop + sc.clientHeight / 2, best = 0, bd = 1e12;
        for (var k = 0; k < queue.length; k++) {
          var b = boxes[queue[k]], d = Math.abs(b.offsetTop + b.offsetHeight / 2 - mid);
          if (d < bd) { bd = d; best = k; }
        }
        var idx = queue.splice(best, 1)[0];
        boxes[idx]._q = 0;
        if (!boxes[idx]._vis || boxes[idx]._on) continue;
        busy++;
        renderPage(idx).then(function () {}, function () {}).then(function () { busy--; pump(); });
      }
    }
    function renderPage(i) {
      var box = boxes[i], gen = (box._gen = (box._gen || 0) + 1);
      return doc.getPage(i + 1).then(function (page) {
        if (dead || box._gen !== gen || !box._vis) return;
        var v1 = page.getViewport({ scale: 1 });
        sizes[i] = { w: v1.width, h: v1.height };
        var w = cssW(), h = w * v1.height / v1.width;
        box.style.height = h + "px";
        var sc1 = w * DPR / v1.width;
        var maxPx = 12e6;                       // лимит памяти canvas на iPhone
        if (v1.width * sc1 * v1.height * sc1 > maxPx) sc1 = Math.sqrt(maxPx / (v1.width * v1.height));
        var vp = page.getViewport({ scale: sc1 });
        var cv = document.createElement("canvas");
        cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
        cv.style.width = "100%"; cv.style.height = "100%";
        var ctx = cv.getContext("2d", { alpha: false });
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
        var task = page.render({ canvasContext: ctx, viewport: vp, canvas: cv });
        box._task = task;
        return task.promise.then(function () {
          box._task = null;
          if (dead || box._gen !== gen || !box._vis) { cv.width = cv.height = 0; return; }
          box.appendChild(cv); box._cv = cv; box._on = 1;
          box.classList.add("on");
          try { page.cleanup(); } catch (e) {}
        }, function (e) { box._task = null; cv.width = cv.height = 0; if (!e || e.name !== "RenderingCancelledException") throw e; });
      });
    }
    function unrender(box) {
      box._gen = (box._gen || 0) + 1;
      if (box._task) { try { box._task.cancel(); } catch (e) {} box._task = null; }
      if (box._cv) { box._cv.width = box._cv.height = 0; if (box._cv.parentNode) box._cv.parentNode.removeChild(box._cv); box._cv = null; }
      box._on = 0; box.classList.remove("on");
    }

    /* ── текущая страница ── */
    var raf = 0;
    function paintPage() {
      raf = 0;
      var mid = sc.scrollTop + sc.clientHeight * 0.35, lo = 0, hi = boxes.length - 1;
      while (lo < hi) { var m = (lo + hi + 1) >> 1; if (boxes[m].offsetTop <= mid) lo = m; else hi = m - 1; }
      nEl.textContent = lo + 1;
      bar.classList.add("show");
      clearTimeout(hideT); hideT = setTimeout(function () { bar.classList.remove("show"); }, 2200);
    }
    sc.addEventListener("scroll", function () { if (!raf) raf = requestAnimationFrame(paintPage); }, { passive: true });

    /* ── масштаб ── */
    function setZoom(z, fx, fy) {
      z = Math.max(1, Math.min(5, z));
      if (Math.abs(z - zoom) < 0.001) return;
      if (fx == null) { fx = sc.clientWidth / 2; fy = sc.clientHeight / 2; }
      var cx = (sc.scrollLeft + fx) / zoom, cy = (sc.scrollTop + fy) / zoom;
      zoom = z;
      layout();
      sc.scrollLeft = cx * zoom - fx; sc.scrollTop = cy * zoom - fy;
      paintPage();
    }
    V.querySelector(".pdv-bar").addEventListener("click", function (e) {
      var b = e.target.closest("[data-z]"); if (!b) return;
      var a = b.dataset.z;
      if (a === "in") setZoom(zoom * 1.3); else if (a === "out") setZoom(zoom / 1.3); else setZoom(zoom > 1.05 ? 1 : 2);
      bar.classList.add("show");
    });
    // щипок двумя пальцами
    var pin = null;
    function dist(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); }
    sc.addEventListener("touchstart", function (e) {
      if (e.touches.length === 2) {
        var r = sc.getBoundingClientRect();
        pin = { d: dist(e.touches), z: zoom, f: 1, fx: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, fy: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top };
      }
    }, { passive: true });
    sc.addEventListener("touchmove", function (e) {
      if (pin && e.touches.length === 2) {
        e.preventDefault();
        var f = dist(e.touches) / pin.d, z = Math.max(1, Math.min(5, pin.z * f));
        pin.f = z / pin.z;
        pages.style.transformOrigin = (sc.scrollLeft + pin.fx) + "px " + (sc.scrollTop + pin.fy) + "px";
        pages.style.transform = "scale(" + pin.f + ")";
      }
    }, { passive: false });
    function endPin() {
      if (!pin) return;
      var p = pin; pin = null;
      pages.style.transform = ""; pages.style.transformOrigin = "";
      setZoom(p.z * p.f, p.fx, p.fy);
    }
    sc.addEventListener("touchend", function (e) { if (e.touches.length < 2) endPin(); }, { passive: true });
    sc.addEventListener("touchcancel", endPin, { passive: true });
    // двойной тап
    var lastTap = 0, lx = 0, ly = 0;
    sc.addEventListener("touchend", function (e) {
      if (e.touches.length || e.changedTouches.length !== 1 || pin) return;
      var t = e.changedTouches[0], now = Date.now();
      if (now - lastTap < 300 && Math.abs(t.clientX - lx) < 30 && Math.abs(t.clientY - ly) < 30) {
        var r = sc.getBoundingClientRect();
        setZoom(zoom > 1.05 ? 1 : 2.2, t.clientX - r.left, t.clientY - r.top); lastTap = 0;
      } else { lastTap = now; lx = t.clientX; ly = t.clientY; }
    }, { passive: true });
    // ПК: Ctrl+колесо, клавиши
    sc.addEventListener("wheel", function (e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      var r = sc.getBoundingClientRect();
      setZoom(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    sc.addEventListener("keydown", function (e) {
      if (e.key === "+" || e.key === "=") { setZoom(zoom * 1.3); e.preventDefault(); }
      else if (e.key === "-") { setZoom(zoom / 1.3); e.preventDefault(); }
      else if (e.key === "0") { setZoom(1); e.preventDefault(); }
    });
    ["gesturestart", "gesturechange"].forEach(function (n) { sc.addEventListener(n, function (e) { e.preventDefault(); }); });

    function destroy() {
      if (dead) return; dead = true;
      try { if (io) io.disconnect(); if (ro) ro.disconnect(); } catch (e) {}
      clearTimeout(hideT);
      boxes.forEach(unrender);
      try { if (doc) doc.destroy(); } catch (e) {}
      doc = null; boxes = []; queue = [];
    }

    return Promise.all([loadLib(), blob.arrayBuffer()]).then(function (r) {
      if (dead) return null;
      var L = r[0];
      return L.getDocument({
        data: new Uint8Array(r[1]),
        wasmUrl: BASE,
        standardFontDataUrl: BASE,
        isEvalSupported: false,
        useSystemFonts: true
      }).promise;
    }).then(function (d) {
      if (dead) { try { d.destroy(); } catch (e) {} return null; }
      doc = d;
      tEl.textContent = d.numPages;
      return d.getPage(1).then(function (p1) {
        var v = p1.getViewport({ scale: 1 });
        sizes[0] = { w: v.width, h: v.height };
        for (var i = 0; i < d.numPages; i++) {
          var b = document.createElement("div");
          b.className = "pdv-box"; b.dataset.i = i; b._vis = 0;
          pages.appendChild(b); boxes.push(b);
        }
        layout();
        loadEl.remove(); bar.hidden = false; bar.classList.add("show");
        io = new IntersectionObserver(function (es) {
          es.forEach(function (en) {
            var b = en.target; b._vis = en.isIntersecting ? 1 : 0;
            if (!b._vis && b._on) unrender(b);
          });
          kick();
        }, { root: sc, rootMargin: "120% 0px 120% 0px" });
        boxes.forEach(function (b) { io.observe(b); });
        var lastW = sc.clientWidth;
        ro = new ResizeObserver(function () {
          if (dead || Math.abs(sc.clientWidth - lastW) < 2) return;   // высота меняется при сворачивании адресной строки — страницы не трогаем
          lastW = sc.clientWidth;
          var p = sc.scrollHeight ? sc.scrollTop / sc.scrollHeight : 0;
          layout(); sc.scrollTop = p * sc.scrollHeight;
        });
        ro.observe(sc);
        // реальные размеры страниц (в презентациях они обычно одинаковые, но бывают разные)
        (function sz(from) {
          if (dead || from >= d.numPages) return;
          var to = Math.min(d.numPages, from + 24), ps = [];
          for (var i = from; i < to; i++) ps.push(d.getPage(i + 1).then((function (k) { return function (p) { var v = p.getViewport({ scale: 1 }); sizes[k] = { w: v.width, h: v.height }; try { p.cleanup(); } catch (e) {} }; })(i)).catch(function () {}));
          Promise.all(ps).then(function () {
            if (dead) return;
            for (var j = from; j < to; j++) if (!boxes[j]._on) boxes[j].style.height = boxH(j) + "px";
            sz(to);
          });
        })(1);
        try { sc.focus({ preventScroll: true }); } catch (e) {}
        return { destroy: destroy, pages: d.numPages };
      });
    }).catch(function (e) { destroy(); throw e; });
  }

  window.pdfView = { attach: attach };
})();
