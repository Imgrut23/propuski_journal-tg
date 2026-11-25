/* Единые «Настройки»: личные — у всех; «Группа» — у старосты и админа; «Админ» — только у админа.
   Блоки группы/админа переезжают из вкладки «Группа» в шторку настроек и возвращаются при закрытии. */
(function () {
  "use strict";
  var GRP = ["grpRoles", "grpSkin", "grpTools", "grpBase"], ADM = "saCard";
  var moved = [], sh = null, box = null, tabsEl = null, pGrp = null, pAdm = null, watching = false;

  function role() {
    try {
      if (isGuest || !isHead) return "user";
      return norm(me) === norm(SUPER_ADMIN) ? "admin" : "head";
    } catch (e) { return "user"; }
  }

  function ensure() {
    sh = document.getElementById("stSheet");
    box = sh && sh.querySelector(".st");
    if (!box) return false;
    if (!box.dataset.sm) {
      box.dataset.sm = "1";
      tabsEl = document.createElement("div");
      tabsEl.className = "sm-tabs";
      tabsEl.setAttribute("role", "tablist");
      var h = box.querySelector("h3");
      box.insertBefore(tabsEl, h ? h.nextSibling : box.firstChild);
      pGrp = document.createElement("div"); pGrp.className = "sm-pane sm-pane-grp";
      pAdm = document.createElement("div"); pAdm.className = "sm-pane sm-pane-adm";
      var x = box.querySelector(".st-x");
      box.insertBefore(pGrp, x); box.insertBefore(pAdm, x);
    } else {
      tabsEl = box.querySelector(".sm-tabs");
      pGrp = box.querySelector(".sm-pane-grp");
      pAdm = box.querySelector(".sm-pane-adm");
    }
    if (!watching) {
      watching = true;
      new MutationObserver(function () {
        if (!sh.classList.contains("show")) restore();
      }).observe(sh, { attributes: true, attributeFilter: ["class"] });
    }
    return true;
  }

  function take(el, into) {
    if (!el || !el.parentNode) return;
    var ph = document.createComment("sm");
    el.parentNode.insertBefore(ph, el);
    var t = el.getAttribute("data-t");
    if (t !== null) { el.removeAttribute("data-t"); el.classList.remove("tabhide"); }
    into.appendChild(el);
    moved.push({ el: el, ph: ph, t: t });
  }

  function restore() {
    if (!moved.length) return;
    moved.forEach(function (m) {
      if (m.t !== null) m.el.setAttribute("data-t", m.t);
      if (m.ph.parentNode) { m.ph.parentNode.insertBefore(m.el, m.ph); m.ph.parentNode.removeChild(m.ph); }
    });
    moved = [];
    try { applyTab(); } catch (e) {}
  }

  function pane(name) {
    box.dataset.pane = name;
    tabsEl.querySelectorAll("button").forEach(function (b) {
      b.setAttribute("aria-selected", String(b.dataset.p === name));
    });
    box.scrollTop = 0;
  }

  function sync() {
    if (!ensure()) return;
    restore();
    var r = role();
    tabsEl.innerHTML = "";
    if (r === "user") { tabsEl.style.display = "none"; box.dataset.pane = "me"; return; }
    tabsEl.style.display = "";
    var list = [["me", "Мои"], ["grp", "Группа"]];
    if (r === "admin") list.push(["adm", "Админ"]);
    list.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button"; b.dataset.p = p[0]; b.textContent = p[1];
      b.setAttribute("role", "tab");
      b.onclick = function () { pane(p[0]); };
      tabsEl.appendChild(b);
    });
    GRP.forEach(function (id) { take(document.getElementById(id), pGrp); });
    if (r === "admin") take(document.getElementById(ADM), pAdm);
    pane("me");
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest("#stTile")) setTimeout(sync, 40);
  });
})();
