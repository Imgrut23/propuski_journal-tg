/* Минимализм + объединение вкладок. Настройки хранятся в localStorage. */
(function(){
  var K_MINI="absence:mini",K_MERGE="absence:merge";
  var get=function(k,d){try{var v=localStorage.getItem(k);return v===null?d:v==="1"}catch(e){return d}};
  var set=function(k,v){try{localStorage.setItem(k,v?"1":"0")}catch(e){}};
  var st=window.MINI={mini:get(K_MINI,true),merge:get(K_MERGE,true)};
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
        N.head=[["diary","Дневник"],["today","Журнал"],["self","Моя"],["set","Настройки"]];
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
    w.cur=cur;return w;
  }
  var segs=[];
  function paintSeg(){segs.forEach(function(w){var v=w.cur();w.querySelectorAll("button").forEach(function(b){b.setAttribute("aria-pressed",String(b.dataset.v===v))})})}
  function row(title,desc,w){
    var r=document.createElement("div");r.className="st-r";
    r.innerHTML='<div class="st-t"></div>'+(desc?'<div class="st-d"></div>':"");
    r.querySelector(".st-t").textContent=title;if(desc)r.querySelector(".st-d").textContent=desc;
    r.appendChild(w);segs.push(w);return r;
  }
  function enhance(){
    var sh=document.getElementById("stSheet");
    if(!sh||sh.dataset.mini)return;sh.dataset.mini="1";
    var h=sh.querySelector("h3");if(h)h.textContent="Настройки";
    sh.querySelectorAll(".st-t").forEach(function(e){e.textContent=e.textContent.replace(/^[^\p{L}\p{N}]+/u,"")});
    var onoff=[["1","Вкл"],["0","Выкл"]];
    var a=row("Минимализм","Плоский вид без стекла, теней и анимаций.",seg(onoff,function(){return st.mini?"1":"0"},function(v){st.mini=v==="1";set(K_MINI,st.mini);apply()}));
    var b=row("Объединять вкладки","Дневник и Журнал вместо отдельных страниц.",seg(onoff,function(){return st.merge?"1":"0"},function(v){st.merge=v==="1";set(K_MERGE,st.merge);apply()}));
    var c=row("Плотность","Компактный режим уменьшает отступы.",seg([["0","Обычная"],["1","Компактная"]],function(){return st.dense?"1":"0"},function(v){st.dense=v==="1";set(K_DENSE,st.dense);rootEl.classList.toggle("mini-dense",st.dense)}));
    var box=sh.querySelector(".st");
    var after=h||null;
    [c,b,a].forEach(function(r){box.insertBefore(r,after?after.nextSibling:box.firstChild)});
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
