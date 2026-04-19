/* Unified site header injected into <div id="site-header"></div> */
(function(){
  if(window.__shdrLoaded) return; window.__shdrLoaded = true;

  var css = ''+
'.shdr-bar{position:fixed;top:0;left:0;right:0;height:56px;background:rgba(10,10,15,0.95);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;padding:0 20px;z-index:1000;font-family:"Noto Sans KR",sans-serif}'+
'.shdr-logo{display:flex;align-items:center;text-decoration:none;margin-right:24px;flex-shrink:0}'+
'.shdr-logo-text{font-family:"Orbitron",monospace;font-size:18px;font-weight:800;background:linear-gradient(90deg,#00b8d9,#9333ea);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:0.5px}'+
'.shdr-nav{display:flex;align-items:center;gap:4px;flex:1;min-width:0;overflow:hidden}'+
'.shdr-nav a,.shdr-nav .shdr-drop>span{position:relative;display:flex;align-items:center;gap:4px;padding:8px 12px;color:#9ca3af;font-size:13px;font-weight:600;text-decoration:none;border-radius:6px;cursor:pointer;transition:all .15s;white-space:nowrap}'+
'.shdr-nav a:hover,.shdr-nav .shdr-drop>span:hover{color:#fff;background:rgba(255,255,255,0.04)}'+
'.shdr-nav a.act{color:#00b8d9;background:rgba(0,184,217,0.08)}'+
'.shdr-nav a.evt{color:#f59e0b}'+
'.shdr-nav a.evt:hover{color:#fbbf24;background:rgba(245,158,11,0.08)}'+
'.shdr-drop{position:relative}'+
'.shdr-drop>span .arr{font-size:9px;opacity:.5}'+
'.shdr-menu{position:absolute;top:calc(100% + 4px);left:0;background:#16161f;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:6px;min-width:180px;box-shadow:0 10px 30px rgba(0,0,0,.5);display:none;z-index:1100}'+
'.shdr-drop:hover .shdr-menu{display:block}'+
'.shdr-menu a{display:block;padding:8px 12px;font-size:13px;color:#9ca3af;border-radius:6px;text-decoration:none}'+
'.shdr-menu a:hover{background:#1c1c28;color:#00b8d9}'+
'.shdr-menu a.prep{opacity:.4;pointer-events:none}'+
'.shdr-mega{left:0;width:760px;padding:14px;display:none}'+
'.shdr-drop:hover .shdr-mega{display:grid}'+
'.shdr-mega{grid-template-columns:repeat(4,1fr);gap:8px}'+
'.shdr-mega-col h5{font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;padding:6px 10px;margin-bottom:4px}'+
'.shdr-mega-col a{display:block;padding:7px 10px;font-size:12px;color:#9ca3af;border-radius:6px;text-decoration:none}'+
'.shdr-mega-col a:hover{background:#1c1c28;color:#00b8d9}'+
'.shdr-mega-col a.prep{opacity:.4;pointer-events:none}'+
'.shdr-right{display:flex;align-items:center;gap:8px;margin-left:auto;flex-shrink:0}'+
'.shdr-reward{font-size:12px;color:#9ca3af;padding:6px 10px;background:rgba(0,184,217,0.06);border:1px solid rgba(0,184,217,0.15);border-radius:8px;white-space:nowrap;transition:opacity .4s}'+
'.shdr-reward span{color:#00D4A0;font-weight:700}'+
'.shdr-langwrap{position:relative}'+
'.shdr-langbtn{background:#16161f;border:1px solid rgba(255,255,255,0.08);color:#9ca3af;font:600 12px "Noto Sans KR",sans-serif;padding:7px 12px;border-radius:8px;cursor:pointer;transition:all .2s}'+
'.shdr-langbtn:hover{color:#00b8d9;border-color:rgba(0,184,217,0.3)}'+
'.shdr-langdrop{position:absolute;top:calc(100% + 6px);right:0;background:#16161f;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:6px;min-width:140px;box-shadow:0 10px 30px rgba(0,0,0,.45);display:none;z-index:1100}'+
'.shdr-langdrop.open{display:block}'+
'.shdr-langdrop div{padding:8px 12px;border-radius:6px;font-size:13px;color:#9ca3af;cursor:pointer;transition:all .15s}'+
'.shdr-langdrop div:hover{background:#0a0a0f;color:#fff}'+
'.shdr-langdrop div.act{color:#00b8d9}'+
'.shdr-login{padding:7px 14px;background:transparent;border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:#9ca3af;font:700 12px "Noto Sans KR",sans-serif;cursor:pointer;text-decoration:none;transition:all .2s}'+
'.shdr-login:hover{color:#00b8d9;border-color:rgba(0,184,217,0.3)}'+
'.shdr-signup{padding:7px 14px;background:linear-gradient(135deg,#00b8d9,#9333ea);border:none;border-radius:8px;color:#000;font:800 12px "Noto Sans KR",sans-serif;cursor:pointer;text-decoration:none;transition:transform .2s}'+
'.shdr-signup:hover{transform:translateY(-1px)}'+
'.shdr-burger{display:none;background:none;border:none;color:#fff;font-size:20px;cursor:pointer;padding:6px 10px}'+
'@media(max-width:1100px){.shdr-nav .shdr-mega-host{display:none}.shdr-reward{display:none}}'+
'@media(max-width:820px){.shdr-nav{display:none}.shdr-burger{display:block}}'+
'@media(max-width:480px){.shdr-reward,.shdr-login{display:none}}';

  var st = document.createElement('style');
  st.setAttribute('data-shdr','1');
  st.textContent = css;
  document.head.appendChild(st);

  var path = (location.pathname.split('/').pop()||'index.html').toLowerCase();
  var isContract = location.pathname.toLowerCase().indexOf('/contract/')>=0;
  var base = isContract ? '../' : '';
  function act(n){ return n===path ? ' act' : ''; }

  var html = ''+
'<div class="shdr-bar">'+
  '<a class="shdr-logo" href="'+base+'index.html"><span class="shdr-logo-text">1% TRADING</span></a>'+
  '<nav class="shdr-nav">'+
    '<div class="shdr-drop shdr-mega-host">'+
      '<span>계약데이터 <span class="arr">▼</span></span>'+
      '<div class="shdr-menu shdr-mega">'+
        '<div class="shdr-mega-col"><h5>청산·펀딩비</h5>'+
          '<a href="'+base+'contract/liquidation.html">💥 청산 데이터</a>'+
          '<a class="prep">🔥 청산 히트맵</a>'+
          '<a href="'+base+'contract/funding.html">📈 펀딩비</a>'+
          '<a class="prep">🗺️ 펀딩비 히트맵</a>'+
        '</div>'+
        '<div class="shdr-mega-col"><h5>롱숏 비율</h5>'+
          '<a href="'+base+'contract/longshort.html">⚖️ 실시간 롱숏</a>'+
          '<a class="prep">📊 L/S Population</a>'+
          '<a class="prep">🐋 대규모 롱숏</a>'+
        '</div>'+
        '<div class="shdr-mega-col"><h5>포지션·주문서</h5>'+
          '<a href="'+base+'contract/oi.html">📊 OI 미결제약정</a>'+
          '<a class="prep">📉 OI 변화</a>'+
          '<a class="prep">📖 오더북</a>'+
        '</div>'+
        '<div class="shdr-mega-col"><h5>종합</h5>'+
          '<a class="prep">🐋 고래 포지션</a>'+
          '<a class="prep">📈 RSI 히트맵</a>'+
          '<a href="'+base+'kimp.html">🇰🇷 김치프리미엄</a>'+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div class="shdr-drop shdr-mega-host">'+
      '<span>CFD <span class="arr">▼</span></span>'+
      '<div class="shdr-menu">'+
        '<a class="prep">🇺🇸 미국 주식</a>'+
        '<a class="prep">🥇 금/원자재</a>'+
        '<a class="prep">📊 나스닥</a>'+
      '</div>'+
    '</div>'+
    '<a class="'+'nv'+act('kimp.html')+'" href="'+base+'kimp.html">김프</a>'+
    '<a class="'+'nv'+act('news.html')+'" href="'+base+'news.html">뉴스</a>'+
    '<a class="'+'nv'+act('rewards.html')+act('exchanges.html')+act('bitget.html')+act('bybit.html')+act('gate.html')+act('okx.html')+act('gold.html')+'" href="'+base+'rewards.html">거래소/리워드</a>'+
    '<a class="'+'nv'+act('community.html')+'" href="'+base+'community.html">커뮤니티</a>'+
    '<a class="evt'+act('events.html')+'" href="'+base+'events.html">🎁 이벤트</a>'+
  '</nav>'+
  '<div class="shdr-right">'+
    '<div class="shdr-reward" id="shdrReward">🎉 max**** 님이 <span>$463.20 USDT</span> 리워드</div>'+
    '<div class="shdr-langwrap">'+
      '<button class="shdr-langbtn" id="shdrLangBtn" type="button">🌐 <span id="shdrLangLbl">한국어</span> ▼</button>'+
      '<div class="shdr-langdrop" id="shdrLangDrop">'+
        '<div data-l="ko" data-n="한국어" class="act">🇰🇷 한국어</div>'+
        '<div data-l="en" data-n="English">🇺🇸 English</div>'+
        '<div data-l="zh" data-n="中文">🇨🇳 中文</div>'+
        '<div data-l="ja" data-n="日本語">🇯🇵 日本語</div>'+
        '<div data-l="vi" data-n="Tiếng Việt">🇻🇳 Tiếng Việt</div>'+
      '</div>'+
    '</div>'+
    '<a class="shdr-login" href="'+base+'mypage.html">로그인</a>'+
    '<a class="shdr-signup" href="'+base+'register.html">회원가입</a>'+
    '<button class="shdr-burger" type="button" id="shdrBurger">☰</button>'+
  '</div>'+
'</div>';

  function mount(){
    var slot = document.getElementById('site-header');
    if(!slot){ slot = document.createElement('div'); slot.id='site-header'; document.body.insertBefore(slot, document.body.firstChild); }
    slot.innerHTML = html;
    document.body.style.paddingTop = (parseInt(getComputedStyle(document.body).paddingTop,10)||0) >= 56 ? getComputedStyle(document.body).paddingTop : '56px';

    var savedLang = null;
    try { savedLang = localStorage.getItem('lang'); } catch(e){}
    if(savedLang){
      var opt = slot.querySelector('.shdr-langdrop div[data-l="'+savedLang+'"]');
      if(opt){
        slot.querySelectorAll('.shdr-langdrop div').forEach(function(d){d.classList.remove('act');});
        opt.classList.add('act');
        document.getElementById('shdrLangLbl').textContent = opt.getAttribute('data-n');
      }
    }

    var btn = document.getElementById('shdrLangBtn');
    var drop = document.getElementById('shdrLangDrop');
    btn.addEventListener('click', function(e){ e.stopPropagation(); drop.classList.toggle('open'); });
    drop.querySelectorAll('div').forEach(function(d){
      d.addEventListener('click', function(e){
        e.stopPropagation();
        var l = d.getAttribute('data-l'), n = d.getAttribute('data-n');
        drop.querySelectorAll('div').forEach(function(x){x.classList.remove('act');});
        d.classList.add('act');
        document.getElementById('shdrLangLbl').textContent = n;
        try{ localStorage.setItem('lang', l); }catch(e){}
        drop.classList.remove('open');
      });
    });
    document.addEventListener('click', function(e){
      if(!btn.contains(e.target) && !drop.contains(e.target)) drop.classList.remove('open');
    });

    var rewards = [
      {n:'max****', a:'$463.20'},
      {n:'tra****', a:'$128.50'},
      {n:'btc****', a:'$842.10'},
      {n:'kim****', a:'$256.40'},
      {n:'eth****', a:'$391.80'}
    ];
    var ri = 0;
    var rwEl = document.getElementById('shdrReward');
    setInterval(function(){
      if(!rwEl) return;
      ri = (ri+1) % rewards.length;
      rwEl.style.opacity = '0';
      setTimeout(function(){
        rwEl.innerHTML = '🎉 '+rewards[ri].n+' 님이 <span>'+rewards[ri].a+' USDT</span> 리워드';
        rwEl.style.opacity = '1';
      }, 300);
    }, 5000);

    var burger = document.getElementById('shdrBurger');
    if(burger){
      burger.addEventListener('click', function(){
        var nav = slot.querySelector('.shdr-nav');
        if(nav.style.display === 'flex'){
          nav.style.display = '';
        } else {
          nav.style.cssText = 'display:flex;position:fixed;top:56px;left:0;right:0;background:#0a0a0f;flex-direction:column;align-items:stretch;padding:8px;border-bottom:1px solid rgba(255,255,255,0.08);z-index:999';
        }
      });
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
