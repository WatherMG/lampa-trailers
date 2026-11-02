import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../night-menu.js', import.meta.url),'utf8');
function setup(overrides={}) {
  const store={...overrides}, menuHistory=[], requests=[], events={}, saves=[];
  let applied=0,kindApplied=0,webosApplied=0,modeApplied=0;
  const video={mediaId:'test-media',webos_subs:[{mode:'disabled'},{mode:'showing',label:'Russian'}]};
  const document={
    querySelector(selector) {
      if(selector==='video') return video;
      if(selector==='.player-video__subtitles-text') return {textContent:''};
      return null;
    }
  };
  const window={
    appready:true,
    webOS:{
      platform:{tv:true},
      service:{request(uri,args) {
        requests.push({uri,method:args.method,parameters:args.parameters});
        if(args.onSuccess) args.onSuccess({returnValue:true});
      }}
    },
    AdaptiveSubs: {
      state:{kind:'dv',profile:'hdr',source:'name'},
      toggle(){this.state.profile=this.state.profile==='hdr'?'sdr':'hdr';},
      _test:{
        applyKind(){kindApplied++;},
        applyWebos(){webosApplied++;},
        evaluate(){modeApplied++;}
      }
    },
    LampaNight:{apply(){applied++;}}
  };
  const Lampa={
    Platform:{is(x){return x==='webos';}},
    Storage:{
      get(k,d){return Object.prototype.hasOwnProperty.call(store,k)?store[k]:d;},
      set(k,v){store[k]=v;saves.push({k,v});}
    },
    Player:{opened(){return true;},playdata(){return {url:'test'};},listener:{follow(name,cb){events['player:'+name]=cb;}}},
    Select:{
      listener:{follow(name,cb){events['select:'+name]=cb;}},
      show(options){menuHistory.push(options);}
    },
    Noty:{show(){}}
  };
  window.Lampa=Lampa;
  const ctx={Lampa,window,document,console,setTimeout(){}};
  vm.runInNewContext(source,ctx);
  function selectMenu(titlePart){
    const current=menuHistory[menuHistory.length-1];
    const item=current.items.find(x=>x.title.indexOf(titlePart)>=0);
    assert.ok(item, titlePart+' not present');
    item.onSelect(item);
    return menuHistory[menuHistory.length-1];
  }
  return {window,Lampa,store,video,menuHistory,requests,events,saves,selectMenu,
    get applied(){return applied;},get kindApplied(){return kindApplied;},
    get webosApplied(){return webosApplied;},get modeApplied(){return modeApplied;}};
}

test('adds Night only to settings menu of an active player without replacing existing actions',()=>{
  const h=setup();
  const options={title:'Настройки',items:[{method:'size',title:'Размер видео'},
    {method:'segments',title:'Сегменты'},{method:'subs',title:'Субтитры'}]};
  h.events['select:preshow']({active:options});
  assert.equal(options.items.length,4);
  assert.equal(options.items[3].method,'night');
  h.events['select:preshow']({active:options});
  assert.equal(options.items.length,4,'do not duplicate Night');
  const unrelated={items:[{method:'subs'}]};
  h.events['select:preshow']({active:unrelated});
  assert.equal(unrelated.items.length,2,'matching legacy subs may also be present');
});

test('in-player menu changes SDR/HDR palette directly and reapplies',()=>{
  const h=setup();
  h.window.LampaNightMenu.open();
  h.selectMenu('Интерфейс');
  h.selectMenu('Яркость интерфейса HDR');
  const option=h.menuHistory[h.menuHistory.length-1].items.find(x=>x.value==='25');
  option.onSelect(option);
  assert.equal(h.store.night_hdr_panel,'25');
  assert.ok(h.kindApplied>0);
  assert.ok(h.applied>0);
  assert.match(h.menuHistory[h.menuHistory.length-1].title,/Интерфейс/);
});

test('native subtitle color and font size use webOS mediaId and report responses',()=>{
  const h=setup();
  h.window.LampaNightMenu.open();
  h.selectMenu('Встроенные субтитры');
  h.selectMenu('Цвет LG');
  const c=h.menuHistory[h.menuHistory.length-1].items.find(x=>x.value==='3');
  c.onSelect(c);
  assert.equal(h.store.night_native_color,'3');
  assert.ok(h.requests.some(r=>r.method==='setSubtitleColor'&&r.parameters.color===3&&r.parameters.mediaId==='test-media'));
  assert.ok(h.window.LampaNightMenu.nativeStatus().success);
  h.selectMenu('Нативный размер LG');
  const size=h.menuHistory[h.menuHistory.length-1].items.find(x=>x.value==='0');
  size.onSelect(size);
  assert.equal(h.store.adaptive_subs_webos_size,'0');
  assert.ok(h.requests.some(r=>r.method==='setSubtitleFontSize'&&r.parameters.fontSize===0));
  assert.ok(h.webosApplied>0);
});

test('diagnostics distinguish native selected tracks, HTML and missing media',()=>{
  const h=setup();
  const info=h.window.LampaNightMenu.nativeInfo();
  assert.equal(info.mode,'Системный LG');
  assert.equal(info.tracks,2);
  h.video.webos_subs=[];
  const info2=h.window.LampaNightMenu.nativeInfo();
  assert.equal(info2.mode,'Не удалось определить');
});

test('switching HDR mode reevaluates current stream',()=>{
  const h=setup();
  h.window.LampaNightMenu.open();
  h.selectMenu('Режим HDR/SDR');
  h.selectMenu('HDR/SDR профиль');
  const v=h.menuHistory[h.menuHistory.length-1].items.find(x=>x.value==='sdr');
  v.onSelect(v);
  assert.equal(h.store.adaptive_subs_mode,'sdr');
  assert.ok(h.modeApplied>0);
});

test('only settings popups in player receive injected Night entry',()=>{
  const h=setup();
  const quality={title:'Качество',items:[{value:'720p',title:'720p'}]};
  h.events['select:preshow']({active:quality});
  assert.equal(quality.items.length,1);
});
