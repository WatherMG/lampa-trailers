/*
 * Lampa Night UI extension.
 * Copyright (c) 2026 WatherMG, contributors — MIT.
 * The adaptive subtitle engine above is © 2026 emoorpheus — MIT.
 * A single installable plugin with all settings in "Night — плеер и субтитры".
 */
(function () {
  'use strict';
  if (window.LampaNight) return;
  var SECTION = 'lampa_night';
  var STYLE = 'lampa-night-controls';
  var PALETTES = {
    warm: { text: '#d8c7b4', bg: 'rgba(43,35,29,.85)', focus: '#594d43', ink: '#f2dfc4', accent: '#ac947a' },
    graphite: { text: '#c4cbd0', bg: 'rgba(37,42,46,.85)', focus: '#424e59', ink: '#e6e9ed', accent: '#86929c' },
    blue: { text: '#c0ccdc', bg: 'rgba(30,40,56,.85)', focus: '#394c67', ink: '#e2eaf5', accent: '#819bb9' }
  };
  var LEVELS = { '25':'25% — минимально', '35':'35% — очень тёмно', '45':'45% — тёмно', '55':'55% — умеренно', '65':'65% — комфортно', '75':'75% — светлее', '85':'85% — ярко', '100':'100% — как в Lampa' };
  function read(key, fallback) {
    try { var v = Lampa.Storage.get(key, fallback); return v === undefined || v === null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function level(key, fallback) {
    var n = parseInt(read(key, String(fallback)), 10);
    return isNaN(n) ? fallback : Math.max(0, Math.min(100, n));
  }
  function enabled() { var v = read('night_enabled', true); return v !== false && v !== 'false'; }
  function profile() {
    try { return window.AdaptiveSubs && window.AdaptiveSubs.state.profile === 'hdr' ? 'hdr' : 'sdr'; }
    catch (e) { return 'sdr'; }
  }
  function rgbRatio(pct) {
    var n = Math.max(0, Math.min(255, Math.round(pct * 2.55)));
    var h = n.toString(16); var d = h.length === 1 ? '0' + h : h; return '#' + d + d + d;
  }
  function css() {
    if (!enabled()) return '';
    var p = PALETTES[read('night_palette', 'warm')] || PALETTES.warm;
    var val = profile() === 'hdr' ? level('night_hdr_panel', 45) : level('night_sdr_panel', 60);
    var dim = val / 100;
    var s = '';
    // Lampa's panel and controls only. Do NOT filter .player, .player-video or <video>.
    s += '.player .player-panel{filter:brightness(' + dim + ') !important;-webkit-filter:brightness(' + dim + ') !important;color:' + p.text + ' !important;}';
    // The upper status bar (.player-info) is a sibling of .player-panel.
    // Footer playlist and right-hand selectbox are independent DOM roots.
    // Use the same palette and HDR/SDR brightness for all player chrome.
    s += '.player .player-info,.player .player-footer{filter:brightness(' + dim + ') !important;-webkit-filter:brightness(' + dim + ') !important;color:' + p.text + ' !important;}';
    s += '.player .player-info .value--size span,.player .player-info .value--pieces span{background-color:' + p.bg + ' !important;}';
    s += '.player .player-info .value--pieces span.active{background-color:' + p.accent + ' !important;}';
    s += '.player .player-info__title,.player .player-info__name,.player .player-info__time,.player .player-info__time-end,.player .player-info__values,.player .player-footer-card__title,.player .player-footer-card__text{color:' + p.text + ' !important;}';
    s += 'body.player--viewing .selectbox__content,body.player--viewing .modal__content{background:' + p.bg + ' !important;color:' + p.text + ' !important;filter:brightness(' + dim + ') !important;-webkit-filter:brightness(' + dim + ') !important;}';
    s += 'body.player--viewing .selectbox__title,body.player--viewing .selectbox-item__title,body.player--viewing .selectbox-item__subtitle{color:' + p.text + ' !important;}';
    s += 'body.player--viewing .selectbox-item.focus,body.player--viewing .selectbox-item.picked{background:' + p.focus + ' !important;color:' + p.ink + ' !important;}';
    s += 'body.player--viewing .selectbox-item.selected:after,body.player--viewing .selectbox-item.picked:after{border-color:' + p.accent + ' !important;}';
    s += 'body.player--viewing .selectbox-item__checkbox{border-color:' + p.accent + ' !important;}';
    s += '.player .player-panel .button.focus{background:' + p.focus + ' !important;color:' + p.ink + ' !important;}';
    s += '.player .player-panel .button .tooltip{color:' + p.text + ' !important;text-shadow:0 1px 2px #000;}';
    s += '.player .player-panel__box-buttons,.player .player-panel__playpause:not(.focus),.player .player-panel__time,.player .player-panel__volume-drop{background:' + p.bg + ' !important;}';
    s += '.player .player-panel__position,.player .player-panel__position>div:after{background:' + p.accent + ' !important;}';
    s += '.player .player-panel__peding{background:rgba(150,150,150,.2) !important;}';
    s += '.player .player-panel__timeline.focus{box-shadow:0 0 0 .1em ' + p.accent + ' !important;}';
    s += '.player.player--loading .player-panel__timeline:after{background:' + p.accent + ' !important;}';
    s += '.player .player-panel__timeline-segment--ad{background:rgba(170,120,70,.35) !important;}';
    s += '.player .player-panel__timeline-segment--skip{background:rgba(100,140,160,.35) !important;}';
    s += '.player .player-video__paused{background:rgba(45,45,45,.5) !important;filter:brightness(' + dim + ') !important;-webkit-filter:brightness(' + dim + ') !important;}';
    if (String(read('night_focus_outline','true')) !== 'false') {
      s += '.player .player-panel .button.focus{outline:2px solid ' + p.accent + ' !important;outline-offset:2px;}';
    }
    // Extra dimming for browser-rendered captions during Filmmaker/SDR.
    // Browser-native ::cue does not support CSS brightness filters.
    if (profile() === 'sdr') {
      var sub = level('night_sdr_subs',65);
      if (sub < 100) {
        var f = 'brightness(' + sub / 100 + ')';
        s += '.player .player-video__subtitles-text,.player .player-video__ass,.player .JASSUB{filter:' + f + ' !important;-webkit-filter:' + f + ' !important;}';
        s += '.player video::cue{color:' + rgbRatio(sub) + ' !important;}';
      }
    }
    var tint = read('night_subs_tint', 'default');
    var TINTS = {gray:'#b1b1b1',warm:'#c2b8a4',soft:'#d3d3d3',amber:'#c1a87f'};
    if (TINTS[tint]) {
      s += '.player .player-video__subtitles-text,.player .player-video__subtitles-text *{color:' + TINTS[tint] + ' !important;}';
      s += '.player video::cue{color:' + TINTS[tint] + ' !important;}';
    }
    var pos = read('night_subs_position','default');
    if (/^(2|5|8|12)vh$/.test(pos)) s += '.player .player-video__subtitles:not(.on-top){bottom:' + pos + ' !important;}';
    var weight = read('night_subs_weight','default');
    if (/^(400|500|600|700)$/.test(weight)) s += '.player .player-video__subtitles{font-weight:' + weight + ' !important;}';
    return s;
  }
  function apply() {
    var el = document.getElementById(STYLE);
    if (!el) { el = document.createElement('style'); el.id = STYLE; document.head.appendChild(el); }
    var value = css();
    if (el.textContent !== value) el.textContent = value;
  }
  function updateWebos() {
    try { if (window.AdaptiveSubs && window.AdaptiveSubs._test) window.AdaptiveSubs._test.applyWebos(); }
    catch (e) { console.warn('[Night] native subtitle update:', e); }
  }
  function addSettings() {
    if (!Lampa.SettingsApi || typeof Lampa.SettingsApi.addParam !== 'function') return;
    function add(key, type, def, values, title, description, after) {
      var param = { name:key, type:type, default:def };
      if (values) param.values = values;
      Lampa.SettingsApi.addParam({
        component:SECTION, param:param,
        field:{name:title, description:description || ''},
        onChange:function () { if (after) after(); apply(); }
      });
    }
    add('night_ui_title','title',null,null,'Ночной интерфейс плеера');
    add('night_enabled','trigger',true,null,'Ночной режим',
      'Перекрашивает и приглушает только интерфейс, а не HDR-видео.');
    add('night_palette','select','warm',
      { warm:'Тёплая (рекомендуется)', graphite:'Графитовая', blue:'Холодная синяя' },
      'Палитра панели','Без белого фона активной кнопки.');
    add('night_hdr_panel','select','45',LEVELS,'HDR/Dolby Vision: яркость панели',
      'Уровень CSS-фильтра (не измеренная яркость OLED).');
    add('night_sdr_panel','select','60',LEVELS,'SDR/Filmmaker: яркость панели',
      'Не зависит от яркости при HDR.');
    add('night_focus_outline','trigger',true,null,'Подсвечивать границу выбранной кнопки',
      'Сохраняет видимость фокуса при управлении пультом.');
    add('night_subs_title','title',null,null,'Дополнительно: субтитры');
    add('night_sdr_subs','select','65',LEVELS,'SDR: яркость HTML-субтитров',
      'SRT/VTT/ASS, рисуемые браузером. HDR-настройки — выше.');
    try {
      if (window.webOS && window.webOS.service) {
        add('night_sdr_native','select','60',LEVELS,'SDR: яркость встроенных субтитров LG',
          'Только системные субтитры webOS: процент от прозрачности, выбранной в Lampa.',
          updateWebos);
      }
    } catch (e) {}
    add('night_subs_tint','select','default',
      {default:'Не изменять цвет',gray:'Нейтральный серый',warm:'Тёплый серый',soft:'Мягкий светлый',amber:'Янтарный'},
      'Цвет HTML-субтитров', 'Работает только для текстовых субтитров браузера.');
    add('night_subs_position','select','default',
      {default:'Как в Lampa','2vh':'Немного выше','5vh':'Выше','8vh':'Высоко','12vh':'Очень высоко'},
      'Положение HTML-субтитров','Системные LG-субтитры не перемещаются.');
    add('night_subs_weight','select','default',
      {default:'Как в Lampa','400':'Обычный','500':'Средний','600':'Полужирный','700':'Жирный'},
      'Толщина шрифта HTML-субтитров');
  }
  function init() {
    if (init.done) return;
    init.done = true;
    addSettings();
    apply();
    if (window.addEventListener) window.addEventListener('adaptive_subs:profile', apply, false);
  }
  window.LampaNight = {version:'1.1.0', apply:apply, css:css, profile:profile};
  if (!window.Lampa || !Lampa.Listener) {
    console.error('[Lampa Night] Lampa APIs unavailable');
    return;
  }
  if (window.appready) init();
  else Lampa.Listener.follow('app', function (e) { if (e && e.type === 'ready') init(); });
})();
