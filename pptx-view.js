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
    if (!e) { /* имена в .rels бывают в %-кодировке или с другим регистром */
      var dn = name; try { dn = decodeURIComponent(name); } catch (x) {}
      e = this.ent[dn];
      if (!e) { var lo2 = dn.toLowerCase(); for (var kk in this.ent) if (kk.toLowerCase() === lo2) { e = this.ent[kk]; break; } }
    }
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
    if ((f = kid(sp, "blipFill"))) {
      var bp0 = pth(f, "blip"), rid = bp0 && bp0.getAttributeNS(NSR, "embed");
      if (!rid && bp0) { var sv = bp0.getElementsByTagNameNS("*", "svgBlip")[0]; rid = sv && sv.getAttributeNS(NSR, "embed"); }   // иконки PowerPoint: только svgBlip
      return rid ? { img: rid } : null;
    }
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
  var GEO = { rightArrow: "clip-path:polygon(0 25%,60% 25%,60% 0,100% 50%,60% 100%,60% 75%,0 75%);", leftArrow: "clip-path:polygon(100% 25%,40% 25%,40% 0,0 50%,40% 100%,40% 75%,100% 75%);", downArrow: "clip-path:polygon(25% 0,75% 0,75% 60%,100% 60%,50% 100%,0 60%,25% 60%);", upArrow: "clip-path:polygon(50% 0,100% 40%,75% 40%,75% 100%,25% 100%,25% 40%,0 40%);", chevron: "clip-path:polygon(0 0,75% 0,100% 50%,75% 100%,0 100%,25% 50%);", homePlate: "clip-path:polygon(0 0,80% 0,100% 50%,80% 100%,0 100%);", ellipse: "border-radius:50%;", roundRect: "border-radius:12%;", snipRoundRect: "border-radius:12%;", flowChartTerminator: "border-radius:999px;", triangle: "clip-path:polygon(50% 0,100% 100%,0 100%);", diamond: "clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);", hexagon: "clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%);", parallelogram: "clip-path:polygon(20% 0,100% 0,80% 100%,0 100%);" };

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
    var ext = (/\.([a-z0-9]+)$/i.exec(r.target) || [])[1] || "", mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", jfif: "image/jpeg", jpe: "image/jpeg", tif: "image/tiff", tiff: "image/tiff", avif: "image/avif" }[ext.toLowerCase()];
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
  /* ───────── матрицы 2×2 (формат CSS matrix: [a,b,c,d]) — повороты и отражения фигур/групп ───────── */
  function mMul(A, B) { return [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3]]; }
  function mRot(deg) { var r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c]; }
  function mInv(M) { var d = M[0] * M[3] - M[1] * M[2]; if (!d) return [1, 0, 0, 1]; return [M[3] / d, -M[1] / d, -M[2] / d, M[0] / d]; }
  function mOwn(xf) { return mMul(mMul(mRot(xf.rot || 0), [xf.fh ? -1 : 1, 0, 0, 1]), [1, 0, 0, xf.fv ? -1 : 1]); }
  function mIsId(M) { return Math.abs(M[0] - 1) < 1e-6 && Math.abs(M[1]) < 1e-6 && Math.abs(M[2]) < 1e-6 && Math.abs(M[3] - 1) < 1e-6; }
  function n4(v) { return (+v).toFixed(5); }

  function drawEl(ctx, el, mp) {
    var n = el.localName;
    if (n === "grpSp") {
      var xf = xfrmOf(el);
      var kx = xf && xf.cw ? xf.w / xf.cw : 1, ky = xf && xf.ch ? xf.h / xf.ch : 1;
      if (xf && (xf.rot || xf.fh || xf.fv) && xf.w && xf.h) {
        /* повёрнутая/отражённая группа: рисуем содержимое в отдельном контейнере с тем же преобразованием,
           а текст внутри потом сам себя «выпрямляет» (см. textLayer) */
        var gp = posCss(xf, mp), saved = ctx.anc;
        ctx.out.push('<div class="pv-sh" style="' + gp.css + ";" + gp.tr + '">');
        ctx.anc = { m: mMul(saved.m, mOwn(xf)), rot: saved.rot + (xf.rot || 0), fv: (saved.fv + (xf.fv ? 1 : 0)) % 2 };
        return drawTree(ctx, el, { sx: mp.sx * kx, sy: mp.sy * ky, ox: -xf.cx * kx * mp.sx, oy: -xf.cy * ky * mp.sy }).then(function () {
          ctx.out.push("</div>"); ctx.anc = saved;
        });
      }
      var m2 = mp;
      if (xf && xf.cw && xf.ch) m2 = { sx: mp.sx * kx, sy: mp.sy * ky, ox: mp.ox + mp.sx * (xf.x - xf.cx * kx), oy: mp.oy + mp.sy * (xf.y - xf.cy * ky) };
      return drawTree(ctx, el, m2);
    }
    if (n === "sp" || n === "cxnSp") return drawSp(ctx, el, mp);
    if (n === "pic") return drawPic(ctx, el, mp);
    if (n === "graphicFrame") return drawFrame(ctx, el, mp);
    if (n === "AlternateContent") {
      /* mc:AlternateContent: берём «запасной» вариант (обычно это готовая картинка/фигура), иначе Choice */
      var fb = kid(el, "Fallback"), ch = kid(el, "Choice"), pick = fb && kids(fb).length ? fb : ch;
      if (!pick) return Promise.resolve();
      var chain = Promise.resolve();
      kids(pick).forEach(function (c) { chain = chain.then(function () { return drawEl(ctx, c, mp); }); });
      return chain;
    }
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
      ["anchor", "lIns", "tIns", "rIns", "bIns", "wrap", "rot", "vert", "upright"].forEach(function (k) { var v = at(b, k); if (v != null && v !== "") o[k] = v; });
      var na = kid(b, "normAutofit"); if (na) { o.fit = true; o.scale = nm(na, "fontScale", 100000) / 100000; }
      if (kid(b, "noAutofit") || kid(b, "spAutoFit")) { o.fit = false; o.scale = 1; }
    });
    return o;
  }

  /* ───────── геометрия ───────── */
  var POLY = {
    rightArrow: [[0, 25], [60, 25], [60, 0], [100, 50], [60, 100], [60, 75], [0, 75]],
    leftArrow: [[100, 25], [40, 25], [40, 0], [0, 50], [40, 100], [40, 75], [100, 75]],
    downArrow: [[25, 0], [75, 0], [75, 60], [100, 60], [50, 100], [0, 60], [25, 60]],
    upArrow: [[50, 0], [100, 40], [75, 40], [75, 100], [25, 100], [25, 40], [0, 40]],
    leftRightArrow: [[0, 50], [20, 0], [20, 25], [80, 25], [80, 0], [100, 50], [80, 100], [80, 75], [20, 75], [20, 100]],
    chevron: [[0, 0], [75, 0], [100, 50], [75, 100], [0, 100], [25, 50]],
    homePlate: [[0, 0], [80, 0], [100, 50], [80, 100], [0, 100]],
    pentagon: [[0, 0], [80, 0], [100, 50], [80, 100], [0, 100]],
    triangle: [[50, 0], [100, 100], [0, 100]],
    rtTriangle: [[0, 0], [100, 100], [0, 100]],
    diamond: [[50, 0], [100, 50], [50, 100], [0, 50]],
    flowChartDecision: [[50, 0], [100, 50], [50, 100], [0, 50]],
    hexagon: [[25, 0], [75, 0], [100, 50], [75, 100], [25, 100], [0, 50]],
    parallelogram: [[20, 0], [100, 0], [80, 100], [0, 100]],
    trapezoid: [[20, 0], [80, 0], [100, 100], [0, 100]],
    octagon: [[29, 0], [71, 0], [100, 29], [100, 71], [71, 100], [29, 100], [0, 71], [0, 29]],
    plus: [[33, 0], [67, 0], [67, 33], [100, 33], [100, 67], [67, 67], [67, 100], [33, 100], [33, 67], [0, 67], [0, 33], [33, 33]]
  };
  var ROUND = { roundRect: 1, flowChartAlternateProcess: 1, snipRoundRect: 1, round1Rect: 1, round2SameRect: 1, round2DiagRect: 1, wedgeRoundRectCallout: 1 };
  function avOf(geom, name, d) {
    var l = geom && kid(geom, "avLst"), r = d;
    kids(l, "gd").forEach(function (g) { if (at(g, "name") === name) { var m = /val\s+(-?\d+)/.exec(at(g, "fmla") || ""); if (m) r = +m[1]; } });
    return r;
  }
  function firstCss(c) { var m = /#[0-9a-f]{6}|rgba?\([^)]*\)/i.exec(c || ""); return m ? m[0] : "none"; }
  function polyPts(a) { return a.map(function (p) { return p[0] + "% " + p[1] + "%"; }).join(","); }

  // пользовательская геометрия (рисованные фигуры, «уголки», скобки, выноски) -> SVG
  function custSvg(cust, fill, line, w, h) {
    var paths = kids(pth(cust, "pathLst"), "path"), s = "";
    paths.forEach(function (p) {
      var pw = nm(p, "w", 0), ph = nm(p, "h", 0), sx = pw ? w / pw : 1, sy = ph ? h / ph : 1;
      var d = "", cx = 0, cy = 0;
      function P(pt) { return { x: nm(pt, "x", 0) * sx, y: nm(pt, "y", 0) * sy }; }
      kids(p).forEach(function (c) {
        var t = c.localName, pts = kids(c, "pt").map(P), a;
        if (t === "moveTo" && pts[0]) { d += "M" + pts[0].x + " " + pts[0].y; cx = pts[0].x; cy = pts[0].y; }
        else if (t === "lnTo" && pts[0]) { d += "L" + pts[0].x + " " + pts[0].y; cx = pts[0].x; cy = pts[0].y; }
        else if (t === "cubicBezTo" && pts.length >= 3) { d += "C" + pts[0].x + " " + pts[0].y + "," + pts[1].x + " " + pts[1].y + "," + pts[2].x + " " + pts[2].y; cx = pts[2].x; cy = pts[2].y; }
        else if (t === "quadBezTo" && pts.length >= 2) { d += "Q" + pts[0].x + " " + pts[0].y + "," + pts[1].x + " " + pts[1].y; cx = pts[1].x; cy = pts[1].y; }
        else if (t === "arcTo") {
          var wr = nm(c, "wR", 0) * sx, hr = nm(c, "hR", 0) * sy, st = nm(c, "stAng", 0) / 60000, sw = nm(c, "swAng", 0) / 60000;
          if (wr > 0 && hr > 0 && sw) {
            var par = function (deg) { var r = deg * Math.PI / 180; return Math.atan2(wr * Math.sin(r), hr * Math.cos(r)); };
            var t1 = par(st), t2 = par(st + sw);
            // при полном обороте и больше разбиваем на две дуги
            var ocx = cx - wr * Math.cos(t1), ocy = cy - hr * Math.sin(t1);
            var steps = Math.max(1, Math.ceil(Math.abs(sw) / 180)), part = sw / steps;
            for (var k = 1; k <= steps; k++) {
              var tt = par(st + part * k), ex = ocx + wr * Math.cos(tt), ey = ocy + hr * Math.sin(tt);
              d += "A" + wr + " " + hr + " 0 " + (Math.abs(part) > 180 ? 1 : 0) + " " + (sw > 0 ? 1 : 0) + " " + ex + " " + ey; cx = ex; cy = ey;
            }
          }
        }
        else if (t === "close") d += "Z";
      });
      if (!d) return;
      var f = at(p, "fill") === "none" || !fill || fill.none ? "none" : firstCss(fill.css);
      var strokeOn = at(p, "stroke") !== "0" && line;
      s += '<path d="' + d + '" fill="' + f + '" stroke="' + (strokeOn ? line.c : "none") + '" stroke-width="' + (strokeOn ? line.w : 0) + '" vector-effect="non-scaling-stroke"' + (strokeOn && line.dash && /dash|dot/i.test(line.dash) ? ' stroke-dasharray="' + line.w * 4 + " " + line.w * 3 + '"' : "") + "/>";
    });
    return s ? '<svg class="pv-bg" style="overflow:visible" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none">' + s + "</svg>" : "";
  }

  // линия / соединитель (прямой, угловой, изогнутый) со стрелками на концах
  function drawLineShape(ctx, spPr, style, pos, prst, geom) {
    var lnEl = kid(spPr, "ln");
    if (lnEl && kid(lnEl, "noFill")) return;
    var lc = lineOf(ctx, spPr, style) || { w: 1, c: "#888", dash: "" };
    var w = Math.max(pos.w, 0.1), h = Math.max(pos.h, 0.1), d, sd = [1, 0], ed = [1, 0];
    if (/bentConnector2/.test(prst)) d = "M0 0L" + w + " 0L" + w + " " + h;
    else if (/bentConnector/.test(prst)) { var xm = w * avOf(geom, "adj1", 50000) / 100000; d = "M0 0L" + xm + " 0L" + xm + " " + h + "L" + w + " " + h; }
    else if (/curvedConnector/.test(prst)) d = "M0 0C" + w / 2 + " 0," + w / 2 + " " + h + "," + w + " " + h;
    else { d = "M0 0L" + w + " " + h; var L = Math.sqrt(w * w + h * h) || 1; sd = ed = [w / L, h / L]; }
    var dash = lc.dash && lc.dash !== "solid" ? ' stroke-dasharray="' + lc.w * 4 + " " + lc.w * 3 + '"' : "", extra = "";
    function arrow(type, x, y, dx, dy) {
      if (!type || type === "none") return "";
      var len = Math.max(6, lc.w * 3.5), wd = Math.max(5, lc.w * 3), nx = -dy, ny = dx;
      var bx = x - dx * len, by = y - dy * len;
      return '<polygon points="' + x + "," + y + " " + (bx + nx * wd / 2) + "," + (by + ny * wd / 2) + " " + (bx - nx * wd / 2) + "," + (by - ny * wd / 2) + '" fill="' + lc.c + '"/>';
    }
    extra += arrow(lnEl && kid(lnEl, "tailEnd") ? at(kid(lnEl, "tailEnd"), "type") : "", w, h, ed[0], ed[1]);
    extra += arrow(lnEl && kid(lnEl, "headEnd") ? at(kid(lnEl, "headEnd"), "type") : "", 0, 0, -sd[0], -sd[1]);
    ctx.out.push('<svg class="pv-sh" style="' + pos.css.replace(/width:[^;]+;height:[^;]+/, "width:" + (w + lc.w) + "px;height:" + (h + lc.w) + "px") + ";overflow:visible;" + pos.tr + '"><path d="' + d + '" fill="none" stroke="' + lc.c + '" stroke-width="' + lc.w + '"' + dash + "/>" + extra + "</svg>");
  }

  /* ───────── текст фигуры ─────────
     Правило PowerPoint: текст едет вместе с фигурой (поворот), отражение по горизонтали его не зеркалит,
     отражение по вертикали переворачивает его на 180°; bodyPr rot / vert / upright добавляют свои повороты.
     Поэтому текст кладём в отдельный слой с компенсирующим преобразованием. */
  function textLayer(ctx, el, ph, style, tx, xf, pos, bp) {
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

    // повороты текста
    var vertA = { vert: 90, eaVert: 90, mongolianVert: 90, wordArtVert: 90, wordArtVertRtl: 90, vert270: 270 }[bp.vert] || 0;
    var bodyRot = bp.rot != null ? +bp.rot / 60000 : 0, up = bp.upright === "1" || bp.upright === "true";
    var anc = ctx.anc, fvPar = (anc.fv + (xf.fv ? 1 : 0)) % 2;
    var theta = up ? bodyRot + vertA : (anc.rot + (xf.rot || 0)) + bodyRot + vertA + (fvPar ? 180 : 0);
    var Mtot = mMul(anc.m, mOwn(xf)), T = mMul(mInv(Mtot), mRot(theta));
    var pad = [bp.tIns, bp.rIns, bp.bIns, bp.lIns].map(function (v, i) { return ((v != null ? +v : (i % 2 ? 91440 : 45720)) / EMU).toFixed(2) + "px"; }).join(" ");
    var jc = bp.anchor === "ctr" ? "center" : bp.anchor === "b" ? "flex-end" : "flex-start";
    var st = "justify-content:" + jc + ";padding:" + pad + ";--fs:" + bp.scale;
    if (bp.wrap === "none") st += ";white-space:nowrap";
    if (mIsId(T)) st += ";left:0;top:0;width:100%;height:100%";
    else {
      var sw = Math.abs(T[1]) > 0.7, W = sw ? pos.h : pos.w, H = sw ? pos.w : pos.h;
      st += ";left:50%;top:50%;width:" + W.toFixed(2) + "px;height:" + H.toFixed(2) + "px;transform:translate(-50%,-50%) matrix(" + T.map(n4).join(",") + ",0,0)";
    }
    return '<div class="pv-tw" style="' + st + '"' + (bp.fit ? ' data-fit="1"' : "") + '><div class="pv-tx">' + t.html + "</div></div>";
  }

  function drawSp(ctx, el, mp) {
    var xf = inheritedXfrm(ctx, el);
    if (!xf) return Promise.resolve();
    var ph = getPh(el), spPr = kid(el, "spPr"), style = kid(el, "style"), pos = posCss(xf, mp);
    var geom = pth(spPr, "prstGeom"), cust = pth(spPr, "custGeom"), prst = geom ? at(geom, "prst") : "rect";
    var isLine = (el.localName === "cxnSp" || /^(line|straightConnector1)$/.test(prst) || /Connector/.test(prst)) && !cust;
    if (isLine) { drawLineShape(ctx, spPr, style, pos, prst, geom); return Promise.resolve(); }
    var fill = fillOf(ctx, spPr);
    if (!fill && style) { var fr = kid(style, "fillRef"); if (fr && nm(fr, "idx", 0) > 0) { var cc = firstColor(ctx, fr); if (cc) fill = { css: cc }; } }
    var line = lineOf(ctx, spPr, style);
    var tx = kid(el, "txBody");
    var go = function (img) {
      var bg = "", bgCss = "";
      if (fill && fill.css) bgCss += "background:" + fill.css + ";";
      if (img) bgCss += "background:url(" + img + ") center/100% 100% no-repeat;";
      if (cust) bg = custSvg(cust, img ? null : fill, line, Math.max(pos.w, 0.1), Math.max(pos.h, 0.1));
      else if (POLY[prst]) {
        var pts = polyPts(POLY[prst]);
        bg = '<div class="pv-bg" style="' + bgCss + "clip-path:polygon(" + pts + ');"></div>';
        if (line) bg += '<svg class="pv-bg" style="overflow:visible" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="' + POLY[prst].map(function (p) { return p[0] + "," + p[1]; }).join(" ") + '" fill="none" stroke="' + line.c + '" stroke-width="' + line.w + '" vector-effect="non-scaling-stroke" stroke-linejoin="miter"' + (line.dash && /dash|dot/i.test(line.dash) ? ' stroke-dasharray="' + line.w * 4 + " " + line.w * 3 + '"' : "") + "/></svg>";
      } else {
        var rad = prst === "ellipse" || prst === "flowChartConnector" ? "50%" : prst === "flowChartTerminator" ? "999px" : ROUND[prst] ? (Math.min(pos.w, pos.h) * avOf(geom, "adj", prst === "snipRoundRect" ? 16667 : 16667) / 100000).toFixed(2) + "px" : "";
        var bd = line ? "border:" + line.w + "px " + (line.dash && /dash|dot/i.test(line.dash) ? "dashed" : "solid") + " " + line.c + ";" : "";
        if (bgCss || bd || rad) bg = '<div class="pv-bg" style="' + bgCss + bd + (rad ? "border-radius:" + rad + ";" : "") + '"></div>';
      }
      var inner = "", fit = "";
      var extra = "", txx = kid(el, "txXfrm");
      /* выноски (borderCallout1-3, callout1-3, accent...): рамка + ломаная-указатель */
      var cm = /^(?:accent)?(?:border)?[Cc]allout([123])$/.exec(prst || "") || /^(?:accentBorder|accent|border)Callout([123])$/.exec(prst || "");
      if (cm && !cust) {
        var cn = +cm[1], DEF = { 1: [18750, -8333, 112500, -38333], 2: [18750, -8333, 18750, -16667, 112500, -46667], 3: [18750, -8333, 18750, -16667, 100000, -16667, 112963, -8333] }[cn], cp = [];
        for (var q = 0; q < DEF.length; q += 2) {
          var ay = avOf(geom, "adj" + (q + 1), DEF[q]), ax = avOf(geom, "adj" + (q + 2), DEF[q + 1]);
          cp.push((pos.w * ax / 100000).toFixed(2) + "," + (pos.h * ay / 100000).toFixed(2));
        }
        var cl = line || { w: 1, c: "#000" };
        bg += '<svg class="pv-bg" style="overflow:visible" width="' + pos.w + '" height="' + pos.h + '"><polyline points="' + cp.join(" ") + '" fill="none" stroke="' + cl.c + '" stroke-width="' + cl.w + '" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      }
      if (tx && kids(tx, "p").length) {
        var to = txx && kid(txx, "off"), te = txx && kid(txx, "ext");
        if (to && te) {
          /* SmartArt: у текста своя рамка и поворот (rot текста минус rot фигуры), цвет — обычный чёрный */
          var txf = { x: nm(to, "x", 0), y: nm(to, "y", 0), w: nm(te, "cx", 0), h: nm(te, "cy", 0), cx: 0, cy: 0, cw: 0, ch: 0, rot: nm(txx, "rot", 0) / 60000 - (xf.rot || 0), fh: false, fv: false };
          var tp = posCss(txf, mp);
          extra = '<div class="pv-sh" style="' + tp.css + ";" + tp.tr + '">' + textLayer(ctx, el, ph, null, tx, txf, tp, bodyPrChain(ctx, el, ph)) + "</div>";
        } else inner = textLayer(ctx, el, ph, style, tx, xf, pos, bodyPrChain(ctx, el, ph));
      }
      ctx.out.push('<div class="pv-sh" style="' + pos.css + ";" + pos.tr + '">' + bg + inner + "</div>" + extra);
    };
    if (fill && fill.img) return mediaUrl(ctx, fill.img).then(go);
    go(null); return Promise.resolve();
  }
  function drawPic(ctx, el, mp) {
    var xf = inheritedXfrm(ctx, el);
    if (!xf) return Promise.resolve();
    var pos = posCss(xf, mp), bl = pth(el, "blipFill", "blip"), rid = bl && bl.getAttributeNS(NSR, "embed");
    var svgRid = null;
    if (bl) { var sb = bl.getElementsByTagNameNS("*", "svgBlip")[0]; if (sb) svgRid = sb.getAttributeNS(NSR, "embed"); }
    var spPr = kid(el, "spPr"), geom = pth(spPr, "prstGeom"), prst = geom ? at(geom, "prst") : "rect", ln = lineOf(ctx, spPr, null);
    var first = rid ? mediaUrl(ctx, rid) : Promise.resolve(null);
    return first.then(function (u) { return u || (svgRid ? mediaUrl(ctx, svgRid) : null); }).then(function (u) {
      var sr = pth(el, "blipFill", "srcRect"), css = pos.css + ";" + pos.tr;
      var rad = prst === "ellipse" ? "border-radius:50%;" : ROUND[prst] ? "border-radius:" + (Math.min(pos.w, pos.h) * avOf(geom, "adj", 16667) / 100000).toFixed(2) + "px;" : "";
      var bd = ln ? "border:" + ln.w + "px solid " + ln.c + ";" : "";
      var af = bl && kid(bl, "alphaModFix"), op = af ? "opacity:" + (nm(af, "amt", 100000) / 100000) + ";" : "";
      var flt = bl && kid(bl, "grayscl") ? "filter:grayscale(1);" : "";
      if (!u) { ctx.out.push('<div class="pv-sh pv-miss" style="' + css + '">🖼</div>'); return; }
      var imgCss = "position:absolute;left:0;top:0;width:100%;height:100%;object-fit:fill;" + op + flt;
      if (sr && (nm(sr, "l", 0) || nm(sr, "t", 0) || nm(sr, "r", 0) || nm(sr, "b", 0))) {
        var l = nm(sr, "l", 0) / 1e5, t = nm(sr, "t", 0) / 1e5, r = nm(sr, "r", 0) / 1e5, b = nm(sr, "b", 0) / 1e5, vw = 1 - l - r, vh = 1 - t - b;
        if (vw > 0.01 && vh > 0.01) imgCss = "position:absolute;left:" + (-l / vw * 100) + "%;top:" + (-t / vh * 100) + "%;width:" + (100 / vw) + "%;height:" + (100 / vh) + "%;" + op + flt;
      }
      ctx.out.push('<div class="pv-sh" style="' + css + ";overflow:hidden;" + rad + bd + '"><img alt="" src="' + u + '" style="' + imgCss + '"></div>');
    });
  }
  /* ───────── диаграммы (chartN.xml → SVG): столбцы, линии, области, круговые, кольцевые, точечные ───────── */
  function chTxt(ctx, node, defC) {   // текст из c:tx/c:rich или c:strRef
    var rich = node && node.getElementsByTagNameNS("*", "t"), s = "";
    if (rich && rich.length) { for (var i = 0; i < rich.length; i++) s += rich[i].textContent; return s; }
    var v = node && node.getElementsByTagNameNS("*", "v")[0]; return v ? v.textContent : "";
  }
  function chPts(ref) {   // [{v:"..."}] из strCache/numCache (c:cat, c:val, c:tx)
    var cache = ref && (ref.getElementsByTagNameNS("*", "strCache")[0] || ref.getElementsByTagNameNS("*", "numCache")[0]), out = [];
    if (!cache) return out;
    var cnt = nm(kid(cache, "ptCount"), "val", 0);
    for (var i = 0; i < cnt; i++) out.push(null);
    kids(cache, "pt").forEach(function (p) { var idx = nm(p, "idx", 0), v = kid(p, "v"); out[idx] = v ? v.textContent : null; });
    return out;
  }
  function chFmt(v, code) {
    if (v == null || isNaN(v)) return "";
    var pct = /%/.test(code || ""), d = /0\.(0+)/.exec(code || ""), dec = d ? d[1].length : (Math.abs(v) < 10 && v % 1 ? 1 : 0);
    if (pct) return (v * 100).toFixed(dec) + "%";
    var s = (+v).toFixed(dec), p = s.split(".");
    if (/#,##|# ##/.test(code || "") || Math.abs(v) >= 1000) p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
    return p.join(".");
  }
  function chColor(ctx, spPr, fallback) {
    var f = spPr && kid(spPr, "solidFill"); var c = f && firstColor(ctx, f);
    if (c) return c;
    if (spPr && kid(spPr, "gradFill")) { var g = fillOf(ctx, spPr); if (g && g.css) { var m = /#[0-9a-f]{6}|rgba?\([^)]*\)/i.exec(g.css); if (m) return m[0]; } }
    return fallback;
  }
  function chAccent(ctx, i, n) {
    var th = ctx.m.theme || {}, a = th["accent" + (i % 6 + 1)] || ["4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"][i % 6];
    var r = parseInt(a.substr(0, 2), 16), g = parseInt(a.substr(2, 2), 16), b = parseInt(a.substr(4, 2), 16), k = Math.floor(i / 6);
    if (k) { var f = k % 2 ? 0.7 : 1.3; r = r * f; g = g * f; b = b * f; if (f > 1) { r = Math.min(255, r); g = Math.min(255, g); b = Math.min(255, b); } }
    return "#" + hex2(r) + hex2(g) + hex2(b);
  }
  function drawChart(ctx, pos, gd, part) {
    var cEl = gd.getElementsByTagNameNS("*", "chart")[0], rid = cEl && cEl.getAttributeNS(NSR, "id"), rel = rid && ctx.rels[rid];
    if (!rel || !rel.target) return Promise.resolve(false);
    return ctx.pkg.xml(rel.target).then(function (cs) {
      if (!cs) return false;
      var chart = kid(cs, "chart"), plot = chart && kid(chart, "plotArea");
      if (!plot) return false;
      var W = pos.w, H = pos.h, th = ctx.m.theme || {}, tx1 = "#" + (th[(ctx.m.clrMap && ctx.m.clrMap.tx1) || "dk1"] || "000000");
      var txc = (function () { var tp = kid(cs, "txPr"), d = tp && tp.getElementsByTagNameNS("*", "defRPr")[0], f = d && kid(d, "solidFill"); return (f && firstColor(ctx, f)) || tx1; })();
      var fsz = (function () { var tp = kid(cs, "txPr"), d = tp && tp.getElementsByTagNameNS("*", "defRPr")[0]; return d && nm(d, "sz", 0) ? nm(d, "sz", 1000) / 100 : Math.max(10, Math.min(18, H / 18)); })();
      var svg = [], L = 8, T = 6, R = W - 8, B = H - 6;
      var csp = kid(cs, "spPr"), bgc = csp && !kid(csp, "noFill") && chColor(ctx, csp, null);
      if (bgc) svg.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + bgc + '"/>');
      // заголовок
      var ttl = kid(chart, "title"), atd = at(kid(chart, "autoTitleDeleted"), "val") === "1";
      if (ttl && !atd) {
        var tt = chTxt(ctx, ttl); if (tt) { var tfs = fsz * 1.3; svg.push('<text x="' + W / 2 + '" y="' + (T + tfs) + '" text-anchor="middle" font-size="' + tfs + '" font-weight="700" fill="' + txc + '">' + esc(tt) + "</text>"); T += tfs * 1.7; }
      }
      // типы диаграмм
      var groups = kids(plot).filter(function (g) { return /Chart$/.test(g.localName); });
      if (!groups.length) return false;
      var g0 = groups[0], kind = g0.localName.replace(/^(.*?)(3D)?Chart$/, "$1"), isPie = kind === "pie" || kind === "doughnut" || kind === "ofPie";
      var sers = [];
      groups.forEach(function (g) {
        var k = g.localName.replace(/^(.*?)(3D)?Chart$/, "$1"), bd = kid(g, "barDir");
        kids(g, "ser").forEach(function (s) {
          var cat = kid(s, "cat"), val = kid(s, "val") || kid(s, "yVal"), xv = kid(s, "xVal");
          sers.push({ el: s, kind: k, horiz: bd && at(bd, "val") === "bar", grouping: at(kid(g, "grouping"), "val") || "clustered", name: chTxt(ctx, kid(s, "tx")), cats: chPts(cat || xv), vals: chPts(val).map(function (v) { return v == null || v === "" ? null : +v; }), fc: val && (val.getElementsByTagNameNS("*", "formatCode")[0] || {}).textContent, dl: kid(s, "dLbls") || kid(g, "dLbls"), idx: sers.length });
        });
      });
      if (!sers.length) return false;
      var nPts = Math.max.apply(null, sers.map(function (s) { return s.vals.length; }));
      function dlOf(s) {   // что показывать в подписях данных
        var d = s.dl; if (!d) return null;
        var f = function (n) { return at(kid(d, n), "val") === "1"; };
        if (kid(d, "delete") && at(kid(d, "delete"), "val") === "1") return null;
        if (!(f("showVal") || f("showPercent") || f("showCatName") || f("showSerName"))) return null;
        var dr = d.getElementsByTagNameNS("*", "defRPr")[0], fc = dr && kid(dr, "solidFill");
        return { val: f("showVal"), pct: f("showPercent"), cat: f("showCatName"), ser: f("showSerName"), color: fc && firstColor(ctx, fc), size: dr && nm(dr, "sz", 0) ? nm(dr, "sz", 0) / 100 : null };
      }
      // легенда
      var lg = kid(chart, "legend"), lgPos = lg ? (at(kid(lg, "legendPos"), "val") || "r") : null;
      var items = isPie ? (sers[0].cats.length ? sers[0].cats : sers[0].vals.map(function (_, i) { return "" + (i + 1); })).map(function (c, i) { return { n: c || "", c: null, i: i }; }) : sers.map(function (s, i) { return { n: s.name || ("Ряд " + (i + 1)), c: null, i: i }; });
      function serColor(s, i) { return chColor(ctx, kid(s.el, "spPr"), chAccent(ctx, s.idx)); }
      function dPtCol(s, i, def) {
        var dp = kids(s.el, "dPt").filter(function (d) { return nm(kid(d, "idx"), "val", -1) === i; })[0];
        return chColor(ctx, dp && kid(dp, "spPr"), def);
      }
      function ptColor(s, i) {
        var dp = kids(s.el, "dPt").filter(function (d) { return nm(kid(d, "idx"), "val", -1) === i; })[0];
        return chColor(ctx, dp && kid(dp, "spPr"), chAccent(ctx, i));
      }
      items.forEach(function (it) { it.c = isPie ? ptColor(sers[0], it.i) : serColor(sers[it.i], it.i); });
      var lfs = fsz * 0.95;
      if (lg && lgPos && !(items.length < 2 && !isPie && sers.length < 2 && false)) {
        if (lgPos === "r" || lgPos === "l" || lgPos === "tr") {
          var lw = 0; items.forEach(function (it) { lw = Math.max(lw, it.n.length * lfs * 0.55 + lfs * 1.8); }); lw = Math.min(lw, W * 0.4);
          var lx = lgPos === "l" ? L : R - lw, ly = T + ((B - T) - items.length * lfs * 1.6) / 2;
          items.forEach(function (it, k) { var y = ly + k * lfs * 1.6; svg.push('<rect x="' + lx + '" y="' + (y + lfs * 0.1) + '" width="' + lfs * 0.8 + '" height="' + lfs * 0.8 + '" fill="' + it.c + '"/><text x="' + (lx + lfs * 1.2) + '" y="' + (y + lfs * 0.85) + '" font-size="' + lfs + '" fill="' + txc + '">' + esc(it.n) + "</text>"); });
          if (lgPos === "l") L += lw + 8; else R -= lw + 8;
        } else {
          var rowW = 0; items.forEach(function (it) { rowW += it.n.length * lfs * 0.55 + lfs * 2.4; });
          var ly2 = lgPos === "t" ? T : B - lfs * 1.4, lx2 = Math.max(L, (W - rowW) / 2);
          items.forEach(function (it) { svg.push('<rect x="' + lx2 + '" y="' + (ly2 + lfs * 0.15) + '" width="' + lfs * 0.8 + '" height="' + lfs * 0.8 + '" fill="' + it.c + '"/><text x="' + (lx2 + lfs * 1.2) + '" y="' + (ly2 + lfs * 0.9) + '" font-size="' + lfs + '" fill="' + txc + '">' + esc(it.n) + "</text>"); lx2 += it.n.length * lfs * 0.55 + lfs * 2.4; });
          if (lgPos === "t") T += lfs * 1.8; else B -= lfs * 1.8;
        }
      }
      // ───── круговые / кольцевые
      if (isPie) {
        var s0 = sers[0], tot = 0, vals = s0.vals.map(function (v) { v = Math.max(0, v || 0); tot += v; return v; });
        var cx = (L + R) / 2, cy = (T + B) / 2, rad = Math.max(10, Math.min(R - L, B - T) / 2 - 4), hole = kind === "doughnut" ? rad * (nm(g0.getElementsByTagNameNS("*", "holeSize")[0], "val", 50) / 100) : 0;
        var a = (nm(g0.getElementsByTagNameNS("*", "firstSliceAng")[0], "val", 0) - 90) * Math.PI / 180, dl = dlOf(s0);
        if (!tot) return false;
        vals.forEach(function (v, i) {
          if (!v) return;
          var da = v / tot * Math.PI * 2, a2 = a + da, big = da > Math.PI ? 1 : 0, col = ptColor(s0, i);
          var x1 = cx + rad * Math.cos(a), y1 = cy + rad * Math.sin(a), x2 = cx + rad * Math.cos(a2), y2 = cy + rad * Math.sin(a2), d;
          if (da > Math.PI * 2 - 1e-4) d = "M" + (cx + rad) + " " + cy + "A" + rad + " " + rad + " 0 1 1 " + (cx - rad) + " " + cy + "A" + rad + " " + rad + " 0 1 1 " + (cx + rad) + " " + cy + (hole ? "M" + (cx + hole) + " " + cy + "A" + hole + " " + hole + " 0 1 0 " + (cx - hole) + " " + cy + "A" + hole + " " + hole + " 0 1 0 " + (cx + hole) + " " + cy : "") + "Z";
          else if (hole) { var x3 = cx + hole * Math.cos(a2), y3 = cy + hole * Math.sin(a2), x4 = cx + hole * Math.cos(a), y4 = cy + hole * Math.sin(a); d = "M" + x1 + " " + y1 + "A" + rad + " " + rad + " 0 " + big + " 1 " + x2 + " " + y2 + "L" + x3 + " " + y3 + "A" + hole + " " + hole + " 0 " + big + " 0 " + x4 + " " + y4 + "Z"; }
          else d = "M" + cx + " " + cy + "L" + x1 + " " + y1 + "A" + rad + " " + rad + " 0 " + big + " 1 " + x2 + " " + y2 + "Z";
          svg.push('<path d="' + d + '" fill="' + col + '" stroke="' + (bgc || "#fff") + '" stroke-width="1" fill-rule="evenodd"/>');
          if (dl) {
            var am = a + da / 2, rr = hole ? (rad + hole) / 2 : rad * 0.65, lab = [];
            if (dl.cat) lab.push(s0.cats[i] || ""); if (dl.val) lab.push(chFmt(v, s0.fc)); if (dl.pct) lab.push(Math.round(v / tot * 100) + "%");
            svg.push('<text x="' + (cx + rr * Math.cos(am)) + '" y="' + (cy + rr * Math.sin(am) + fsz * 0.35) + '" text-anchor="middle" font-size="' + (dl.size || fsz) + '" font-weight="700" fill="' + (dl.color || "#fff") + '">' + esc(lab.join(", ")) + "</text>");
          }
          a = a2;
        });
        return { svg: svg, W: W, H: H };
      }
      // ───── оси: столбцы / линии / области / точки
      var horiz = sers.some(function (s) { return s.horiz; }), stacked = sers.some(function (s) { return /stacked|percentStacked/i.test(s.grouping) && (s.kind === "bar" || s.kind === "area"); }), pctSt = sers.some(function (s) { return s.grouping === "percentStacked"; });
      var scatter = sers.some(function (s) { return s.kind === "scatter"; });
      var xsNum = scatter ? sers[0].cats.map(function (v) { return +v; }) : null;
      var tot2 = [], mn = 0, mx = -Infinity;
      for (var p = 0; p < nPts; p++) { var pos0 = 0, neg0 = 0; sers.forEach(function (s) { var v = s.vals[p] || 0; if (stacked) { if (v >= 0) pos0 += v; else neg0 += v; } else { mx = Math.max(mx, v); mn = Math.min(mn, v); } }); if (stacked) { mx = Math.max(mx, pos0); mn = Math.min(mn, neg0); tot2.push(pos0 - neg0); } }
      if (pctSt) { mn = 0; mx = 1; }
      if (!isFinite(mx)) mx = 1;
      var vAx = kid(plot, "valAx"), sc = vAx && kid(vAx, "scaling"), uMin = sc && kid(sc, "min"), uMax = sc && kid(sc, "max");
      if (uMin) mn = nm(uMin, "val", mn); if (uMax) mx = nm(uMax, "val", mx);
      var mu = vAx && kid(vAx, "majorUnit"), step;
      if (mu) step = nm(mu, "val", 0);
      if (!step) { var span = (mx - mn) || 1, pw = Math.pow(10, Math.floor(Math.log(span / 5) / Math.LN10)), r0 = span / 5 / pw; step = (r0 < 1.5 ? 1 : r0 < 3 ? 2 : r0 < 7 ? 5 : 10) * pw; }
      if (!uMax) mx = Math.ceil(mx / step - 1e-9) * step; if (!uMin && mn < 0) mn = Math.floor(mn / step + 1e-9) * step;
      if (mx === mn) mx = mn + step;
      var delV = vAx && at(kid(vAx, "delete"), "val") === "1", delC = (function () { var ca = kid(plot, "catAx") || kid(plot, "dateAx"); return ca && at(kid(ca, "delete"), "val") === "1"; })();
      var fcode = sers[0].fc, labW = delV ? 0 : Math.max(String(chFmt(mx, pctSt ? "0%" : fcode)).length, String(chFmt(mn, pctSt ? "0%" : fcode)).length) * fsz * 0.58 + 6;
      var axFs = fsz * 0.95, catLabH = delC ? 0 : axFs * 1.8;
      var pl = L + (horiz ? 0 : labW), pr = R - (horiz ? Math.max(6, labW / 2) : 6), pt = T + 6, pb = B - (horiz ? 0 : catLabH);
      if (horiz) { var maxCat = 0; sers[0].cats.forEach(function (c) { maxCat = Math.max(maxCat, (c || "").length); }); pl = L + (delC ? 0 : Math.min(maxCat * axFs * 0.55 + 8, (R - L) * 0.4)); pb = B - (delV ? 0 : axFs * 1.8); }
      var cw = pr - pl, ch2 = pb - pt, gcol = "rgba(128,128,128,.35)";
      function vx(v) { return horiz ? pl + (v - mn) / (mx - mn) * cw : 0; }
      function vy(v) { return pb - (v - mn) / (mx - mn) * ch2; }
      // сетка и подписи значений
      for (var tv = mn; tv <= mx + step * 1e-6; tv += step) {
        var lab2 = chFmt(pctSt ? tv : tv, pctSt ? "0%" : fcode);
        if (horiz) { var gx = vx(tv); svg.push('<line x1="' + gx + '" x2="' + gx + '" y1="' + pt + '" y2="' + pb + '" stroke="' + gcol + '"/>'); if (!delV) svg.push('<text x="' + gx + '" y="' + (pb + axFs * 1.3) + '" text-anchor="middle" font-size="' + axFs + '" fill="' + txc + '">' + esc(lab2) + "</text>"); }
        else { var gy = vy(tv); svg.push('<line x1="' + pl + '" x2="' + pr + '" y1="' + gy + '" y2="' + gy + '" stroke="' + gcol + '"/>'); if (!delV) svg.push('<text x="' + (pl - 5) + '" y="' + (gy + axFs * 0.35) + '" text-anchor="end" font-size="' + axFs + '" fill="' + txc + '">' + esc(lab2) + "</text>"); }
        if (step <= 0) break;
      }
      var cats = sers[0].cats, slot = (horiz ? ch2 : cw) / Math.max(nPts, 1), nBar = sers.filter(function (s) { return s.kind === "bar"; }).length, bi = 0;
      var base = Math.max(mn, 0), gap = nm(g0.getElementsByTagNameNS("*", "gapWidth")[0], "val", 150) / 100;
      var bw = stacked ? slot / (1 + gap) : slot / (nBar + gap), cum = [];
      // подписи категорий
      if (!delC) for (var q = 0; q < nPts; q++) {
        var cl = cats[q] != null ? cats[q] : "" + (q + 1), mxc = Math.max(3, Math.floor(slot / (axFs * 0.5))), cs = String(cl);
        if (!horiz && cs.length > mxc && slot < axFs * 6) cs = cs.slice(0, Math.max(2, mxc - 1)) + "…";
        if (horiz) svg.push('<text x="' + (pl - 5) + '" y="' + (pt + slot * q + slot / 2 + axFs * 0.35) + '" text-anchor="end" font-size="' + axFs + '" fill="' + txc + '">' + esc(cs) + "</text>");
        else svg.push('<text x="' + (pl + slot * q + slot / 2) + '" y="' + (pb + axFs * 1.35) + '" text-anchor="middle" font-size="' + axFs + '" fill="' + txc + '">' + esc(cs) + "</text>");
      }
      svg.push('<line x1="' + pl + '" x2="' + (horiz ? pl : pr) + '" y1="' + (horiz ? pt : pb) + '" y2="' + pb + '" stroke="' + txc + '" opacity=".5"/>');
      if (!horiz) svg.push('<line x1="' + pl + '" x2="' + pr + '" y1="' + vy(base) + '" y2="' + vy(base) + '" stroke="' + txc + '" opacity=".5"/>');
      // ряды
      sers.forEach(function (s) {
        var col = serColor(s), dl = dlOf(s), kk = s.kind, pts = [], lnw = (function () { var l = kid(kid(s.el, "spPr"), "ln"); return l && nm(l, "w", 0) ? Math.max(1.5, nm(l, "w", 28575) / EMU) : 2.25; })();
        var isBar = kk === "bar", off = isBar ? (stacked ? 0 : bi - nBar / 2) : 0; if (isBar) bi++;
        s.vals.forEach(function (v, i) {
          if (v == null) { pts.push(null); return; }
          var cx2 = horiz ? 0 : pl + slot * i + slot / 2, cy2 = horiz ? pt + slot * i + slot / 2 : 0, y0, y1, c = dPtCol(s, i, col);
          if (stacked) { var cu = cum[i] || { p: 0, n: 0 }, vv = pctSt ? v / (tot2[i] || 1) : v; y0 = vv >= 0 ? cu.p : cu.n; y1 = y0 + vv; if (vv >= 0) cu.p = y1; else cu.n = y1; cum[i] = cu; }
          else { y0 = base; y1 = v; }
          if (scatter) { var xx = pl + ((+xsNum[i] || i) - Math.min.apply(null, xsNum)) / ((Math.max.apply(null, xsNum) - Math.min.apply(null, xsNum)) || 1) * cw * 0.94 + cw * 0.03; pts.push([xx, vy(v)]); return; }
          if (isBar) {
            if (horiz) { var bx1 = vx(y0), bx2 = vx(y1), by = cy2 - bw * (stacked ? 0.5 : nBar / 2) + (stacked ? 0 : (off + nBar / 2) * bw); svg.push('<rect x="' + Math.min(bx1, bx2) + '" y="' + by + '" width="' + Math.abs(bx2 - bx1) + '" height="' + bw + '" fill="' + c + '"/>'); if (dl) svg.push('<text x="' + (stacked ? (bx1 + bx2) / 2 : Math.max(bx1, bx2) + 4) + '" y="' + (by + bw / 2 + fsz * 0.35) + '" text-anchor="' + (stacked ? "middle" : "start") + '" font-size="' + (dl.size || fsz) + '" fill="' + (dl.color || txc) + '">' + esc(chFmt(v, s.fc)) + "</text>"); }
            else { var by1 = vy(y0), by2 = vy(y1), bx = cx2 - (stacked ? bw / 2 : (nBar * bw) / 2) + (stacked ? 0 : (off + nBar / 2) * bw); svg.push('<rect x="' + bx + '" y="' + Math.min(by1, by2) + '" width="' + bw + '" height="' + Math.max(0.5, Math.abs(by2 - by1)) + '" fill="' + c + '"/>'); if (dl) svg.push('<text x="' + (bx + bw / 2) + '" y="' + (stacked ? (by1 + by2) / 2 + fsz * 0.35 : Math.min(by1, by2) - 4) + '" text-anchor="middle" font-size="' + (dl.size || fsz) + '" fill="' + (dl.color || txc) + '">' + esc(chFmt(v, s.fc)) + "</text>"); }
          } else pts.push([cx2, vy(stacked ? y1 : v), v]);
        });
        if (!isBar) {
          var seg = pts.filter(Boolean);
          if (seg.length) {
            if (kk === "area") { var d2 = "M" + seg[0][0] + " " + vy(base) + seg.map(function (q2) { return "L" + q2[0] + " " + q2[1]; }).join("") + "L" + seg[seg.length - 1][0] + " " + vy(base) + "Z"; svg.push('<path d="' + d2 + '" fill="' + col + '" fill-opacity=".75"/>'); }
            else if (kk !== "scatter" || !(kid(kid(s.el, "spPr"), "ln") && kid(kid(kid(s.el, "spPr"), "ln"), "noFill"))) svg.push('<polyline points="' + seg.map(function (q2) { return q2[0] + "," + q2[1]; }).join(" ") + '" fill="none" stroke="' + col + '" stroke-width="' + lnw + '" stroke-linejoin="round" stroke-linecap="round"/>');
            if (kk === "line" || kk === "scatter") seg.forEach(function (q2) { svg.push('<circle cx="' + q2[0] + '" cy="' + q2[1] + '" r="' + Math.max(3, lnw * 1.4) + '" fill="' + col + '"/>'); });
            if (dl) seg.forEach(function (q2) { svg.push('<text x="' + q2[0] + '" y="' + (q2[1] - 7) + '" text-anchor="middle" font-size="' + (dl.size || fsz) + '" fill="' + (dl.color || txc) + '">' + esc(chFmt(q2[2], s.fc)) + "</text>"); });
          }
        }
      });
      return { svg: svg, W: W, H: H };
    });
  }
  function drawFrame(ctx, el, mp) {
    var xf = xfrmOf(el);
    if (!xf) return Promise.resolve();
    var pos = posCss(xf, mp), gd = pth(el, "graphic", "graphicData"), tbl = gd && kid(gd, "tbl");
    if (!tbl && /diagram/.test(at(gd, "uri") || "")) {
      /* SmartArt: PowerPoint кладёт готовый рисунок схемы в ppt/diagrams/drawingN.xml — рисуем его фигуры внутри рамки */
      var ri = gd.getElementsByTagNameNS("*", "relIds")[0], dmId = ri && ri.getAttributeNS(NSR, "dm");
      var dmRel = dmId && ctx.rels[dmId];
      var miss = function () {
        ctx.out.push('<div class="pv-sh pv-miss" style="' + pos.css + '">🔷 Схема SmartArt<small class=\"pv-sp\" data-pvppt=\"1\">▸ Смотрите через PowerPoint</small></div>');
      };
      return (dmRel && dmRel.target ? ctx.pkg.xml(dmRel.target) : Promise.resolve(null)).then(function (dm) {
        var ext = dm && dm.getElementsByTagNameNS("*", "dataModelExt")[0], rid = ext && ext.getAttribute("relId");
        var dr = (rid && ctx.rels[rid]) || null;
        if (!dr) { for (var k in ctx.rels) if (/diagramDrawing$/.test(ctx.rels[k].type) && !ctx.diagUsed[k]) { dr = ctx.rels[k]; ctx.diagUsed[k] = 1; break; } }
        if (!dr || !dr.target) return miss();
        return ctx.pkg.xml(dr.target).then(function (dx) {
          var tree = dx && (kid(dx, "spTree") || dx.getElementsByTagNameNS("*", "spTree")[0]);
          if (!tree) return miss();
          /* у drawN.xml свой файл связей: именно в нём лежат картинки-иконки и заливки кругов */
          return ctx.pkg.rels(dr.target).then(function (drels) {
            var saveRels = ctx.rels; ctx.rels = drels;
            var done = function () { ctx.rels = saveRels; };
            return drawTree(ctx, tree, { sx: mp.sx, sy: mp.sy, ox: mp.ox + xf.x * mp.sx, oy: mp.oy + xf.y * mp.sy }).then(done, function (e) { done(); throw e; });
          });
        });
      }).catch(function () { miss(); });
    }
    if (!tbl && /chart/.test(at(gd, "uri") || "")) {
      var rot = pos.tr;
      return drawChart(ctx, pos, gd).then(function (r) {
        if (!r) { ctx.out.push('<div class="pv-sh pv-miss" style="' + pos.css + '">📈 Диаграмма<small class=\"pv-sp\" data-pvppt=\"1\">▸ Смотрите через PowerPoint</small></div>'); return; }
        ctx.out.push('<svg class="pv-sh pv-ch" style="' + pos.css + ";" + rot + ';overflow:hidden" viewBox="0 0 ' + r.W + " " + r.H + '" width="' + r.W + '" height="' + r.H + '" font-family="-apple-system,Segoe UI,Roboto,Arial,sans-serif">' + r.svg.join("") + "</svg>");
      }, function () { ctx.out.push('<div class="pv-sh pv-miss" style="' + pos.css + '">📈 Диаграмма<small class=\"pv-sp\" data-pvppt=\"1\">▸ Смотрите через PowerPoint</small></div>'); });
    }
    if (!tbl) {
      var uri = at(gd, "uri") || "";
      ctx.out.push('<div class="pv-sh pv-miss" style="' + pos.css + '">' + (/chart/.test(uri) ? "📈 Диаграмма" : /diagram/.test(uri) ? "🔷 Схема SmartArt" : "▣ Объект") + "<small class=\"pv-sp\" data-pvppt=\"1\">▸ Смотрите через PowerPoint</small></div>");
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
    var ctx = { deck: deck, pkg: deck.pkg, slide: s.xml, rels: s.rels, lay: s.lay, m: s.m, out: [], texts: [], urls: urls, media: media, diagUsed: {}, anc: { m: [1, 0, 0, 1], rot: 0, fv: 0 } };
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
    "#pvView .pv-stage{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;display:block;background:#000}" +
    "#pvView .pv-list{position:relative;display:flex;flex-direction:column;align-items:center;min-width:100%;width:max-content;padding:8px 0 6px;box-sizing:border-box}" +
    "#pvView .pv-fit{margin:0 0 10px;position:relative;flex:none;background:#fff;box-shadow:0 2px 18px rgba(0,0,0,.6)}" +
    "#pvView .pv-fit.ld{background:#1c1c1e}#pvView .pv-fit.ld::after{content:attr(data-n);position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#666;font-size:22px}" +
    "#pvView .pv-slide{position:absolute;left:0;top:0;transform-origin:0 0;overflow:hidden;--fs:1;color:#000;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif}" +
    "#pvView .pv-sh{position:absolute;box-sizing:border-box;margin:0}" +
    "#pvView .pv-tx{width:100%;word-wrap:break-word;overflow-wrap:anywhere}" +
    "#pvView .pv-bg{position:absolute;left:0;top:0;width:100%;height:100%;box-sizing:border-box;margin:0}#pvView .pv-tw{position:absolute;box-sizing:border-box;display:flex;flex-direction:column;overflow:visible}" +
    "#pvView .pv-miss{display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(128,128,128,.12);border:1px dashed rgba(128,128,128,.5);color:#666;font-size:18px;text-align:center}" +
    "#pvView .pv-miss small{font-size:12px;margin-top:4px}#pvView .pv-miss .pv-sp{font-size:15px;font-weight:600;color:#0a84ff;padding:6px 12px;border-radius:999px;background:rgba(10,132,255,.12);cursor:pointer}" +
    "#pvView .pv-tb{position:absolute;border-collapse:collapse;table-layout:fixed;box-sizing:border-box}#pvView .pv-tb td{padding:3px 6px;vertical-align:top;overflow:hidden}" +
    "#pvView .pv-bar{display:flex;align-items:center;justify-content:center;gap:10px;padding:8px 10px calc(env(safe-area-inset-bottom,0px) + 8px);background:#1c1c1e;flex:none}" +
    "#pvView .pv-menu{position:absolute;right:10px;top:calc(env(safe-area-inset-top,0px) + 56px);z-index:5;min-width:240px;padding:6px;background:#2c2c2e;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.6)}" +
    "#pvView .pv-menu button{display:flex;align-items:center;justify-content:flex-start;gap:10px;width:100%;height:46px;padding:0 12px;background:none;border-radius:10px;text-align:left}#pvView .pv-menu button:active{background:#3a3a3c}" +
    "#pvView .pv-go{display:flex;gap:8px;padding:4px}#pvView .pv-go input{flex:1;min-width:0;height:42px;border:0;border-radius:10px;padding:0 12px;font-size:16px;background:#1c1c1e;color:#fff;outline:none}#pvView .pv-go button{width:auto;background:#0a84ff;justify-content:center}" +
    "#pvView .pv-warn{flex:none;background:#2a2112;color:#ffd37a;font-size:14px;border-bottom:1px solid #4a3a16}#pvView .pv-warn summary{list-style:none;cursor:pointer;padding:9px 14px;font-weight:600}#pvView .pv-warn summary::-webkit-details-marker{display:none}#pvView .pv-warn summary::after{content:\" ▸\"}#pvView .pv-warn[open] summary::after{content:\" ▾\"}#pvView .pv-warn div{padding:0 14px 12px;line-height:1.4;color:#f1e3c0}#pvView .pv-warn button{margin-top:8px;background:#0a84ff;width:auto}" +
    "#pvView .pv-toast{position:absolute;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 74px);z-index:6;padding:12px 14px;border-radius:12px;background:#2c2c2e;color:#fff;font-size:14px;line-height:1.4;box-shadow:0 6px 24px rgba(0,0,0,.6)}" +
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
    V.addEventListener("click", function (e) { var t = e.target.closest && e.target.closest("[data-pvppt]"); if (t) { e.preventDefault(); openInPpt(false); } });
    V.innerHTML = '<div class="pv-top"><button type="button" data-a="close" aria-label="Закрыть">✕</button><div class="pv-title"></div>' +
      '<button type="button" data-a="text" aria-label="Текст слайдов">Aa</button><button type="button" data-a="zo" aria-label="Уменьшить">−</button><button type="button" data-a="zi" aria-label="Увеличить">+</button><button type="button" data-a="more" aria-label="Меню">⋯</button></div>' +
      '<div class="pv-stage"><div class="pv-list"></div></div><div class="pv-txt" hidden></div>' +
      '<div class="pv-bar"><button type="button" data-a="prev" aria-label="Назад">‹</button><span class="pv-pg"></span><button type="button" data-a="next" aria-label="Вперёд">›</button></div>';
    document.body.appendChild(V);
    V.addEventListener("click", function (e) {
      var mu = V.querySelector(".pv-menu");
      if (mu && !(e.target.closest && (e.target.closest(".pv-menu") || e.target.closest('[data-a="more"]')))) mu.remove();
      var b = e.target.closest && e.target.closest("[data-a]"); if (!b) return;
      var a = b.dataset.a;
      if (a === "close") close();
      else if (a === "prev") go(st.cur - 1);
      else if (a === "next") go(st.cur + 1);
      else if (a === "zi") zoom(1);
      else if (a === "zo") zoom(-1);
      else if (a === "text") { st.text = !st.text; paintMode(); }
      else if (a === "more") menu();
    });
    document.addEventListener("keydown", function (e) {
      if (!live) return;
      if (e.key === "Escape") { if (V.querySelector(".pv-menu")) closeMenu(); else close(); }
      else if (e.key === "ArrowRight") go(st.cur + 1);
      else if (e.key === "ArrowLeft") go(st.cur - 1);
    });
    // прокрутка: следим, какой слайд сейчас на экране
    var stage = V.querySelector(".pv-stage"), raf = 0;
    stage.addEventListener("scroll", function () {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; updateCur(); });
    }, { passive: true });
    window.addEventListener("resize", relayout);
    window.addEventListener("orientationchange", function () { setTimeout(relayout, 250); });
  }
  // «назад» (Android) закрывает просмотр, а не список лекций под ним; слушатель стоит раньше, чем у lib.js
  var swallow = 0;
  window.addEventListener("popstate", function (e) {
    if (live) { e.stopImmediatePropagation(); live = false; teardown(); return; }
    if (swallow) { swallow = 0; e.stopImmediatePropagation(); }
  });
  function closeMenu() { var m = V && V.querySelector(".pv-menu"); if (m) m.remove(); }
  function copySlide(b) {
    getSlide(st.cur).then(function (r) {
      var t = r ? r.texts.map(function (x) { return x.lines.join("\n"); }).join("\n") : "";
      if (!t) { b.textContent = "На слайде нет текста"; setTimeout(closeMenu, 1200); return; }
      var done = function () { b.textContent = "Скопировано ✓"; setTimeout(closeMenu, 900); };
      var fb = function () {
        var ta = document.createElement("textarea"); ta.value = t; ta.style.cssText = "position:fixed;opacity:0";
        V.appendChild(ta); ta.select();
        try { document.execCommand("copy"); done(); } catch (x) { b.textContent = "Не удалось скопировать"; }
        ta.remove();
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, fb); else fb();
    });
  }
  /* «Открыть как…»: в PowerPoint/другом приложении (системное «Поделиться» → PowerPoint), скачать, текст, слайды */
  function pptFile() {
    var nm0 = (st.name || "presentation").replace(/[\\/:*?"<>|]+/g, "_"); if (!/\.(pptx|ppsx|pptm|ppsm)$/i.test(nm0)) nm0 += ".pptx";
    return { name: nm0, file: (function () { try { return new File([st.blob], nm0, { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }); } catch (e) { return null; } })() };
  }
  function pvToast(t) {
    var o = V.querySelector(".pv-toast"); if (o) o.remove();
    var d = document.createElement("div"); d.className = "pv-toast"; d.textContent = t; V.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.remove(); }, 6000);
  }
  /* цепочка: системное «Поделиться» файлом (там выбирается приложение PowerPoint) → Google Диск (откроется в приложении Диска, оттуда «Открыть в PowerPoint») → скачивание файла */
  function openInPpt(download) {
    var f = pptFile(), link = st.opts && st.opts.link;
    var viaDrive = function () {
      if (!link) return false;
      try { window.open(link, "_blank", "noopener"); } catch (x) { try { location.href = link; } catch (y) { return false; } }
      pvToast("Открыл на Google Диске. В приложении Диска нажмите «Открыть в приложении» или ⋮ → «Открыть с помощью» → PowerPoint.");
      return true;
    };
    var viaFile = function () {
      try {
        var u = URL.createObjectURL(st.blob), a = document.createElement("a"); a.href = u; a.download = f.name; a.rel = "noopener"; a.style.display = "none";
        V.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
        pvToast("Файл «" + f.name + "» сохраняется. Откройте его из «Загрузок» в PowerPoint.");
      } catch (x) { pvToast("Не удалось сохранить файл из встроенного окна. Откройте приложение в обычном браузере."); }
    };
    if (download) { viaFile(); return Promise.resolve(); }
    if (f.file && navigator.canShare && navigator.share) {
      var ok = false; try { ok = navigator.canShare({ files: [f.file] }); } catch (x) {}
      if (ok) return navigator.share({ files: [f.file], title: f.name }).catch(function (e) {
        if (e && e.name === "AbortError") return;
        if (!viaDrive()) viaFile();
      });
    }
    if (!viaDrive()) viaFile();
    return Promise.resolve();
  }
  // меню «⋯»: перейти к слайду, скопировать текст слайда, ссылка на Диск (если передана), закрыть
  function menu() {
    if (V.querySelector(".pv-menu")) { closeMenu(); return; }
    var n = st.deck.slides.length, m = document.createElement("div"); m.className = "pv-menu";
    m.innerHTML = '<button type="button" data-m="goto">🔢 Перейти к слайду…</button><button type="button" data-m="copy">⧉ Копировать текст слайда</button><button type=\"button\" data-m=\"as\">📂 Открыть как…</button>' +
      (st.opts && st.opts.link ? '<button type="button" data-m="link">☁️ Открыть на Google Диске</button>' : "") +
      '<button type="button" data-m="close">✕ Закрыть презентацию</button>';
    m.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-m]"); if (!b) return;
      var k = b.dataset.m;
      if (k === "goto" || k === "as") e.stopPropagation();   /* кнопка исчезает из DOM — иначе внешний обработчик решит, что клик мимо меню, и закроет его */
      if (k === "goto") {
        m.innerHTML = '<div class="pv-go"><input type="number" inputmode="numeric" min="1" max="' + n + '" placeholder="1–' + n + '"><button type="button" data-m="go">Перейти</button></div>';
        var inp = m.querySelector("input"); inp.focus();
        inp.addEventListener("keydown", function (ev) { if (ev.key === "Enter") m.querySelector('[data-m="go"]').click(); });
      } else if (k === "go") {
        var v = parseInt(m.querySelector("input").value, 10);
        if (v >= 1 && v <= n) { closeMenu(); if (st.text) { st.text = false; paintMode(); } go(v - 1); }
      } else if (k === "copy") copySlide(b);
      else if (k === "as") {
        m.innerHTML = '<button type="button" data-m="a-slides">🖼 Слайды</button><button type="button" data-m="a-text">📝 Текст</button><button type="button" data-m="a-ppt">📊 В PowerPoint</button><button type="button" data-m="a-dl">⬇ Скачать файл</button>';
      } else if (k === "a-slides") { closeMenu(); if (st.text) { st.text = false; paintMode(); } }
      else if (k === "a-text") { closeMenu(); if (!st.text) { st.text = true; paintMode(); } }
      else if (k === "a-ppt") { closeMenu(); openInPpt(false); }
      else if (k === "a-dl") { closeMenu(); openInPpt(true); }
      else if (k === "link") { closeMenu(); try { window.open(st.opts.link, "_blank", "noopener"); } catch (x) {} }
      else if (k === "close") { closeMenu(); close(); }
    });
    V.appendChild(m);
  }
  function zoom(d) {
    var z = [1, 1.5, 2, 3], i = Math.max(0, Math.min(z.length - 1, z.indexOf(st.zoom) + d));
    st.zoom = z[i]; relayout();
  }
  function paintMode() {
    V.querySelector(".pv-stage").hidden = st.text;
    V.querySelector(".pv-txt").hidden = !st.text;
    V.querySelector('[data-a="text"]').classList.toggle("on", st.text);
    V.querySelector('[data-a="zi"]').style.display = V.querySelector('[data-a="zo"]').style.display = st.text ? "none" : "";
    if (st.text) buildText(); else if (st.boxes) relayout();
  }
  function getSlide(i) {
    if (!st.cache[i]) st.cache[i] = renderSlide(st.deck, st.deck.slides[i], st.urls, st.media).then(function (x) { st.items[i] = x; return x; }, function () { return null; });
    return st.cache[i];
  }
  function buildText() {
    var d = st.deck, box = V.querySelector(".pv-txt"), p = Promise.resolve();
    box.innerHTML = '<div class="pv-msg">Загрузка…</div>';
    d.slides.forEach(function (_, i) { p = p.then(function () { return st.deck === d ? getSlide(i) : null; }); });
    p.then(function () {
      if (st.deck !== d || !st.text) return;
      var h = "";
      st.items.forEach(function (it, i) {
        if (!it) return;
        h += "<h4>Слайд " + (i + 1) + "</h4>";
        it.texts.forEach(function (b) { b.lines.forEach(function (l) { h += '<p' + (b.title ? ' class="t"' : "") + ">" + esc(l) + "</p>"; }); });
      });
      box.innerHTML = h || '<div class="pv-msg">В презентации нет текста</div>';
    });
  }
  // подгон текста: если не помещается — уменьшаем шрифт
  function fitText(sl) {
    sl.querySelectorAll("[data-fit]").forEach(function (n) {
      var tx = n.firstElementChild; if (!tx) return;
      var cs = getComputedStyle(n), avail = n.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom), fs = parseFloat(n.style.getPropertyValue("--fs")) || 1, tries = 0;
      while (tx.offsetHeight > avail + 1 && fs > 0.35 && tries++ < 14) { fs *= 0.92; n.style.setProperty("--fs", fs.toFixed(3)); }
      n.removeAttribute("data-fit");
    });
  }
  // размеры всех слайдов в ленте (по ширине экрана × масштаб)
  function fit() {
    if (!V || !st.deck || !st.boxes) return;
    var stage = V.querySelector(".pv-stage"), W = st.deck.W / EMU, H = st.deck.H / EMU;
    var k = (stage.clientWidth - 16) / W * st.zoom;
    if (!(k > 0)) return;
    st.boxes.forEach(function (box) {
      box.style.width = (W * k) + "px"; box.style.height = (H * k) + "px";
      var sl = box.firstElementChild;
      if (sl && sl.classList.contains("pv-slide")) { sl.style.transform = "scale(" + k + ")"; fitText(sl); }
    });
  }
  function relayout() {
    if (!V || !st.boxes || st.text) return;
    var i = st.cur, stage = V.querySelector(".pv-stage");
    fit();
    if (st.boxes[i]) stage.scrollTop = i ? st.boxes[i].offsetTop - 8 : 0;
    st.cur = i;
  }
  function paintBar() {
    var n = st.deck ? st.deck.slides.length : 0;
    V.querySelector(".pv-pg").textContent = n ? (st.cur + 1) + " / " + n : "";
    V.querySelector('[data-a="prev"]').disabled = st.cur <= 0;
    V.querySelector('[data-a="next"]').disabled = st.cur >= n - 1;
  }
  function updateCur() {
    if (!st.boxes || st.text) return;
    var stage = V.querySelector(".pv-stage"), y = stage.scrollTop + stage.clientHeight * 0.35, c = 0;
    for (var i = 0; i < st.boxes.length; i++) { if (st.boxes[i].offsetTop <= y) c = i; else break; }
    if (stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 2) c = st.boxes.length - 1;
    if (c !== st.cur) { st.cur = c; paintBar(); }
  }
  function go(i) {
    if (!st.deck || !st.boxes || i < 0 || i >= st.boxes.length) return;
    st.cur = i; paintBar();
    V.querySelector(".pv-stage").scrollTop = i ? st.boxes[i].offsetTop - 8 : 0;
  }
  // слайд рисуется, когда подъезжает к экрану
  function paintBox(i) {
    var box = st.boxes && st.boxes[i], d = st.deck;
    if (!box || box._done || box._busy) return;
    box._busy = true;
    getSlide(i).then(function (r) {
      box._busy = false;
      if (st.deck !== d) return;
      box._done = true; box.classList.remove("ld");
      if (!r) { box.innerHTML = '<div class="pv-msg" style="color:#333">Не удалось отрисовать слайд ' + (i + 1) + "</div>"; return; }
      box.innerHTML = r.html; fit();
    });
  }
  function observe() {
    if (st.io) { st.io.disconnect(); st.io = null; }
    if (!("IntersectionObserver" in window)) { st.boxes.forEach(function (b, i) { paintBox(i); }); return; }
    st.io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) paintBox(+e.target.dataset.i); });
    }, { root: V.querySelector(".pv-stage"), rootMargin: "1500px 0px" });
    st.boxes.forEach(function (b) { st.io.observe(b); });
  }
  function show() {
    var list = V.querySelector(".pv-list"), h = "";
    for (var i = 0; i < st.deck.slides.length; i++) h += '<div class="pv-fit ld" data-i="' + i + '" data-n="' + (i + 1) + '"></div>';
    list.innerHTML = h;
    st.boxes = Array.prototype.slice.call(list.children);
    fit(); observe(); go(0);
  }
  function teardown() {
    st.tok++;
    if (st.io) { st.io.disconnect(); st.io = null; }
    st.urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    st.urls = []; st.media = {}; st.cache = {}; st.items = []; st.deck = null; st.boxes = null;
    if (V) { closeMenu(); V.classList.add("pv-hide"); V.querySelector(".pv-list").innerHTML = ""; }
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
      st.deck = deck; st.cur = 0; st.zoom = 1; st.text = false; st.opts = opts || {}; st.name = name || ""; st.blob = blob;
      st.prevOverflow = document.body.style.overflow; document.body.style.overflow = "hidden";
      V.querySelector(".pv-title").textContent = name || "Презентация";
      var ow = V.querySelector(".pv-warn"); if (ow) ow.remove();
      if (st.opts.warn) {
        var w = document.createElement("details"); w.className = "pv-warn";
        w.innerHTML = '<summary>⚠ Гражданский процесс: отображается не полностью</summary><div>В этих презентациях бывают диаграммы, схемы, анимации и гиф-картинки, которые здесь рисуются упрощённо или не показываются. Если слайд выглядит неверно — смотрите через PowerPoint.<br><button type="button" data-pvppt="1">📊 Смотрите через PowerPoint</button></div>';
        V.querySelector(".pv-top").after(w);
      }
      V.querySelector('[data-a="more"]').style.display = "";
      V.classList.remove("pv-hide"); live = true;
      try { history.pushState({ pv: 1 }, ""); } catch (e) {}
      paintMode(); show();
    });
  }

  window.pptxView = { open: open, close: close, _inflate: inf, _Pkg: Pkg };
})();
