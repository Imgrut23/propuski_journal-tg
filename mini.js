/* Минимализм + объединение вкладок. Настройки хранятся в localStorage. */
(function(){
  var K_MINI="absence:mini",K_MERGE="absence:merge";
  var get=function(k,d){try{var v=localStorage.getItem(k);return v===null?d:v==="1"}catch(e){return d}};
  var set=function(k,v){try{localStorage.setItem(k,v?"1":"0")}catch(e){}};
  var st=window.MINI={mini:true,merge:true};
  var navOrig=null,started=false;

  function retag(){
    // добавляем вкладке-«хозяину» элементы объединяемых вкладок
    document.querySelectorAll("[data-t]").forEach(function(el){
      if(el.dataset.t0===undefined)el.dataset.t0=el.dataset.t;
      var parts=el.dataset.t0.split(" ");
      if(st.merge){
        if(el.closest("#user-view")&&(parts.indexOf("me")>-1||parts.indexOf("grp")>-1))parts.push("mark");
        if(el.closest("#head")&&parts.indexOf("stats")>-1)parts.push("today");
      }
      el.dataset.t=parts.join(" ");
    });
  }

  function apply(){
    document.documentElement.classList.toggle("mini",st.mini);
    try{
      if(!navOrig)navOrig=JSON.stringify(NAVS);
      var N=JSON.parse(navOrig);
      if(st.merge){
        N.user=[["diary","Дневник"],["mark","Журнал"]];
        N.head=[["diary","Дневник"],["today","Журнал"],["self","Моя"],["set","Группа"]];
        if(tab==="me"||tab==="grp")tab="mark";
        if(tab==="stats")tab="today";
        if(!started){started=true;if(!isHead&&!isGuest)tab="diary"}
      }
      NAVS.user=N.user;NAVS.head=N.head;NAVS.guest=N.guest;
      navKey=null;
    }catch(e){}
    retag();
    try{applyTab();if(me)render()}catch(e){}
    paintTiles();
    killGlass();
    if(!st.mini){try{applyGlass()}catch(e){}}
  }

  function tile(id,label,key){
    var g=document.querySelector("#sheet .sheet-grid");
    if(!g||document.getElementById(id))return;
    var b=document.createElement("button");
    b.type="button";b.id=id;b.className="tile";b.setAttribute("aria-pressed","false");
    b.innerHTML="<span>◐</span>"+label;
    b.onclick=function(){st[key]=!st[key];set(key==="mini"?K_MINI:K_MERGE,st[key]);apply()};
    g.insertBefore(b,g.firstChild);
  }
  function paintTiles(){
    [["miniTile","mini"],["mergeTile","merge"]].forEach(function(p){
      var b=document.getElementById(p[0]);if(!b)return;
      b.setAttribute("aria-pressed",st[p[1]]?"true":"false");
      b.style.fontWeight=st[p[1]]?"700":"";
    });
  }

  // стекло: полностью убираем, пока включён минимализм
  var rootEl=document.documentElement;
  function killGlass(){
    if(!st.mini)return;
    if(rootEl.classList.contains("glass-theme")||rootEl.classList.contains("glass-on"))rootEl.classList.remove("glass-theme","glass-on");
    var g=document.getElementById("glassToggle");if(g)g.style.display="none";
  }
  new MutationObserver(killGlass).observe(rootEl,{attributes:true,attributeFilter:["class"]});
  killGlass();

  // настройки: чистим эмодзи, добавляем раздел «Интерфейс»
  var K_DENSE="absence:dense";
  st.dense=get(K_DENSE,false);
  rootEl.classList.toggle("mini-dense",st.dense);
  function seg(opts,cur,onSet){
    var w=document.createElement("div");w.className="st-seg";
    opts.forEach(function(o){
      var b=document.createElement("button");b.type="button";b.textContent=o[1];b.dataset.v=o[0];
      b.onclick=function(){onSet(o[0]);paintSeg()};w.appendChild(b);
    });
    w.cur=cur;w.get=cur;return w;
  }
  var segs=[];
  function paintSeg(){segs.forEach(function(w){var v=w.cur();w.querySelectorAll("button").forEach(function(b){b.setAttribute("aria-pressed",String(b.dataset.v===v))})})}
  function row(title,desc,w){
    var r=document.createElement("div");r.className="st-r";
    r.innerHTML='<div class="st-t"></div>'+(desc?'<div class="st-d"></div>':"");
    r.querySelector(".st-t").textContent=title;if(desc)r.querySelector(".st-d").textContent=desc;
    r.appendChild(w);segs.push(w);return r;
  }
  var K_SLIM="absence:slim";
  st.slim=get(K_SLIM,true);
  function slimOn(){try{return st.slim&&isHead&&!isGuest}catch(e){return false}}
  function syncSlim(){var v=slimOn();if(rootEl.classList.contains("slim")!==v)rootEl.classList.toggle("slim",v)}
  setInterval(syncSlim,500);
  // плитки вместо плавающих кнопок (для простого режима)
  function addTiles(){
    var g=document.querySelector("#sheet .sheet-grid");if(!g||g.dataset.slim)return;g.dataset.slim="1";
    [["Массовая отметка","bulkMini"],["Календарь пропусков","calMini"]].forEach(function(p){
      var b=document.createElement("button");b.type="button";b.className="tile slim-add";b.innerHTML="<span>◐</span>"+p[0];
      b.onclick=function(){var t=document.getElementById(p[1]);var s=document.getElementById("menuFab");if(s&&s.getAttribute("aria-expanded")==="true")s.click();if(t)setTimeout(function(){t.click()},120)};
      var ref=document.getElementById("stTile");g.insertBefore(b,ref||null)});
  }
  setInterval(addTiles,800);
  function enhance(){
    var sh=document.getElementById("stSheet");
    if(!sh||sh.dataset.mini)return;sh.dataset.mini="1";
    var h=sh.querySelector("h3");if(h)h.textContent="Настройки";
    sh.querySelectorAll(".st-t").forEach(function(e){e.textContent=e.textContent.replace(/^[^\p{L}\p{N}]+/u,"")});
    var c=row("Плотность","Компактный режим уменьшает отступы.",seg([["0","Обычная"],["1","Компактная"]],function(){return st.dense?"1":"0"},function(v){st.dense=v==="1";set(K_DENSE,st.dense);rootEl.classList.toggle("mini-dense",st.dense)}));
    var box=sh.querySelector(".st");
    function head(t){var d=document.createElement("div");d.className="st-h";d.textContent=t;return d}
    var q=function(id){return sh.querySelector(id)};
    var rep=q("#stRep");rep=rep&&rep.closest(".st-r");
    var x=q(".st-x");
    var order=[head("Вид"),q("#rTheme"),c,q("#rPerf"),q("#rVib")];
    if(isHead&&!isGuest){
      var sl=row("Простой режим","Староста: только нужные кнопки, без дублей.",seg([["1","Вкл"],["0","Выкл"]],function(){return st.slim?"1":"0"},function(v){st.slim=v==="1";set(K_SLIM,st.slim);syncSlim()}));
      order.push(head("Староста"),sl);
    }
    order.push(head("Безопасность"),q("#rBio"),head("Прочее"));
    var links=document.createElement("div");links.className="st-links";
    [["Обозначения","legendBtn"],["Инфо и лог","infoBtn"],["Установить приложение","instBtn"]].forEach(function(p){
      var src=p[1]==="instBtn"?document.querySelector("#sheet .tile.inst"):document.getElementById(p[1]);
      if(!src)return;var b=document.createElement("button");b.type="button";b.textContent=p[0];
      b.onclick=function(){var s=q("#stOk");if(s)s.click();setTimeout(function(){src.click()},150)};links.appendChild(b)});
    order.push(links);if(rep)order.push(rep);
    order.forEach(function(el){if(el)box.insertBefore(el,x)});
    sh.querySelectorAll(".st-seg").forEach(function(w){if(!w.get)w.get=function(){return""}});
    paintSeg();
  }
  document.addEventListener("click",function(e){
    if(e.target.closest&&e.target.closest("#stTile"))setTimeout(enhance,0);
  });

  var goOrig=window.goTab;
  if(typeof goOrig==="function")window.goTab=function(t){
    try{
      if(st.merge&&isHead){
        if(t==="diary"){setSched(true);document.querySelectorAll("#bnav button").forEach(function(b){b.classList.toggle("on",b.dataset.tab==="diary")});return}
        if(schedOn)setSched(false);
      }
    }catch(e){}
    return goOrig(t);
  };

  // нижняя навигация в дневнике: активна вкладка «Дневник»
  function markDiaryTab(){
    try{
      if(!(st.merge&&isHead&&schedOn))return;
      document.querySelectorAll("#bnav button").forEach(function(b){b.classList.toggle("on",b.dataset.tab==="diary")});
      if(typeof navSync==="function")navSync();
    }catch(e){}
  }
  var applyOrig=window.applyTab;
  if(typeof applyOrig==="function")window.applyTab=function(){var r=applyOrig.apply(this,arguments);markDiaryTab();return r};
  var setSchedOrig=window.setSched;
  if(typeof setSchedOrig==="function")window.setSched=function(){var r=setSchedOrig.apply(this,arguments);markDiaryTab();return r};

  // дневник: заголовок «Дневник 4501» живёт внутри карточки недели (один блок вместо двух),
  // а легенда предметов (цветные точки с названиями) не показывается
  function unifyDiaryTop(){
    try{
      var sv=document.getElementById("schedView");if(!sv)return;
      var sb=sv.querySelector(".sticky-bar"),h=sv.querySelector(".dv-head");
      if(sb&&h&&h.parentNode!==sb){sb.insertBefore(h,sb.firstChild);sb.classList.add("dv-top")}
      var names=[].slice.call(sv.querySelectorAll(".lesson-card .subject")).map(function(e){return e.textContent.replace(/^\s*\d{1,2}[.:]\d{2}\s+/,"").replace(/\s+/g," ").trim().toLowerCase()}).filter(Boolean);
      if(!names.length)return;
      var hits=[];
      sv.querySelectorAll("*").forEach(function(e){
        if(e.children.length||e.closest(".lesson-card,.sticky-bar,#dvUnit,.status-bar,.panel"))return;
        var t=e.textContent.replace(/\s+/g," ").trim().toLowerCase();
        if(t&&t.length<48&&names.some(function(n){return n===t||n.indexOf(t)===0}))hits.push(e)});
      if(hits.length<2)return;
      var a=hits[0];
      while(a&&a.parentElement&&a.parentElement!==sv&&!hits.every(function(x){return a.contains(x)}))a=a.parentElement;
      if(a&&a!==sv&&a.id!=="schedule"&&!a.closest(".lesson-card")&&!a.classList.contains("sticky-bar")&&!a.classList.contains("lessons"))a.style.setProperty("display","none","important");
    }catch(e){}
  }
  setInterval(unifyDiaryTop,600);unifyDiaryTop();

  var gb=document.getElementById("guestBtn");
  if(gb)gb.textContent="Войти как гость (только просмотр)";

  document.documentElement.classList.toggle("mini",st.mini);
  // применяем после первой отрисовки приложения
  var tries=0,t=setInterval(function(){
    tries++;
    if(typeof NAVS!=="undefined"&&typeof applyTab==="function"&&typeof me!=="undefined"&&me){clearInterval(t);apply()}
    else if(tries>40)clearInterval(t);
  },250);
})();

/* Зачёт в шапке дневника: чип после процентов, клик разворачивает плашку */
(function(){
  function chip(){
    try{
      var bw=document.querySelector("#schedView .dv-head .brand-wrap"),en=document.getElementById("examNext"),c=document.getElementById("exChip");
      var cs=en&&en.querySelector(".en-cs"),cn=en&&en.querySelector(".en-cn");
      if(!bw||!cs||!cn||en.classList.contains("hidden")){if(c)c.remove();document.documentElement.classList.remove("ex-chip");return}
      var parts=cn.textContent.split(" · "),name=parts[0]||"",when=parts.slice(1).join(" · ");
      if(!c){c=document.createElement("button");c.type="button";c.id="exChip";
        c.onclick=function(e){e.stopPropagation();var u=document.getElementById("dvUnit");if(u)u.click()};
        var b=document.getElementById("dvPct");b&&b.nextSibling?bw.insertBefore(c,b.nextSibling):bw.appendChild(c)}
      var h='<b>'+name.replace(/</g,"&lt;")+'</b><i>'+cs.textContent+' · '+when.replace(/</g,"&lt;")+'</i>';
      if(c._h!==h){c._h=h;c.innerHTML=h}
      c.classList.toggle("urgent",en.classList.contains("urgent"));
      document.documentElement.classList.add("ex-chip");
    }catch(e){}
  }
  setInterval(chip,500);chip();
})();
