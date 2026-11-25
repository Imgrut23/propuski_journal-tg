/* Просмотр презентаций .pptx / .ppsx прямо в приложении (iPhone, Android, Telegram, офлайн).
   Без внешних библиотек: свой разбор ZIP + отрисовка слайдов (текст, картинки, фигуры, таблицы).
   window.pptxView.open(blob, name, {link}) -> Promise (reject, если файл не удалось разобрать). */
(function () {
  "use strict";
  var NSR = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  var EMU = 12700; // 1 пункт = 12700 EMU; рисуем 1 пункт = 1 px, потом масштабируем

  /* ───────── helpers ───────── */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function kids(el, n) { var o = []; if (!el) return o; for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (!n || c.localName === n) o.push(c); return o; }
  function kid(el, n) { if (!el) return null; for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === n) return c; return null; }
  function pth(el) { for (var i = 1; i < arguments.length && el; i++) el = kid(el, arguments[i]); return el || null; }
  function at(el, n) { return el ? el.getAttribute(n) : null; }
  function nm(el, n, d) { var v = at(el, n); return v == null || v === "" || isNaN(+v) ? d : +v; }
  function resolve(base, target) {
    if (target.charAt(0) === "/") return target.slice(1);
    var parts = base.split("/"); parts.pop();
    target.split("/").forEach(function (s) { if (s === "..") parts.pop(); else if (s && s !== ".") parts.push(s); });
    return parts.join("/");
  }
  function readBuf(blob) {
    return new Promise(function (ok, no) {
      var r = new FileReader();
      r.onload = function () { ok(r.result); };
      r.onerror = function () { no(r.error || new Error("read")); };
      r.readAsArrayBuffer(blob);
    });
  }

  /* ───────── inflate (запасной, если нет DecompressionStream; на базе tinf) ───────── */
  var inf = (function () {
    function Tree() { this.t = new Uint16Array(16); this.s = new Uint16Array(288); }
    var slt = new Tree(), sdt = new Tree(), lbits = new Uint8Array(30), lbase = new Uint16Array(30), dbits = new Uint8Array(30), dbase = new Uint16Array(30);
    var clc = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
    function bb(bits, base, delta, first) {
      var i, sum;
      for (i = 0; i < delta; ++i) bits[i] = 0;
      for (i = 0; i < 30 - delta; ++i) bits[i + delta] = i / delta | 0;
      for (sum = first, i = 0; i < 30; ++i) { base[i] = sum; sum += 1 << bits[i]; }
    }
    function fixed(lt, dt) {
      var i;
      for (i = 0; i < 7; ++i) lt.t[i] = 0;
      lt.t[7] = 24; lt.t[8] = 152; lt.t[9] = 112;
      for (i = 0; i < 24; ++i) lt.s[i] = 256 + i;
      for (i = 0; i < 144; ++i) lt.s[24 + i] = i;
      for (i = 0; i < 8; ++i) lt.s[24 + 144 + i] = 280 + i;
      for (i = 0; i < 112; ++i) lt.s[24 + 144 + 8 + i] = 144 + i;
      for (i = 0; i < 5; ++i) dt.t[i] = 0;
      dt.t[5] = 32;
      for (i = 0; i < 32; ++i) dt.s[i] = i;
    }
    function build(t, len, off, num) {
      var i, sum, offs = new Uint16Array(16);
      for (i = 0; i < 16; ++i) t.t[i] = 0;
      for (i = 0; i < num; ++i) t.t[len[off + i]]++;
      t.t[0] = 0;
      for (sum = 0, i = 0; i < 16; ++i) { offs[i] = sum; sum += t.t[i]; }
      for (i = 0; i < num; ++i) if (len[off + i]) t.s[offs[len[off + i]]++] = i;
    }
    function getbit(d) { if (!d.bc--) { d.tag = d.src[d.sp++]; d.bc = 7; } var b = d.tag & 1; d.tag >>>= 1; return b; }
    function bits(d, num, base) {
      if (!num) return base;
      while (d.bc < 24) { d.tag |= d.src[d.sp++] << d.bc; d.bc += 8; }
      var v = d.tag & (0xffff >>> (16 - num)); d.tag >>>= num; d.bc -= num; return v + base;
    }
    function sym(d, t) {
      while (d.bc < 24) { d.tag |= d.src[d.sp++] << d.bc; d.bc += 8; }
      var sum = 0, cur = 0, len = 0, tag = d.tag;
      do { cur = 2 * cur + (tag & 1); tag >>>= 1; ++len; sum += t.t[len]; cur -= t.t[len]; } while (cur >= 0);
      d.tag = d.tag >>> len; d.bc -= len;
      return t.s[sum + cur];
    }
    function trees(d, lt, dt) {
      var ct = new Tree(), hlit = bits(d, 5, 257), hdist = bits(d, 5, 1), hclen = bits(d, 4, 4), lens = new Uint8Array(320), i, num, length;
      for (i = 0; i < hclen; ++i) lens[clc[i]] = bits(d, 3, 0);
      build(ct, lens, 0, 19);
      for (num = 0; num < hlit + hdist;) {
        var s = sym(d, ct), prev;
        if (s === 16) { prev = lens[num - 1]; for (length = bits(d, 2, 3); length; --length) lens[num++] = prev; }
        else if (s === 17) { for (length = bits(d, 3, 3); length; --length) lens[num++] = 0; }
        else if (s === 18) { for (length = bits(d, 7, 11); length; --length) lens[num++] = 0; }
        else lens[num++] = s;
      }
      build(lt, lens, 0, hlit); build(dt, lens, hlit, hdist);
    }
    function block(d, lt, dt) {
      for (;;) {
        var s = sym(d, lt);
        if (s === 256) return;
        if (s < 256) d.out[d.n++] = s;
        else {
          s -= 257;
          var len = bits(d, lbits[s], lbase[s]), dist = sym(d, dt), off = d.n - bits(d, dbits[dist], dbase[dist]);
          for (var i = off; i < off + len; ++i) d.out[d.n++] = d.out[i];
        }
      }
    }
    function raw(d) {
      while (d.bc > 8) { d.sp--; d.bc -= 8; }
      var len = d.src[d.sp + 1] * 256 + d.src[d.sp];
      d.sp += 4;
      for (var i = len; i; --i) d.out[d.n++] = d.src[d.sp++];
      d.bc = 0;
    }
    fixed(slt, sdt); bb(lbits, lbase, 4, 3); bb(dbits, dbase, 2, 1); lbits[28] = 0; lbase[28] = 258;
    return function (src, size) {
      var d = { src: src, sp: 0, tag: 0, bc: 0, out: new Uint8Array(size), n: 0 }, fin, type;
      var lt = new Tree(), dt = new Tree();
      do {
        fin = getbit(d); type = bits(d, 2, 0);
        if (type === 0) raw(d);
        else if (type === 1) block(d, slt, sdt);
        else if (type === 2) { trees(d, lt, dt); block(d, lt, dt); }
        else throw new Error("inflate");
      } while (!fin);
      return d.out;
    };
  })();

  function inflateRaw(src, size) {
    if (typeof DecompressionStream === "function") {
      try {
        var ds = new DecompressionStream("deflate-raw");
        return new Response(new Blob([src]).stream().pipeThrough(ds)).arrayBuffer().then(function (b) { return new Uint8Array(b); }, function () { return inf(src, size); });
      } catch (e) { /* ниже */ }
    }
    return Promise.resolve().then(function () { return inf(src, size); });
  }

  /* ───────── ZIP ───────── */
  function Pkg(buf) {
    this.u8 = new Uint8Array(buf);
    var dv = this.dv = new DataView(buf), n = this.u8.length, i, eocd = -1;
    for (i = n - 22; i >= Math.max(0, n - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("not zip");
    var cnt = dv.getUint16(eocd + 10, true), off = dv.getUint32(eocd + 16, true);
    this.ent = {};
    var dec = new TextDecoder("utf-8");
    for (var k = 0; k < cnt; k++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      var flags = dv.getUint16(off + 8, true), method = dv.getUint16(off + 10, true), csz = dv.getUint32(off + 20, true), usz = dv.getUint32(off + 24, true),
        nl = dv.getUint16(off + 28, true), el = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true), lo = dv.getUint32(off + 42, true);
      var name = dec.decode(this.u8.subarray(off + 46, off + 46 + nl));
      this.ent[name] = { method: method, csz: csz, usz: usz, lo: lo, flags: flags };
      off += 46 + nl + el + cl;
    }
  }
  Pkg.prototype.has = function (n) { return !!this.ent[n]; };
  Pkg.prototype.bytes = function (name) {
    var e = this.ent[name], self = this;
    if (!e) return Promise.resolve(null);
    var lo = e.lo;
    if (this.dv.getUint32(lo, true) !== 0x04034b50) return Promise.reject(new Error("zip header"));
    var start = lo + 30 + this.dv.getUint16(lo + 26, true) + this.dv.getUint16(lo + 28, true);
    var data = this.u8.subarray(start, start + e.csz);
    if (e.method === 0) return Promise.resolve(data);
    if (e.method === 8) return inflateRaw(data, e.usz);
    return Promise.reject(new Error("zip method " + e.method));
  };
  Pkg.prototype.xml = function (name) {
    return this.bytes(name).then(function (b) {
      if (!b) return null;
      var t = new TextDecoder("utf-8").decode(b);
      if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
      var d = new DOMParser().parseFromString(t, "application/xml");
      if (d.getElementsByTagName("parsererror").length) return null;
      return d.documentElement;
    });
  };
  Pkg.prototype.rels = function (part) {
    var p = part.split("/"), f = p.pop(), rp = p.concat(["_rels", f + ".rels"]).join("/");
    return this.xml(rp).then(function (x) {
      var m = {};
      kids(x, "Relationship").forEach(function (r) {
        m[r.getAttribute("Id")] = { type: r.getAttribute("Type") || "", target: r.getAttribute("TargetMode") === "External" ? null : resolve(part, r.getAttribute("Target") || ""), ext: r.getAttribute("TargetMode") === "External" ? r.getAttribute("Target") : null };
      });
      return m;
    });
  };
  function relOfType(rels, t) { for (var k in rels) if (new RegExp("/" + t + "$").test(rels[k].type)) return rels[k]; return null; }

  /* ───────── цвета ───────── */
  function hex2(n) { n = Math.max(0, Math.min(255, Math.round(n))); return (n < 16 ? "0" : "") + n.toString(16); }
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), h = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) {
      var d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6;
    }
    return [h, s, l];
  }
  function hsl2rgb(h, s, l) {
    function f(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }
    if (!s) return [l * 255, l * 255, l * 255];
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
  }
  var PRST = { black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF", yellow: "FFFF00", gray: "808080", grey: "808080", orange: "FFA500", purple: "800080" };
  function colorOf(ctx, c, ph) {
    if (!c) return null;
    var hex = null, ln = c.localName;
    if (ln === "srgbClr") hex = at(c, "val");
    else if (ln === "sysClr") hex = at(c, "lastClr") || (at(c, "val") === "window" ? "FFFFFF" : "000000");
    else if (ln === "prstClr") hex = PRST[at(c, "val")] || "000000";
    else if (ln === "schemeClr") {
      var v = at(c, "val");
      if (v === "phClr") hex = ph || "000000";
      else { var m = ctx.m.clrMap[v] || v; hex = ctx.m.theme[m] || (m === "lt1" || m === "bg1" ? "FFFFFF" : "000000"); }
    } else return null;
    if (!hex || hex.length !== 6) hex = "000000";
    var r = parseInt(hex.substr(0, 2), 16), g = parseInt(hex.substr(2, 2), 16), b = parseInt(hex.substr(4, 2), 16), alpha = 1;
    for (var ch = c.firstElementChild; ch; ch = ch.nextElementSibling) {
      var val = nm(ch, "val", 100000) / 100000, n = ch.localName;
      if (n === "lumMod" || n === "lumOff") {
        var hsl = rgb2hsl(r, g, b);
        if (n === "lumMod") hsl[2] *= val; else hsl[2] += val;
        hsl[2] = Math.max(0, Math.min(1, hsl[2]));
        var o = hsl2rgb(hsl[0], hsl[1], hsl[2]); r = o[0]; g = o[1]; b = o[2];
      } else if (n === "tint") { r = r * val + 255 * (1 - val); g = g * val + 255 * (1 - val); b = b * val + 255 * (1 - val); }
      else if (n === "shade") { r *= val; g *= val; b *= val; }
      else if (n === "alpha") alpha = val;
    }
    return alpha < 1 ? "rgba(" + Math.round(r) + "," + Math.round(g) + "," + Math.round(b) + "," + alpha.toFixed(2) + ")" : "#" + hex2(r) + hex2(g) + hex2(b);
  }
  function firstColor(ctx, parent, ph) {
    for (var c = parent && parent.firstElementChild; c; c = c.nextElementSibling) { var x = colorOf(ctx, c, ph); if (x) return x; }
    return null;
  }
  // заливка из spPr/bgPr: {css} | {none:true} | null (не задана)
  function fillOf(ctx, sp, ph) {
    if (!sp) return null;
    var f;
    if (kid(sp, "noFill")) return { none: true };
    if ((f = kid(sp, "solidFill"))) { var c = firstColor(ctx, f, ph); return c ? { css: c } : null; }
    if ((f = kid(sp, "gradFill"))) {
      var st = kids(pth(f, "gsLst"), "gs").map(function (g) { return (nm(g, "pos", 0) / 1000) + "|" + firstColor(ctx, g, ph); });
      if (!st.length) return null;
      var lin = kid(f, "lin"), ang = lin ? nm(lin, "ang", 0) / 60000 + 90 : 180;
      return { css: "linear-gradient(" + ang + "deg," + st.map(function (s) { var p = s.split("|"); return p[1] + " " + p[0] + "%"; }).join(",") + ")" };
    }
    if ((f = kid(sp, "pattFill"))) { var fg = firstColor(ctx, kid(f, "fgClr"), ph); return fg ? { css: fg } : null; }
    if ((f = kid(sp, "blipFill"))) { var rid = pth(f, "blip") && pth(f, "blip").getAttributeNS(NSR, "embed"); return rid ? { img: rid } : null; }
    return null;
  }

  /* ───────── загрузка пакета ───────── */
  function loadMaster(pkg, part, cache) {
    if (cache[part]) return cache[part];
    return (cache[part] = pkg.xml(part).then(function (xml) {
      return pkg.rels(part).then(function (rels) {
        var th = relOfType(rels, "theme"), m = { part: part, xml: xml, rels: rels, theme: {}, clrMap: {} };
        var cm = kid(xml, "clrMap");
        if (cm) for (var i = 0; i < cm.attributes.length; i++) m.clrMap[cm.attributes[i].name] = cm.attributes[i].value;
        if (!th) return m;
        return pkg.xml(th.target).then(function (t) {
          var cs = pth(t, "themeElements", "clrScheme");
          kids(cs).forEach(function (c) { var x = c.firstElementChild; if (x) m.theme[c.localName] = at(x, "val") && x.localName === "srgbClr" ? at(x, "val") : at(x, "lastClr") || "000000"; });
          return m;
        });
      });
    }));
  }
  function loadLayout(pkg, part, cache, mcache) {
    if (cache[part]) return cache[part];
    return (cache[part] = pkg.xml(part).then(function (xml) {
      return pkg.rels(part).then(function (rels) {
        var mr = relOfType(rels, "slideMaster");
        return (mr ? loadMaster(pkg, mr.target, mcache) : Promise.resolve({ xml: null, theme: {}, clrMap: {}, rels: {} })).then(function (m) {
          return { part: part, xml: xml, rels: rels, m: m };
        });
      });
    }));
  }
  function loadDeck(pkg) {
    return pkg.xml("ppt/presentation.xml").then(function (pres) {
      if (!pres) throw new Error("no presentation");
      return pkg.rels("ppt/presentation.xml").then(function (prels) {
        var sz = kid(pres, "sldSz"), deck = { W: nm(sz, "cx", 9144000), H: nm(sz, "cy", 5143500), dts: kid(pres, "defaultTextStyle"), slides: [], pkg: pkg };
        var ids = kids(pth(pres, "sldIdLst"), "sldId"), lc = {}, mc = {};
        var chain = Promise.resolve();
        ids.forEach(function (id) {
          chain = chain.then(function () {
            var r = prels[id.getAttributeNS(NSR, "id")];
            if (!r || !r.target) return;
            return pkg.xml(r.target).then(function (sx) {
              if (!sx) return;
              return pkg.rels(r.target).then(function (srels) {
                var lr = relOfType(srels, "slideLayout");
                return (lr ? loadLayout(pkg, lr.target, lc, mc) : Promise.resolve({ xml: null, rels: {}, m: { xml: null, theme: {}, clrMap: {}, rels: {} } })).then(function (lay) {
                  deck.slides.push({ part: r.target, xml: sx, rels: srels, lay: lay, m: lay.m });
                });
              });
            });
          });
        });
        return chain.then(function () { if (!deck.slides.length) throw new Error("no slides"); return deck; });
      });
    });
  }

  /* ───────── разметка и текст ───────── */
  function getPh(el) {
    var nv = el.firstElementChild, nvPr = nv && kid(nv, "nvPr"), ph = nvPr && kid(nvPr, "ph");
    return ph ? { type: at(ph, "type") || "body", idx: at(ph, "idx") } : null;
  }
  function spTreeOf(root) { return pth(root, "cSld", "spTree"); }
  function findPh(tree, ph, master) {
    if (!tree || !ph) return null;
    var best = null, norm = function (t) { return t === "ctrTitle" ? "title" : t === "subTitle" || t === "obj" || t === "tbl" || t === "chart" || t === "pic" ? "body" : t; };
    for (var c = tree.firstElementChild; c; c = c.nextElementSibling) {
      var p = getPh(c); if (!p) continue;
      if (!master && ph.idx != null && p.idx === ph.idx) return c;
      if (norm(p.type) === norm(ph.type) && (master || ph.idx == null || p.idx == null || !best)) { if (!best) best = c; }
    }
    return best;
  }
  function xfrmOf(el) {
    var x = kid(el, "xfrm") || pth(el, "spPr", "xfrm") || pth(el, "grpSpPr", "xfrm");
    if (!x) return null;
    var o = kid(x, "off"), e = kid(x, "ext"), co = kid(x, "chOff"), ce = kid(x, "chExt");
    if (!o || !e) return null;
    return { x: nm(o, "x", 0), y: nm(o, "y", 0), w: nm(e, "cx", 0), h: nm(e, "cy", 0), cx: co ? nm(co, "x", 0) : 0, cy: co ? nm(co, "y", 0) : 0, cw: ce ? nm(ce, "cx", 0) : 0, ch: ce ? nm(ce, "cy", 0) : 0, rot: nm(x, "rot", 0) / 60000, fh: at(x, "flipH") === "1", fv: at(x, "flipV") === "1" };
  }
  function applyR(o, r, ctx, ph) {
    if (!r) return;
    ["sz", "b", "i", "u", "strike", "baseline"].forEach(function (n) { var v = at(r, n); if (v != null && v !== "") o[n] = v; });
    var f = kid(r, "solidFill"); if (f) { var c = firstColor(ctx, f, ph); if (c) o.color = c; }
    var l = kid(r, "latin"); if (l && at(l, "typeface") && at(l, "typeface").charAt(0) !== "+") o.font = at(l, "typeface");
  }
  function applyP(o, p, ctx) {
    if (!p) return;
    ["algn", "marL", "indent"].forEach(function (n) { var v = at(p, n); if (v != null && v !== "") o[n] = v; });
    applyR(o, kid(p, "defRPr"), ctx);
    for (var c = p.firstElementChild; c; c = c.nextElementSibling) {
      var n = c.localName;
      if (n === "buNone") o.bu = null;
      else if (n === "buChar") o.bu = { t: "c", ch: at(c, "char") || "•" };
      else if (n === "buAutoNum") o.bu = { t: "n", ty: at(c, "type") || "arabicPeriod", st: nm(c, "startAt", 1) };
      else if (n === "buClr") o.buClr = firstColor(ctx, c);
      else if (n === "lnSpc") { var pc = kid(c, "spcPct"), pt = kid(c, "spcPts"); o.ln = pc ? { pct: nm(pc, "val", 100000) / 100000 } : pt ? { pt: nm(pt, "val", 0) / 100 } : o.ln; }
      else if (n === "spcBef" || n === "spcAft") { var q = kid(c, "spcPct"), w = kid(c, "spcPts"); o[n] = q ? { pct: nm(q, "val", 0) / 100000 } : w ? { pt: nm(w, "val", 0) / 100 } : o[n]; }
    }
  }
  function lvlProps(sources, lvl, ctx, ph) {
    var o = {};
    sources.forEach(function (S) { var p = kid(S, "lvl" + (lvl + 1) + "pPr"); if (p) applyP(o, p, ctx); });
    return o;
  }
  function numLabel(ty, n) {
    var s;
    if (/alpha/i.test(ty)) { s = String.fromCharCode((/Uc/.test(ty) ? 65 : 97) + (n - 1) % 26); }
    else if (/roman/i.test(ty)) { var r = ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx"]; s = r[n] || String(n); if (/Uc/.test(ty)) s = s.toUpperCase(); }
    else s = String(n);
    return /ParenBoth/.test(ty) ? "(" + s + ")" : /ParenR/.test(ty) ? s + ")" : s + ".";
  }
  var ALIGN = { l: "left", ctr: "center", r: "right", just: "justify", dist: "justify" };

  // txBody -> { html, texts[] }
  function textHtml(ctx, tx, sources, ph, defColor, forceColor) {
    var html = "", texts = [], counters = [];
    kids(tx, "p").forEach(function (p) {
      var pPr = kid(p, "pPr"), lvl = nm(pPr, "lvl", 0), o = lvlProps(sources, lvl, ctx, ph);
      if (forceColor) o.color = defColor;   // цвет из стиля фигуры (fontRef) важнее общих настроек презентации
      applyP(o, pPr, ctx);
      var size = o.sz ? +o.sz / 100 : 18, runs = "", plain = "", firstColor1 = null;
      var runNodes = [];
      for (var c = p.firstElementChild; c; c = c.nextElementSibling) if (c.localName === "r" || c.localName === "br" || c.localName === "fld") runNodes.push(c);
      runNodes.forEach(function (rn) {
        if (rn.localName === "br") { runs += "<br>"; plain += "\n"; return; }
        var t = (kid(rn, "t") || {}).textContent || "";
        var ro = {}; for (var k in o) ro[k] = o[k];
        applyR(ro, kid(rn, "rPr"), ctx, ph);
        var sz = ro.sz ? +ro.sz / 100 : 18, st = "font-size:calc(" + sz + "px*var(--fs))";
        if (ro.b === "1") st += ";font-weight:700";
        if (ro.i === "1") st += ";font-style:italic";
        var dec = []; if (ro.u && ro.u !== "none") dec.push("underline"); if (ro.strike && ro.strike !== "noStrike") dec.push("line-through");
        if (dec.length) st += ";text-decoration:" + dec.join(" ");
        st += ";color:" + (ro.color || defColor);
        if (ro.font) st += ";font-family:'" + esc(ro.font) + "',-apple-system,'Segoe UI',Roboto,Arial,sans-serif";
        var bl = ro.baseline ? +ro.baseline : 0;
        if (bl > 0) st += ";vertical-align:super;font-size:calc(" + (sz * 0.65) + "px*var(--fs))"; else if (bl < 0) st += ";vertical-align:sub;font-size:calc(" + (sz * 0.65) + "px*var(--fs))";
        if (!firstColor1 && t) firstColor1 = ro.color || defColor;
        runs += '<span style="' + st + '">' + esc(t) + "</span>"; plain += t;
      });
      // маркер
      var marL = o.marL != null ? +o.marL / EMU : 0, ind = o.indent != null ? +o.indent / EMU : 0, bul = "";
      var hasText = plain.replace(/\s/g, "") !== "";
      if (o.bu && hasText) {
        var lab;
        if (o.bu.t === "n") {
          counters.length = lvl + 1; counters[lvl] = (counters[lvl] || o.bu.st - 1) + 1; lab = numLabel(o.bu.ty, counters[lvl]);
        } else { counters.length = lvl + 1; lab = o.bu.ch === "§" || o.bu.ch === "Ø" || o.bu.ch === "ü" || o.bu.ch === "v" ? "•" : o.bu.ch; }
        var bw = ind < 0 ? -ind : Math.max(size, 14);
        bul = '<span class="pv-bu" style="display:inline-block;text-indent:0;min-width:calc(' + bw + 'px*var(--fs));color:' + (o.buClr || firstColor1 || o.color || defColor) + ';font-size:calc(' + size + 'px*var(--fs))">' + esc(lab) + "</span>";
      } else if (hasText) { counters.length = lvl; }
      if (!runNodes.length || !hasText && !runs) {
        var ep = {}; applyR(ep, kid(p, "endParaRPr"), ctx, ph);
        var es = ep.sz ? +ep.sz / 100 : size;
        runs = '<span style="font-size:calc(' + es + "px*var(--fs))\">&#8203;</span>";
      }
      var st2 = "text-align:" + (ALIGN[o.algn] || "left") + ";margin:0";
      var pl = Math.max(0, marL);
      st2 += ";padding-left:" + pl + "px";
      if (o.bu && hasText && ind < 0) st2 += ";text-indent:" + ind + "px";
      else if (ind) st2 += ";text-indent:" + ind + "px";
      if (o.ln) st2 += ";line-height:" + (o.ln.pct ? (o.ln.pct * 1.2).toFixed(3) : "calc(" + o.ln.pt + "px*var(--fs))");
      else st2 += ";line-height:1.2";
      var sb = o.spcBef; if (sb) st2 += ";margin-top:calc(" + (sb.pt != null ? sb.pt : sb.pct * size) + "px*var(--fs))";
      var sa = o.spcAft; if (sa) st2 += ";margin-bottom:calc(" + (sa.pt != null ? sa.pt : sa.pct * size) + "px*var(--fs))";
      html += '<div class="pv-p" style="' + st2 + '">' + bul + runs + "</div>";
      if (hasText) texts.push(plain);
    });
    return { html: html, texts: texts };
  }

  /* ───────── фигуры ───────── */
  function posCss(xf, mp) {
    var x = mp.ox + xf.x * mp.sx, y = mp.oy + xf.y * mp.sy, w = xf.w * mp.sx, h = xf.h * mp.sy;
    var s = "left:" + (x / EMU).toFixed(2) + "px;top:" + (y / EMU).toFixed(2) + "px;width:" + (w / EMU).toFixed(2) + "px;height:" + (h / EMU).toFixed(2) + "px";
    var tr = [];
    if (xf.rot) tr.push("rotate(" + xf.rot + "deg)");
    if (xf.fh) tr.push("scaleX(-1)");
    if (xf.fv) tr.push("scaleY(-1)");
    return { css: s, tr: tr.length ? "transform:" + tr.join(" ") + ";" : "", w: w / EMU, h: h / EMU };
  }
  var GEO = { ellipse: "border-radius:50%;", roundRect: "border-radius:12%;", snipRoundRect: "border-radius:12%;", flowChartTerminator: "border-radius:999px;", triangle: "clip-path:polygon(50% 0,100% 100%,0 100%);", diamond: "clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);", hexagon: "clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%);", parallelogram: "clip-path:polygon(20% 0,100% 0,80% 100%,0 100%);" };

  function lineOf(ctx, spPr, style, ph) {
    var ln = kid(spPr, "ln"), w = 0, col = null;
    if (ln) {
      if (kid(ln, "noFill")) return null;
      w = nm(ln, "w", 12700) / EMU;
      var f = kid(ln, "solidFill"); if (f) col = firstColor(ctx, f, ph);
    }
    var lr = style && kid(style, "lnRef");
    if (!col && lr && nm(lr, "idx", 0) > 0) { col = firstColor(ctx, lr, ph); if (!w) w = 1; }
    if (!col) return null;   // <a:ln/> без заливки — линии нет
    return { w: Math.max(w, 0.75), c: col, dash: ln && kid(ln, "prstDash") ? at(kid(ln, "prstDash"), "val") : "" };
  }

  function mediaUrl(ctx, rid) {
    var r = ctx.rels[rid]; if (!r || !r.target) return Promise.resolve(null);
    if (ctx.media[r.target] !== undefined) return ctx.media[r.target];
    var ext = (/\.([a-z0-9]+)$/i.exec(r.target) || [])[1] || "", mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp" }[ext.toLowerCase()];
    if (!mime) return (ctx.media[r.target] = Promise.resolve(null));
    return (ctx.media[r.target] = ctx.pkg.bytes(r.target).then(function (b) {
      if (!b) return null;
      var u = URL.createObjectURL(new Blob([b], { type: mime })); ctx.urls.push(u); return u;
    }));
  }

  // возвращает Promise<void>; HTML складывает в ctx.out, текст — в ctx.texts
  function drawTree(ctx, tree, mp) {
    var chain = Promise.resolve();
    for (var c = tree.firstElementChild; c; c = c.nextElementSibling) (function (el) { chain = chain.then(function () { return drawEl(ctx, el, mp); }); })(c);
    return chain;
  }
  function drawEl(ctx, el, mp) {
    var n = el.localName;
    if (n === "grpSp") {
      var xf = xfrmOf(el), m2 = mp;
      if (xf && xf.cw && xf.ch) {
        var kx = xf.w / xf.cw, ky = xf.h / xf.ch;
        m2 = { sx: mp.sx * kx, sy: mp.sy * ky, ox: mp.ox + mp.sx * (xf.x - xf.cx * kx), oy: mp.oy + mp.sy * (xf.y - xf.cy * ky) };
      }
      return drawTree(ctx, el, m2);
    }
    if (n === "sp" || n === "cxnSp") return drawSp(ctx, el, mp);
    if (n === "pic") return drawPic(ctx, el, mp);
    if (n === "graphicFrame") return drawFrame(ctx, el, mp);
    return Promise.resolve();
  }
  function inheritedXfrm(ctx, el) {
    var x = xfrmOf(el); if (x) return x;
    var ph = getPh(el); if (!ph) return null;
    var l = findPh(spTreeOf(ctx.lay.xml), ph, false), lx = l && xfrmOf(l);
    if (lx) return lx;
    var m = findPh(spTreeOf(ctx.m.xml), ph, true);
    return m && xfrmOf(m);
  }
  function bodyPrChain(ctx, el, ph) {
    var out = [];
    var m = ph && findPh(spTreeOf(ctx.m.xml), ph, true), l = ph && findPh(spTreeOf(ctx.lay.xml), ph, false);
    [m, l, el].forEach(function (s) { var b = s && pth(s, "txBody", "bodyPr"); if (b) out.push(b); });
    var o = { fit: false, scale: 1 };
    out.forEach(function (b) {
      ["anchor", "lIns", "tIns", "rIns", "bIns", "wrap"].forEach(function (k) { var v = at(b, k); if (v != null && v !== "") o[k] = v; });
      var na = kid(b, "normAutofit"); if (na) { o.fit = true; o.scale = nm(na, "fontScale", 100000) / 100000; }
      if (kid(b, "noAutofit") || kid(b, "spAutoFit")) { o.fit = false; o.scale = 1; }
    });
    return o;
  }
  function drawSp(ctx, el, mp) {
    var xf = inheritedXfrm(ctx, el);
    if (!xf) return Promise.resolve();
    var ph = getPh(el), spPr = kid(el, "spPr"), style = kid(el, "style"), pos = posCss(xf, mp);
    var geom = pth(spPr, "prstGeom"), prst = geom ? at(geom, "prst") : "rect";
    var isLine = el.localName === "cxnSp" || prst === "line" || prst === "straightConnector1";
    var fill = fillOf(ctx, spPr);
    if (!fill && style) { var fr = kid(style, "fillRef"); if (fr && nm(fr, "idx", 0) > 0) { var cc = firstColor(ctx, fr); if (cc) fill = { css: cc }; } }
    var line = lineOf(ctx, spPr, style);
    if (isLine) {
      var lc = line || { w: 1, c: "#888" }, w = Math.max(pos.w, 0.1), h = Math.max(pos.h, 0.1);
      var x1 = 0, y1 = 0, x2 = w, y2 = h;
      ctx.out.push('<svg class="pv-sh" style="' + pos.css.replace(/width:[^;]+;height:[^;]+/, "width:" + (w + lc.w) + "px;height:" + (h + lc.w) + "px") + ";overflow:visible;" + pos.tr + '"><line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + lc.c + '" stroke-width="' + lc.w + '"' + (lc.dash && lc.dash !== "solid" ? ' stroke-dasharray="' + lc.w * 4 + " " + lc.w * 3 + '"' : "") + "/></svg>");
      return Promise.resolve();
    }
    var tx = kid(el, "txBody"), st = pos.css + ";" + pos.tr, inner = "";
    var go = function (img) {
      if (fill && fill.css) st += ";background:" + fill.css;
      if (img) st += ";background:url(" + img + ") center/100% 100% no-repeat";
      if (line) st += ";border:" + line.w + "px " + (line.dash && /dash|dot/i.test(line.dash) ? "dashed" : "solid") + " " + line.c;
      st += ";" + (GEO[prst] || "");
      var bp = bodyPrChain(ctx, el, ph), cls = "pv-sh", fit = "";
      if (tx && kids(tx, "p").length) {
        var phM = ph && findPh(spTreeOf(ctx.m.xml), ph, true), phL = ph && findPh(spTreeOf(ctx.lay.xml), ph, false);
        var ts = ctx.m.xml && kid(ctx.m.xml, "txStyles"), src = [ctx.deck.dts];
        if (ph) src.push(kid(ts, /title/i.test(ph.type) ? "titleStyle" : /^(sldNum|dt|ftr)$/.test(ph.type) ? "otherStyle" : "bodyStyle"));
        if (phM) src.push(pth(phM, "txBody", "lstStyle"));
        if (phL) src.push(pth(phL, "txBody", "lstStyle"));
        src.push(kid(tx, "lstStyle"));
        var dc = "#000000", fromStyle = false;
        var sr = style && kid(style, "fontRef"); if (sr) { var fc = firstColor(ctx, sr); if (fc) { dc = fc; fromStyle = true; } }
        if (!fromStyle) { var tmp = document.createElementNS("http://schemas.openxmlformats.org/drawingml/2006/main", "schemeClr"); tmp.setAttribute("val", "tx1"); dc = colorOf(ctx, tmp) || "#000000"; }
        var t = textHtml(ctx, tx, src.filter(Boolean), ph, dc, fromStyle);
        if (t.texts.length) ctx.texts.push({ title: !!ph && /title/i.test(ph.type), lines: t.texts });
        var pad = [bp.tIns, bp.rIns, bp.bIns, bp.lIns].map(function (v, i) { return ((v != null ? +v : (i % 2 ? 91440 : 45720)) / EMU).toFixed(2) + "px"; }).join(" ");
        var jc = bp.anchor === "ctr" ? "center" : bp.anchor === "b" ? "flex-end" : "flex-start";
        st += ";display:flex;flex-direction:column;justify-content:" + jc + ";padding:" + pad + ";overflow:hidden;--fs:" + bp.scale;
        if (bp.wrap === "none") st += ";white-space:nowrap";
        if (bp.fit) fit = ' data-fit="1"';
        inner = '<div class="pv-tx">' + t.html + "</div>";
      }
      ctx.out.push('<div class="' + cls + '" style="' + st + '"' + fit + ">" + inner + "</div>");
    };
    if (fill && fill.img) return mediaUrl(ctx, fill.img).then(go);
    go(null); return Promise.resolve();
  }
  function drawPic(ctx, el, mp) {
    var xf = inheritedXfrm(ctx, el);
    if (!xf) return Promise.resolve();
    var pos = posCss(xf, mp), bl = pth(el, "blipFill", "blip"), rid = bl && bl.getAttributeNS(NSR, "embed");
    return (rid ? mediaUrl(ctx, rid) : Promise.resolve(null)).then(function (u) {
      var sr = pth(el, "blipFill", "srcRect"), css = pos.css + ";" + pos.tr;
      if (u && sr && (nm(sr, "l", 0) || nm(sr, "t", 0) || nm(sr, "r", 0) || nm(sr, "b", 0))) {
        var l = nm(sr, "l", 0) / 1e5, t = nm(sr, "t", 0) / 1e5, r = nm(sr, "r", 0) / 1e5, b = nm(sr, "b", 0) / 1e5, vw = 1 - l - r, vh = 1 - t - b;
        if (vw > 0.01 && vh > 0.01) {
          ctx.out.push('<div class="pv-sh" style="' + css + ";overflow:hidden\"><img alt=\"\" src=\"" + u + '" style="position:absolute;left:' + (-l / vw * 100) + "%;top:" + (-t / vh * 100) + "%;width:" + (100 / vw) + "%;height:" + (100 / vh) + '%"></div>');
          return;
        }
      }
      if (u) ctx.out.push('<img class="pv-sh" alt="" src="' + u + '" style="' + css + ';object-fit:fill">');
      else ctx.out.push('<div class="pv-sh pv-miss" style="' + css + '">🖼</div>');
    });
  }
  function drawFrame(ctx, el, mp) {
    var xf = xfrmOf(el);
    if (!xf) return Promise.resolve();
    var pos = posCss(xf, mp), gd = pth(el, "graphic", "graphicData"), tbl = gd && kid(gd, "tbl");
    if (!tbl) {
      var uri = at(gd, "uri") || "";
      ctx.out.push('<div class="pv-sh pv-miss" style="' + pos.css + '">' + (/chart/.test(uri) ? "📈 Диаграмма" : /diagram/.test(uri) ? "🔷 Схема SmartArt" : "▣ Объект") + "<small>показывается в PowerPoint</small></div>");
      return Promise.resolve();
    }
    var cols = kids(kid(tbl, "tblGrid"), "gridCol").map(function (g) { return nm(g, "w", 0) * mp.sx / EMU; });
    var h = '<table class="pv-tb" style="' + pos.css.replace(/height:[^;]+/, "") + '"><colgroup>' + cols.map(function (w) { return '<col style="width:' + w.toFixed(1) + 'px">'; }).join("") + "</colgroup>";
    var tsx = [ctx.deck.dts].filter(Boolean);
    kids(tbl, "tr").forEach(function (tr, ri) {
      h += '<tr style="height:' + (nm(tr, "h", 0) * mp.sy / EMU).toFixed(1) + 'px">';
      kids(tr, "tc").forEach(function (tc) {
        if (at(tc, "hMerge") === "1" || at(tc, "vMerge") === "1") return;
        var tcPr = kid(tc, "tcPr"), f = fillOf(ctx, tcPr), st = "";
        if (f && f.css) st += "background:" + f.css + ";";
        var ln = kid(tcPr, "lnB") || kid(tcPr, "lnL"), lc = ln && kid(ln, "solidFill") && firstColor(ctx, kid(ln, "solidFill"));
        st += "border:" + (lc ? Math.max(0.75, nm(ln, "w", 12700) / EMU) + "px solid " + lc : "1px solid rgba(128,128,128,.35)") + ";";
        var tt = textHtml(ctx, kid(tc, "txBody"), tsx, null, "#000000");
        if (tt.texts.length) ctx.texts.push({ title: false, lines: tt.texts });
        h += '<td style="' + st + '"' + (at(tc, "gridSpan") ? ' colspan="' + at(tc, "gridSpan") + '"' : "") + (at(tc, "rowSpan") ? ' rowspan="' + at(tc, "rowSpan") + '"' : "") + ">" + tt.html + "</td>";
      });
      h += "</tr>";
    });
    ctx.out.push(h + "</table>");
    return Promise.resolve();
  }

  function slideBg(ctx) {
    var chain = [ctx.slide, ctx.lay.xml, ctx.m.xml];
    for (var i = 0; i < chain.length; i++) {
      var bg = pth(chain[i], "cSld", "bg"); if (!bg) continue;
      var pr = kid(bg, "bgPr"), f = pr && fillOf(ctx, pr);
      if (f && f.css) return Promise.resolve(f.css);
      if (f && f.img) { var rels = ctx.rels; ctx.rels = i === 0 ? ctx.rels : i === 1 ? ctx.lay.rels : ctx.m.rels; return mediaUrl(ctx, f.img).then(function (u) { ctx.rels = rels; return u ? "url(" + u + ") center/100% 100% no-repeat" : "#fff"; }); }
      var ref = kid(bg, "bgRef"); if (ref) { var c = firstColor(ctx, ref); if (c) return Promise.resolve(c); }
    }
    return Promise.resolve("#ffffff");
  }
  // отрисовать слайд -> { html, texts }
  function renderSlide(deck, s, urls, media) {
    var ctx = { deck: deck, pkg: deck.pkg, slide: s.xml, rels: s.rels, lay: s.lay, m: s.m, out: [], texts: [], urls: urls, media: media };
    var W = deck.W / EMU, H = deck.H / EMU;
    return slideBg(ctx).then(function (bg) {
      // фигуры мастера/макета без плейсхолдеров (логотипы, линии) под содержимым слайда
      var pre = Promise.resolve();
      [[s.m.xml, s.m.rels], [s.lay.xml, s.lay.rels]].forEach(function (pair) {
        pre = pre.then(function () {
          var tree = spTreeOf(pair[0]); if (!tree) return;
          var saveRels = ctx.rels, saveTexts = ctx.texts; ctx.rels = pair[1]; ctx.texts = [];
          var chain = Promise.resolve();
          for (var c = tree.firstElementChild; c; c = c.nextElementSibling) (function (el) {
            if (el.localName === "sp" || el.localName === "pic" || el.localName === "cxnSp" || el.localName === "grpSp") {
              if (getPh(el)) return;
              chain = chain.then(function () { return drawEl(ctx, el, { sx: 1, sy: 1, ox: 0, oy: 0 }); });
            }
          })(c);
          return chain.then(function () { ctx.rels = saveRels; ctx.texts = saveTexts; });
        });
      });
      return pre.then(function () {
        var tree = spTreeOf(ctx.slide);
        return tree ? drawTree(ctx, tree, { sx: 1, sy: 1, ox: 0, oy: 0 }) : null;
      }).then(function () {
        return { html: '<div class="pv-slide" style="width:' + W + "px;height:" + H + "px;background:" + bg + '">' + ctx.out.join("") + "</div>", texts: ctx.texts, W: W, H: H };
      });
    });
  }

  /* ───────── интерфейс ───────── */
  var CSS = "#pvView{position:fixed;inset:0;z-index:2147483000;background:#111;color:#fff;display:flex;flex-direction:column;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;-webkit-tap-highlight-color:transparent}" +
    "#pvView.pv-hide,#pvView [hidden]{display:none!important}" +
    "#pvView .pv-top{display:flex;align-items:center;gap:6px;padding:calc(env(safe-area-inset-top,0px) + 8px) 10px 8px;background:#1c1c1e;flex:none}" +
    "#pvView .pv-title{flex:1;min-width:0;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    "#pvView button{font:inherit;color:#fff;background:#2c2c2e;border:0;border-radius:10px;min-width:40px;height:38px;padding:0 12px;font-size:15px;cursor:pointer;touch-action:manipulation}" +
    "#pvView button:active{background:#3a3a3c}#pvView button[disabled]{opacity:.35}" +
    "#pvView button.on{background:#0a84ff}" +
    "#pvView .pv-stage{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;display:flex;background:#000}" +
    "#pvView .pv-fit{margin:auto;position:relative;flex:none;background:#fff;box-shadow:0 2px 18px rgba(0,0,0,.6)}" +
    "#pvView .pv-slide{position:absolute;left:0;top:0;transform-origin:0 0;overflow:hidden;--fs:1;color:#000;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif}" +
    "#pvView .pv-sh{position:absolute;box-sizing:border-box;margin:0}" +
    "#pvView .pv-tx{width:100%;word-wrap:break-word;overflow-wrap:anywhere}" +
    "#pvView .pv-miss{display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(128,128,128,.12);border:1px dashed rgba(128,128,128,.5);color:#666;font-size:18px;text-align:center}" +
    "#pvView .pv-miss small{font-size:12px;margin-top:4px}" +
    "#pvView .pv-tb{position:absolute;border-collapse:collapse;table-layout:fixed;box-sizing:border-box}#pvView .pv-tb td{padding:3px 6px;vertical-align:top;overflow:hidden}" +
    "#pvView .pv-bar{display:flex;align-items:center;justify-content:center;gap:10px;padding:8px 10px calc(env(safe-area-inset-bottom,0px) + 8px);background:#1c1c1e;flex:none}" +
    "#pvView .pv-pg{min-width:76px;text-align:center;font-size:14px;color:#ddd}" +
    "#pvView .pv-txt{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;padding:14px 16px 28px;background:#111;line-height:1.45;font-size:16px}" +
    "#pvView .pv-txt h4{margin:22px 0 6px;color:#8ab4ff;font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}" +
    "#pvView .pv-txt p{margin:0 0 8px;white-space:pre-wrap}#pvView .pv-txt p.t{font-weight:700;font-size:18px}" +
    "#pvView .pv-msg{margin:auto;padding:24px;text-align:center;color:#ccc}";

  var V = null, st = { deck: null, items: [], cur: 0, zoom: 1, text: false, urls: [], media: {}, cache: {}, tok: 0, opts: null, name: "" };
  var live = false;

  function build() {
    if (V) return;
    var s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s);
    V = document.createElement("div"); V.id = "pvView"; V.className = "pv-hide";
    V.setAttribute("role", "dialog"); V.setAttribute("aria-label", "Презентация");
    V.innerHTML = '<div class="pv-top"><button type="button" data-a="close" aria-label="Закрыть">✕</button><div class="pv-title"></div>' +
      '<button type="button" data-a="text" aria-label="Текст слайдов">Aa</button><button type="button" data-a="zo" aria-label="Уменьшить">−</button><button type="button" data-a="zi" aria-label="Увеличить">+</button><button type="button" data-a="more" aria-label="Открыть в другом приложении">⋯</button></div>' +
      '<div class="pv-stage"><div class="pv-fit"></div></div><div class="pv-txt" hidden></div>' +
      '<div class="pv-bar"><button type="button" data-a="prev" aria-label="Назад">‹</button><span class="pv-pg"></span><button type="button" data-a="next" aria-label="Вперёд">›</button></div>';
    document.body.appendChild(V);
    V.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-a]"); if (!b) return;
      var a = b.dataset.a;
      if (a === "close") close();
      else if (a === "prev") go(st.cur - 1);
      else if (a === "next") go(st.cur + 1);
      else if (a === "zi") zoom(1);
      else if (a === "zo") zoom(-1);
      else if (a === "text") { st.text = !st.text; paintMode(); }
      else if (a === "more" && st.opts && st.opts.more) st.opts.more();
    });
    document.addEventListener("keydown", function (e) {
      if (!live) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" || e.key === "PageDown") go(st.cur + 1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(st.cur - 1);
    });
    // свайп влево/вправо (когда слайд не увеличен)
    var x0 = 0, y0 = 0, t0 = 0, stage = V.querySelector(".pv-stage");
    stage.addEventListener("touchstart", function (e) { if (e.touches.length !== 1) { t0 = 0; return; } x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); }, { passive: true });
    stage.addEventListener("touchend", function (e) {
      if (!t0 || st.zoom > 1 || !e.changedTouches.length) return;
      var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      if (Date.now() - t0 < 700 && Math.abs(dx) > 50 && Math.abs(dy) < 60) go(st.cur + (dx < 0 ? 1 : -1));
      t0 = 0;
    }, { passive: true });
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", function () { setTimeout(fit, 250); });
  }
  // «назад» (Android) закрывает просмотр, а не список лекций под ним; слушатель стоит раньше, чем у lib.js
  var swallow = 0;
  window.addEventListener("popstate", function (e) {
    if (live) { e.stopImmediatePropagation(); live = false; teardown(); return; }
    if (swallow) { swallow = 0; e.stopImmediatePropagation(); }
  });
  function zoom(d) {
    var z = [1, 1.5, 2, 3], i = Math.max(0, Math.min(z.length - 1, z.indexOf(st.zoom) + d));
    st.zoom = z[i]; fit();
  }
  function paintMode() {
    V.querySelector(".pv-stage").hidden = st.text;
    V.querySelector(".pv-txt").hidden = !st.text;
    V.querySelector('[data-a="text"]').classList.toggle("on", st.text);
    V.querySelector('[data-a="zi"]').style.display = V.querySelector('[data-a="zo"]').style.display = st.text ? "none" : "";
    if (st.text) buildText(); else fit();
  }
  function buildText() {
    var h = "";
    st.items.forEach(function (it, i) {
      if (!it) return;
      h += "<h4>Слайд " + (i + 1) + "</h4>";
      it.texts.forEach(function (b) { b.lines.forEach(function (l) { h += '<p' + (b.title ? ' class="t"' : "") + ">" + esc(l) + "</p>"; }); });
    });
    V.querySelector(".pv-txt").innerHTML = h || '<div class="pv-msg">В презентации нет текста</div>';
  }
  function fit() {
    if (!V || !st.deck) return;
    var stage = V.querySelector(".pv-stage"), box = V.querySelector(".pv-fit"), sl = box.firstElementChild;
    if (!sl || !sl.classList.contains("pv-slide")) return;
    var W = st.deck.W / EMU, H = st.deck.H / EMU, aw = stage.clientWidth - 16, ah = stage.clientHeight - 16;
    var k = Math.min(aw / W, ah / H) * st.zoom;
    if (!(k > 0)) return;
    box.style.width = (W * k) + "px"; box.style.height = (H * k) + "px";
    sl.style.transform = "scale(" + k + ")";
    // подгон текста: если не помещается — уменьшаем шрифт
    sl.querySelectorAll("[data-fit]").forEach(function (n) {
      var tx = n.firstElementChild; if (!tx) return;
      var cs = getComputedStyle(n), avail = n.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom), fs = parseFloat(n.style.getPropertyValue("--fs")) || 1, tries = 0;
      while (tx.offsetHeight > avail + 1 && fs > 0.35 && tries++ < 14) { fs *= 0.92; n.style.setProperty("--fs", fs.toFixed(3)); }
      n.removeAttribute("data-fit");
    });
  }
  function paintBar() {
    var n = st.deck ? st.deck.slides.length : 0;
    V.querySelector(".pv-pg").textContent = n ? (st.cur + 1) + " / " + n : "";
    V.querySelector('[data-a="prev"]').disabled = st.cur <= 0;
    V.querySelector('[data-a="next"]').disabled = st.cur >= n - 1;
  }
  function go(i) {
    if (!st.deck || i < 0 || i >= st.deck.slides.length) return;
    st.cur = i; show();
  }
  function show() {
    var tok = ++st.tok, i = st.cur, box = V.querySelector(".pv-fit"), stage = V.querySelector(".pv-stage");
    paintBar();
    var done = function (r) {
      if (tok !== st.tok || !live) return;
      st.items[i] = r;
      box.innerHTML = r.html; stage.scrollTop = 0; stage.scrollLeft = 0;
      fit();
      if (st.text) buildText();
      // заранее готовим следующий слайд
      if (i + 1 < st.deck.slides.length && !st.cache[i + 1]) st.cache[i + 1] = renderSlide(st.deck, st.deck.slides[i + 1], st.urls, st.media).then(function (x) { st.items[i + 1] = x; return x; }, function () { return null; });
    };
    if (!st.cache[i]) st.cache[i] = renderSlide(st.deck, st.deck.slides[i], st.urls, st.media);
    st.cache[i].then(done, function () {
      if (tok !== st.tok) return;
      box.innerHTML = ""; box.style.width = "auto"; box.style.height = "auto";
      box.innerHTML = '<div class="pv-msg" style="color:#333">Не удалось отрисовать слайд ' + (i + 1) + "</div>";
    });
  }
  function teardown() {
    st.tok++;
    st.urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    st.urls = []; st.media = {}; st.cache = {}; st.items = []; st.deck = null;
    if (V) { V.classList.add("pv-hide"); V.querySelector(".pv-fit").innerHTML = ""; }
    document.documentElement.classList.remove("pv-lock");
    document.body.style.overflow = st.prevOverflow || "";
  }
  function close() {
    if (!live) return;
    live = false; teardown();
    try { if (history.state && history.state.pv) { swallow = 1; history.back(); } } catch (e) {}
  }

  function open(blob, name, opts) {
    build();
    return readBuf(blob).then(function (buf) {
      var pkg = new Pkg(buf);
      return loadDeck(pkg);
    }).then(function (deck) {
      if (live) { live = false; teardown(); }
      st.deck = deck; st.cur = 0; st.zoom = 1; st.text = false; st.opts = opts || {}; st.name = name || "";
      st.prevOverflow = document.body.style.overflow; document.body.style.overflow = "hidden";
      V.querySelector(".pv-title").textContent = name || "Презентация";
      V.querySelector('[data-a="more"]').style.display = opts && opts.more ? "" : "none";
      V.classList.remove("pv-hide"); live = true;
      try { history.pushState({ pv: 1 }, ""); } catch (e) {}
      paintMode(); show();
    });
  }

  window.pptxView = { open: open, close: close, _inflate: inf, _Pkg: Pkg };
})();
