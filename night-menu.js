/*
 * Lampa Night: in-player settings and LG webOS subtitle diagnostics.
 * Copyright (c) 2026 WatherMG, contributors. MIT.
 * Uses public Lampa.Select listener to append "Night" to the stock player
 * settings menu, without overriding its show() method or altering the player.
 */
(function () {
  'use strict';
  if (window.LampaNightMenu) return;
  if (!window.Lampa || !Lampa.Select || !Lampa.Player) return;

  var LABEL = 'Night — интерфейс и субтитры';
  var LEVELS = {'5':'5%','10':'10%','15':'15%','20':'20%','25':'25%','35':'35%','45':'45%','55':'55%','65':'65%','75':'75%','85':'85%','100':'100% (без затемнения)'};
  var HDR_LEVELS = {'#9a9a9a':'60%','#8a8a8a':'54%','#7a7a7a':'48%','#666666':'40%','#555555':'33%','#404040':'25%'};
  var HDR_OVERRIDES = {'same':'Как основной'};
  var groups = [
    {name:'panel', title:'Интерфейс: панель, часы и меню'},
    {name:'html', title:'HTML-субтитры и размер'},
    {name:'hdr', title:'HDR/Dolby Vision/HLG'},
    {name:'native', title:'Встроенные субтитры LG webOS'},
    {name:'detection', title:'Режим HDR/SDR и пульт'},
    {name:'status', title:'Диагностика'}
  ];
  var colors = {default:'Не менять',gray:'Серый',graphite:'Графит',silver:'Серебристый',warm:'Тёплый серый',parchment:'Пергамент',soft:'Мягкий светлый',amber:'Янтарный',yellow:'Приглушённый жёлтый',gold:'Матовое золото',sage:'Шалфейный',green:'Приглушённый зелёный',blue:'Мягкий синий',cyan:'Сине-зелёный',purple:'Лавандовый',pink:'Пыльно-розовый',orange:'Тёплый оранжевый',white:'Белый'};
  var sizes = {'0.5vh':'0,5vh','0.7vh':'0,7vh','0.9vh':'0,9vh','1vh':'1,0vh','1.2vh':'1,2vh','default':'Как в Lampa','1.4vh':'1,4vh','1.8vh':'1,8vh','2.2vh':'2,2vh','2.6vh':'2,6vh','3vh':'3vh','3.2vh':'3,2vh','3.8vh':'3,8vh','4.4vh':'4,4vh','5vh':'5vh','5.8vh':'5,8vh'};
  var defs = [
    {group:'panel',key:'night_enabled',title:'Ночное оформление',values:{'true':'Включено','false':'Выключено'},def:'true'},
    {group:'panel',key:'night_palette',title:'Палитра',values:{warm:'Тёплая',graphite:'Графит',blue:'Холодная'},def:'warm'},
    {group:'panel',key:'night_hdr_panel',title:'Яркость интерфейса HDR/DV',values:LEVELS,def:'45'},
    {group:'panel',key:'night_sdr_panel',title:'Яркость интерфейса SDR',values:LEVELS,def:'60'},
    {group:'panel',key:'night_focus_outline',title:'Контур выбранной кнопки',values:{'true':'Включён','false':'Выключен'},def:'true'},
    {group:'html',key:'adaptive_subs_size',title:'Размер субтитров',values:sizes,def:'default'},
    {group:'html',key:'night_subs_tint',title:'Цвет HTML-субтитров',values:colors,def:'default'},
    {group:'html',key:'night_html_opacity',title:'Непрозрачность HTML-субтитров',values:LEVELS,def:'100'},
    {group:'html',key:'night_subs_weight',title:'Толщина текста',values:{default:'Как в Lampa','400':'Обычный','500':'Средний','600':'Полужирный','700':'Жирный'},def:'default'},
    {group:'html',key:'night_subs_position',title:'Положение текста',values:{default:'Как в Lampa','2vh':'Немного выше','5vh':'Выше','8vh':'Высоко','12vh':'Очень высоко'},def:'default'},
    {group:'html',key:'night_sdr_subs',title:'Яркость HTML-субтитров SDR',values:LEVELS,def:'65'},
    {group:'html',key:'adaptive_subs_ass',title:'Затемнять ASS',values:{'true':'Да','false':'Нет'},def:'true'},
    {group:'hdr',key:'adaptive_subs_hdr_style',title:'Метод HDR',values:{dim:'Яркость, сохраняя цвет',color:'Перекрасить в серый'},def:'dim'},
    {group:'hdr',key:'adaptive_subs_hdr_tone',title:'Основная яркость HDR',values:HDR_LEVELS,def:'#7a7a7a'},
    {group:'hdr',key:'adaptive_subs_level_hdr10',title:'HDR10',values:HDR_OVERRIDES,def:'same'},
    {group:'hdr',key:'adaptive_subs_level_dv',title:'Dolby Vision',values:HDR_OVERRIDES,def:'same'},
    {group:'hdr',key:'adaptive_subs_level_hlg',title:'HLG',values:HDR_OVERRIDES,def:'same'},
    {group:'native',key:'adaptive_subs_webos_size',title:'Нативный размер LG',values:{default:'Как в Lampa','0':'0 — минимальный','1':'1','2':'2','3':'3','4':'4 — максимальный'},def:'default'},
    {group:'native',key:'adaptive_subs_webos_opacity',title:'HDR: непрозрачность LG',values:{'191':'75%','153':'60%','128':'50%','102':'40%','77':'30%'},def:'128'},
    {group:'native',key:'night_sdr_native',title:'SDR: непрозрачность LG',values:LEVELS,def:'60'},
    {group:'native',key:'night_native_color',title:'Цвет LG (код палитры webOS)',values:{default:'Как в Lampa','0':'Код 0','1':'Код 1','2':'Код 2','3':'Код 3','4':'Код 4','5':'Код 5'},def:'default'},
    {group:'native',key:'night_native_bg_color',title:'Цвет подложки LG',values:{default:'Как в Lampa',black:'Чёрный',white:'Белый',yellow:'Жёлтый',red:'Красный',green:'Зелёный',blue:'Синий'},def:'default'},
    {group:'native',key:'night_native_bg_opacity',title:'Непрозрачность подложки LG',values:{default:'Как в Lampa','0':'0%','64':'25%','128':'50%','191':'75%','255':'100%'},def:'default'},
    {group:'native',key:'night_native_position',title:'Позиция LG',values:{default:'Как в Lampa','-3':'-3','-2':'-2','-1':'-1','0':'0','1':'1','2':'2','3':'3','4':'4'},def:'default'},
    {group:'detection',key:'adaptive_subs_mode',title:'HDR/SDR профиль',values:{auto:'Автоматически',hdr:'Всегда HDR',sdr:'Всегда SDR'},def:'auto'},
    {group:'detection',key:'adaptive_subs_ffp',title:'Проверять TorrServer /ffp',values:{'true':'Да','false':'Нет'},def:'true'},
    {group:'detection',key:'adaptive_subs_hls',title:'Проверять HLS VIDEO-RANGE',values:{'true':'Да','false':'Нет'},def:'true'},
    {group:'detection',key:'adaptive_subs_key',title:'Кнопка HDR/SDR',values:{none:'Нет',red:'Красная (403)',green:'Зелёная (404)',yellow:'Жёлтая (405)',blue:'Синяя (406)'},def:'none'}
  ];
  var nativeState = {last:'Команды ещё не отправлялись',method:'',success:null};
  var activeWatch = 0;
  var on = false;
  var originalMenu = null;

  function read(key, fallback) {
    try { var v = Lampa.Storage.get(key, fallback); return v == null ? fallback : String(v); }
    catch (e) { return fallback; }
  }
  function isWebos() {
    try { return !!(window.webOS && window.webOS.service && typeof window.webOS.service.request === 'function' &&
      (Lampa.Platform && Lampa.Platform.is && Lampa.Platform.is('webos') || window.webOS.platform && window.webOS.platform.tv === true)); }
    catch (e) { return false; }
  }
  function mediaId() {
    var video = document.querySelector('video');
    return video && video.mediaId ? video.mediaId : null;
  }
  function alertMsg(s) {
    if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show(s);
  }
  function nativeRequest(method, param, value) {
    var id = mediaId();
    if (!isWebos() || !id) {
      nativeState = {method:method,success:false,last:'Нет активного mediaId LG; настройка сохранена'};
      return false;
    }
    var parameters = {mediaId:id};
    parameters[param] = value;
    nativeState = {method:method,success:null,last:'Отправлено '+method+'; ожидается ответ webOS'};
    try {
      window.webOS.service.request('luna://com.webos.media', {
        method:method,parameters:parameters,
        onSuccess:function (res) {
          nativeState = {method:method,success:!(res && res.returnValue === false),
            last:res && res.returnValue === false ? 'webOS отклонил '+method : 'webOS подтвердил '+method};
          if (!nativeState.success) alertMsg(nativeState.last);
        },
        onFailure:function (res) {
          nativeState = {method:method,success:false,last:'webOS: '+method+' — '+(res && (res.errorText || res.errorCode) || 'ошибка')};
          alertMsg(nativeState.last);
        }
      });
    } catch (e) {
      nativeState = {method:method,success:false,last:'webOS: '+String(e && e.message || e)};
      alertMsg(nativeState.last);
      return false;
    }
    return true;
  }
  function applyNative() {
    if (!isWebos() || !mediaId()) return false;
    var methods = [
      ['night_native_color','setSubtitleColor','color'],
      ['night_native_bg_color','setSubtitleBackgroundColor','bgColor'],
      ['night_native_bg_opacity','setSubtitleBackgroundOpacity','bgOpacity'],
      ['night_native_position','setSubtitlePosition','position']
    ];
    for (var i=0; i<methods.length; i++) {
      var spec=methods[i], val=read(spec[0], 'default');
      if (val === 'default') continue;
      if (spec[0] === 'night_native_color' || spec[0] === 'night_native_bg_opacity' || spec[0] === 'night_native_position') val=parseInt(val,10);
      nativeRequest(spec[1],spec[2],val);
    }
    var subSize=read('adaptive_subs_webos_size','default');
    if (subSize !== 'default') nativeRequest('setSubtitleFontSize','fontSize',parseInt(subSize,10));
    if (window.AdaptiveSubs && window.AdaptiveSubs._test && window.AdaptiveSubs._test.applyWebos) {
      window.AdaptiveSubs._test.applyWebos();
    }
    return true;
  }
  function applyImmediately(key) {
    if (window.AdaptiveSubs && window.AdaptiveSubs._test) {
      var a=window.AdaptiveSubs;
      if (key === 'adaptive_subs_mode') {
        if (a._test.evaluate) a._test.evaluate(Lampa.Player.playdata ? Lampa.Player.playdata() : null,true);
      } else if (a._test.applyKind) {
        a._test.applyKind(a.state.kind,a.state.source || 'manual');
      }
    }
    if (window.LampaNight && window.LampaNight.apply) window.LampaNight.apply();
    if (/^(night_native_|adaptive_subs_webos_)/.test(key)) applyNative();
  }
  function currentNativeInfo() {
    var v=document.querySelector('video');
    var tracks=v && v.webos_subs ? v.webos_subs : [];
    var selected=[];
    for (var i=0;i<tracks.length;i++) {
      var t=tracks[i];
      if (t && (t.selected || t.mode==='showing')) selected.push(t.label || t.language || String(i));
    }
    var sub=document.querySelector('.player-video__subtitles-text');
    var visibleHtml=!!(sub && sub.textContent && sub.textContent.replace(/\s+/g,'').length);
    return {
      mediaId:v && v.mediaId || null, tracks:tracks.length || 0,
      selected:selected.join(', ') || 'не определены',
      htmlTextVisible:visibleHtml,
      mode:selected.length ? 'Системный LG' : visibleHtml ? 'HTML' : 'Не удалось определить'
    };
  }
  function menuShow(args) {
    try { Lampa.Select.show(args); }
    catch (e) { console.error('[Night] menu error',e); alertMsg('Не удалось открыть меню Night'); }
  }
  function optionMenu(def, origin) {
    var items=[], value=read(def.key,def.def);
    for (var key in def.values) if (Object.prototype.hasOwnProperty.call(def.values,key)) {
      items.push({title:def.values[key],value:key,selected:key===value});
    }
    menuShow({
      title:def.title,items:items,nomark:false,
      onSelect:function (item) {
        try { Lampa.Storage.set(def.key,item.value); applyImmediately(def.key); }
        catch (e) { alertMsg('Ошибка настройки: '+String(e && e.message||e)); }
        groupMenu(def.group,origin);
      },
      onBack:function () { groupMenu(def.group,origin); }
    });
  }
  function statusMenu(origin) {
    var info=currentNativeInfo();
    var st=window.AdaptiveSubs && window.AdaptiveSubs.state || {};
    var items=[
      {title:'Тип субтитров: '+info.mode,noenter:true},
      {title:'LG mediaId: '+(info.mediaId?'есть':'нет'),noenter:true},
      {title:'Нативных дорожек: '+info.tracks,noenter:true},
      {title:'Выбранная: '+info.selected,noenter:true},
      {title:'HDR: '+(st.kind||'?')+', профиль '+(st.profile||'?'),noenter:true},
      {title:'webOS: '+nativeState.last,noenter:true},
      {title:'Повторно применить настройки LG', onSelect:function () {
        if (!applyNative()) alertMsg('Нет активного mediaId для webOS');
        statusMenu(origin);
      }},
      {title:'Переключить профиль HDR/SDR',onSelect:function () {
        if(window.AdaptiveSubs && window.AdaptiveSubs.toggle) window.AdaptiveSubs.toggle();
        statusMenu(origin);
      }}
    ];
    menuShow({title:'Night — диагностика',items:items,onBack:function () { rootMenu(origin); }});
  }
  function groupMenu(name,origin) {
    var group=groups.filter(function(x){return x.name===name;})[0];
    if (!group) return rootMenu(origin);
    var items=[];
    defs.forEach(function (d) {
      if(d.group!==name) return;
      var value=read(d.key,d.def);
      items.push({title:d.title,subtitle:d.values[value]||value,
        onSelect:function () { optionMenu(d,origin); }});
    });
    if(name==='native' && !isWebos()) {
      items.unshift({title:'Нативный API webOS недоступен',noenter:true});
    }
    menuShow({title:'Night / '+group.title,items:items,onBack:function(){rootMenu(origin);}});
  }
  function rootMenu(origin) {
    var st=window.AdaptiveSubs && window.AdaptiveSubs.state || {};
    var items=groups.map(function (g) {
      return {
        title:g.title,
        subtitle:g.name==='status'?'HDR: '+(st.kind||'?')+' / '+(st.profile||'?') : '',
        onSelect:function(){if(g.name==='status')statusMenu(origin);else groupMenu(g.name,origin);}
      };
    });
    menuShow({title:LABEL,items:items,onBack:function () {
      if(origin) menuShow(origin);
    }});
  }
  function onSelectPreshow(e) {
    if (!e || !e.active || !e.active.items || !Lampa.Player.opened || !Lampa.Player.opened()) return;
    var active=e.active;
    var hasSubs=false,hasSegments=false,hasNight=false;
    for(var i=0;i<active.items.length;i++) {
      var item=active.items[i];
      if(item.method==='subs')hasSubs=true;
      if(item.method==='segments')hasSegments=true;
      if(item.method==='night')hasNight=true;
    }
    if (!hasSubs || !hasSegments || hasNight) return;
    active.items.push({
      title:LABEL, method:'night',
      subtitle:'Яркость, цвета, HDR, субтитры и LG webOS',
      onSelect:function () { rootMenu(active); }
    });
  }
  function watchNative() {
    var seq=++activeWatch, tries=0,previous=null;
    function tick() {
      if(seq!==activeWatch || !Lampa.Player.opened || !Lampa.Player.opened()) return;
      var id=mediaId();
      if(id && id!==previous) { previous=id;applyNative(); }
      if(++tries<40) setTimeout(tick,500);
    }
    tick();
  }
  function init() {
    if (on) return; on=true;
    if (Lampa.Select.listener && Lampa.Select.listener.follow) Lampa.Select.listener.follow('preshow',onSelectPreshow);
    if (Lampa.Player.listener && Lampa.Player.listener.follow) {
      Lampa.Player.listener.follow('start',watchNative);
      Lampa.Player.listener.follow('destroy',function(){activeWatch++;});
    }
  }
  window.LampaNightMenu = {
    version:'1.2.0',
    open:function(){rootMenu(null);},
    nativeInfo:currentNativeInfo,applyNative:applyNative,
    applyImmediately:applyImmediately, nativeStatus:function(){return nativeState;},
    inject:onSelectPreshow
  };
  if (window.appready) init();
  else if (Lampa.Listener && Lampa.Listener.follow) Lampa.Listener.follow('app',function(e){if(e && e.type==='ready')init();});
})();
