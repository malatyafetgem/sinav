// app-ui.js — Tabs, navigation, dropdowns, search, filters, charts, exports

let currentPane = 'anasayfa_genel';
const VALID_PANES = ['anasayfa_genel', 'anasayfa', 'sonuclar', 'rapor', 'ayarlar'];

function normalizePaneId(id) {
  id = String(id || '').replace(/^#/, '');
  return VALID_PANES.includes(id) ? id : 'anasayfa_genel';
}

function paneFromLocation() {
  let hashPane = String(window.location.hash || '').replace('#', '');
  return normalizePaneId(hashPane || currentPane || 'anasayfa_genel');
}

function routeBase() {
  if(window.location.protocol === 'file:') return window.location.href.split('#')[0];
  return window.location.pathname + window.location.search;
}

function mediaMatches(query, fallback) {
  try {
    if(window.matchMedia) return window.matchMedia(query).matches;
  } catch(e) {}
  return fallback;
}

function isLikelyDesktopSiteRequest() {
  const ua = navigator.userAgent || '';
  let uaDataMobile = null;
  try {
    if(navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
      uaDataMobile = navigator.userAgentData.mobile;
    }
  } catch(e) {}

  const coarsePointer = mediaMatches('(pointer: coarse)', false);
  const touchDevice = coarsePointer || (navigator.maxTouchPoints || 0) > 0;
  const mobileUa = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
  const narrowLayout = mediaMatches('(max-width: 991px)', window.innerWidth < 992);
  const screenShortSide = window.screen ? Math.min(window.screen.width || 0, window.screen.height || 0) : 0;
  const desktopLikeViewport = touchDevice && screenShortSide > 0 && window.innerWidth >= 900 && window.innerWidth > screenShortSide * 1.35;

  return narrowLayout && touchDevice && (uaDataMobile === false || !mobileUa || desktopLikeViewport);
}

function updateResponsiveMode() {
  if(!document.body) return;
  const narrowNav = mediaMatches('(max-width: 991px)', window.innerWidth < 992);
  const desktopSite = isLikelyDesktopSiteRequest();
  document.body.classList.toggle('desktop-site-mode', desktopSite);
  document.body.classList.toggle('mobile-app-mode', narrowNav && !desktopSite);
  document.body.setAttribute('data-responsive-mode', desktopSite ? 'desktop-site' : (narrowNav ? 'mobile' : 'desktop'));
}

function isMobileAppMode() {
  updateResponsiveMode();
  return document.body.classList.contains('mobile-app-mode') && mediaMatches('(max-width: 767px)', window.innerWidth < 768);
}

function isMobileNavMode() {
  updateResponsiveMode();
  return document.body.classList.contains('mobile-app-mode') && mediaMatches('(max-width: 991px)', window.innerWidth < 992);
}

function scheduleResponsiveModeUpdate() {
  updateResponsiveMode();
  setTimeout(updateResponsiveMode, 180);
}

updateResponsiveMode();
window.addEventListener('resize', scheduleResponsiveModeUpdate);
window.addEventListener('orientationchange', scheduleResponsiveModeUpdate);
document.addEventListener('DOMContentLoaded', updateResponsiveMode);
if(window.visualViewport) window.visualViewport.addEventListener('resize', scheduleResponsiveModeUpdate);

function setPaneHistory(id, mode) {
  id = normalizePaneId(id);
  let url = id === 'anasayfa_genel' ? routeBase() : routeBase() + '#' + id;
  try {
    if(mode === 'push') window.history.pushState({ pane: id }, '', url);
    else window.history.replaceState({ pane: id }, '', url);
  } catch(err) {
    // file:// ve eski WebView davranışlarında history yazılamazsa hash yeterli.
    if(id === 'anasayfa_genel') {
      if(window.location.hash) window.location.hash = '';
    } else if(window.location.hash.replace('#', '') !== id) {
      window.location.hash = id;
    }
  }
}

function ensurePaneVisibility(preferredId) {
  let main = getEl('mainApp');
  if(main && main.style.display === 'none') return;
  let id = normalizePaneId(preferredId || paneFromLocation());
  if(id === 'ayarlar' && !document.body.classList.contains('is-admin')) id = 'anasayfa_genel';
  let active = document.querySelector('.pane.active-pane');
  let visible = active && active.getAttribute('aria-hidden') !== 'true' && active.style.display !== 'none';
  if(!active || !visible || active.id !== id) executeTabSwitch(id, true);
}

function handlePaneTaskError(id, err) {
  console.error('Sekme hazırlanırken hata:', id, err);
  if(typeof showToast === 'function') showToast('Sayfa hazırlanırken bir hata oluştu. İçerik paneli açık tutuldu.', 'warning');
  ensurePaneVisibility(id);
}

function schedulePaneScrollHintRefresh(id) {
  if(typeof scheduleScrollHints !== 'function') return;
  let root = getEl(id) || document;
  setTimeout(() => scheduleScrollHints(root), 120);
  setTimeout(() => scheduleScrollHints(root), 520);
}

function runPaneTask(id, fn) {
  try {
    let result = fn();
    if(result && typeof result.then === 'function') {
      result.then(
        () => schedulePaneScrollHintRefresh(id),
        err => {
          handlePaneTaskError(id, err);
          schedulePaneScrollHintRefresh(id);
        }
      );
    } else {
      schedulePaneScrollHintRefresh(id);
    }
  } catch(err) {
    handlePaneTaskError(id, err);
    schedulePaneScrollHintRefresh(id);
  }
}

window.addEventListener('popstate', function(e) {
  let isMobile = isMobileAppMode();
  // Giriş ekranı görünüyorsa: tarayıcıyı kapat / bir önceki sayfaya git (zaten doğal davranış)
  let loginVisible = getEl('loginScreen') && getEl('loginScreen').style.display !== 'none';
  if(loginVisible) return; // Giriş ekranındaysa doğal davranışa bırak

  if(isMobile) {
    let hashPane = String(window.location.hash || '').replace('#', '');
    let statePane = e.state && e.state.pane ? e.state.pane : '';
    if(hashPane || statePane) {
      executeTabSwitch(normalizePaneId(statePane || hashPane), true);
      return;
    }
    if(currentPane === 'anasayfa_genel') {
      // Ana sayfadayken geri → uygulamadan çık (tarayıcıya bırak)
      // history.back() sonsuz döngüye girmemek için kontrol
      if(e.state && e.state.pane === 'anasayfa_genel') {
        // Gerçekten çıkmak istiyoruz; window.history.go(-1) yerine Android'in doğal back'i zaten çalışacak
        return;
      }
      executeTabSwitch('anasayfa_genel', true);
      return;
    }
    // Diğer sayfalardayken → Ana sayfaya dön
    executeTabSwitch('anasayfa_genel', true);
    setPaneHistory('anasayfa_genel', 'replace');
    return;
  }
  // Masaüstü: normal popstate davranışı
  let targetPane = (e.state && e.state.pane) ? e.state.pane : paneFromLocation();
  executeTabSwitch(targetPane, true);
});

window.addEventListener('hashchange', function() {
  let loginVisible = getEl('loginScreen') && getEl('loginScreen').style.display !== 'none';
  if(loginVisible) return;
  executeTabSwitch(paneFromLocation(), true);
});

function sTab(id, el) {
  executeTabSwitch(id, false);
  return false;
}

function closeSidebarIfOpen() {
  if(!isMobileNavMode()) return;
  const toggleBtn = document.querySelector('[data-lte-toggle="sidebar"]');
  if(document.body.classList.contains('sidebar-open') && toggleBtn) {
    try {
      toggleBtn.click();
      return;
    } catch(e) {}
  }
  document.body.classList.remove('sidebar-open');
  document.body.classList.add('sidebar-collapse');
  document.querySelectorAll('.sidebar-overlay,.sidebar-backdrop').forEach(el => el.remove());
}

function executeTabSwitch(id, isPopState) {
  id = normalizePaneId(id);
  if(id === 'ayarlar' && !document.body.classList.contains('is-admin')) id = 'anasayfa_genel';
  let targetPane = getEl(id);
  if(!targetPane) {
    id = 'anasayfa_genel';
    targetPane = getEl(id);
  }
  if(!targetPane) return false;

  if(currentPane === id && targetPane.classList.contains('active-pane') && !isPopState) {
    closeSidebarIfOpen();
    document.body.setAttribute('data-active-pane', id);
    setTimeout(() => ensurePaneVisibility(id), 0);
    if(typeof scheduleScrollHints === 'function') setTimeout(() => scheduleScrollHints(targetPane), 120);
    return false;
  }

  if (!isPopState) {
      let isMobile = isMobileAppMode();
      if (id === 'anasayfa_genel') {
          // Ana sayfaya dönerken history'yi temizle (back tuşu uygulamadan çıksın)
          setPaneHistory('anasayfa_genel', 'replace');
      } else if (isMobile) {
          // Mobilde her alt sayfaya geçişte yeni history kaydı oluştur
          // Böylece geri tuşu ana sayfaya geri döner
          setPaneHistory(id, 'push');
      } else if (currentPane === 'anasayfa_genel') {
          setPaneHistory(id, 'push');
      } else {
          setPaneHistory(id, 'replace');
      }
  }
  currentPane = id;
  document.body.setAttribute('data-active-pane', id);

  document.querySelectorAll('.pane').forEach(x=>{
    x.classList.remove('active-pane');
    x.setAttribute('aria-hidden', 'true');
    x.style.display = 'none';
  });
  targetPane.classList.add('active-pane');
  targetPane.setAttribute('aria-hidden', 'false');
  targetPane.style.display = 'block';
  document.querySelectorAll('.sidebar-menu .nav-link').forEach(x=>x.classList.remove('active')); 
  
  let matchLink = document.getElementById('nav-' + id);
  if(matchLink && !matchLink.classList.contains('nav-link')) matchLink = matchLink.querySelector('.nav-link');
  if (matchLink) matchLink.classList.add('active');

  // Bottom nav aktif item güncelle
  document.querySelectorAll('.bnav-item').forEach(x => { x.classList.remove('active'); x.removeAttribute('aria-current'); });
  let bnavItem = document.getElementById('bnav-' + id);
  if(bnavItem) { bnavItem.classList.add('active'); bnavItem.setAttribute('aria-current', 'page'); }

  if(id==='anasayfa_genel' && typeof uStat === 'function') runPaneTask(id, () => uStat());
  if(id==='anasayfa' && aNo && typeof reqProfile === 'function') runPaneTask(id, () => reqProfile());
  if(id==='sonuclar' && typeof reqUI === 'function') runPaneTask(id, () => reqUI());
  if(id==='rapor' && typeof raporInit === 'function') runPaneTask(id, () => raporInit());
  if(id==='ayarlar') runPaneTask(id, () => {
    if(typeof rTabS === 'function')rTabS();
    if(typeof rTabE === 'function')rTabE();
  });
  
  closeSidebarIfOpen();
  setTimeout(() => ensurePaneVisibility(id), 0);
  if(typeof scheduleScrollHints === 'function') setTimeout(() => scheduleScrollHints(targetPane), 120);
}

window.addEventListener('load', () => {
  updateResponsiveMode();
  setTimeout(() => ensurePaneVisibility(), 250);
});

async function sAct(no,clr=false){
  aNo=no;
  // Öğrenci seçilince arama kutusu her zaman temizlenir; seçili öğrenci rozette gösterilir.
  getEl('sInp').value=''; getEl('sRes').innerHTML=''; getEl('sRes').style.display='none';
  let s=getStuMap().get(aNo);
  getEl('aBadge').innerHTML=s?`<span class="badge rounded-pill px-3 py-2 sa-selected-pill"><i class="fas fa-check-circle me-1"></i>Seçili Öğrenci: ${escapeHtml(s.name)} (${escapeHtml(s.class)})</span>`:'<span class="text-muted">Seçilmedi</span>';
  let ab=getEl('anlStuBadge'); if(ab)ab.innerHTML=s?`<span class="badge rounded-pill px-2 py-1 sa-selected-pill selected-student-pill"><i class="fas fa-check-circle me-1"></i>Seçili Öğrenci: ${escapeHtml(s.name)} (${escapeHtml(s.class)})</span>`:'';
  getEl('homeArea').innerHTML='';
  if(no) await reqProfile();
  if(no && typeof decorateCardExplanations === 'function') {
    decorateCardExplanations(getEl('homeArea'));
    setTimeout(() => decorateCardExplanations(getEl('homeArea')), 180);
  }
  schedulePaneScrollHintRefresh('anasayfa');
  if(getEl('sonuclar').classList.contains('active-pane')) {
    reqUI();
    schedulePaneScrollHintRefresh('sonuclar');
  }
}

function getGrade(cls){
  return typeof getClassParts === 'function' ? getClassParts(cls).grade : (String(cls||'').match(/^(\d+)/)?.[1] || '');
}

function getBrVal(){ let el=getEl('aBr'); if(!el) return ''; let v=el.value; return (v==='__ALL__'||!v)?'':v; }

function mkChart(canvasId,labels,datasets,rev=false){
  let gCol='#e2e8f0';
  let txtCol='#475569';
  // === FIX: Aynı canvas üzerinde önceki Chart varsa yok et (memory leak ve render bozulmasını önler) ===
  try { let _prev = Chart.getChart && Chart.getChart(canvasId); if(_prev) _prev.destroy(); } catch(e){}
  let _cv = getEl(canvasId); if(!_cv) return null;
  return new Chart(_cv,{
    type:'bar', data:{labels,datasets}, plugins: [ChartDataLabels],
    options:{ 
      responsive:true,maintainAspectRatio:false, animation:false, 
      plugins:{
        legend:{ position:'top', labels:{ font:{size:10}, boxWidth:12, padding:6, generateLabels: function(chart) { let orig = Chart.defaults.plugins.legend.labels.generateLabels(chart); orig.forEach(lbl => { if(lbl.text && lbl.text.length > 20) lbl.text = lbl.text.substring(0,18)+'…'; }); return orig; } } },
        datalabels: { display: false }
      }, 
      scales:{ x:{grid:{color:gCol}, ticks:{font:{size:9}}}, y:{reverse:rev,min:rev?1:undefined,grid:{color:gCol}, ticks:{font:{size:9}}} } 
    }
  });
}

// ---- Yardımcı: HTML tablosunu SheetJS'e date-parse yapmadan dönüştür ----
function _tblToWsSafe(tbl){
  let aoa=[], rows=tbl.querySelectorAll('tr');
  rows.forEach(tr=>{
    let row=[], cells=tr.querySelectorAll('th,td');
    cells.forEach(td=>{
      let txt=(td.innerText||td.textContent||'').trim();
      row.push(txt);
    });
    aoa.push(row);
  });
  // aoa_to_sheet ile oluştur; tüm değerler string olarak gelir, raw:false ile parse etme
  let ws=XLSX.utils.aoa_to_sheet(aoa, {dense:false});
  // Tüm hücreleri string tipine zorla (sayısal görünen değerler dahil)
  let range=XLSX.utils.decode_range(ws['!ref']||'A1:A1');
  for(let R=range.s.r;R<=range.e.r;R++){
    for(let C=range.s.c;C<=range.e.c;C++){
      let ref=XLSX.utils.encode_cell({r:R,c:C});
      let cell=ws[ref];
      if(cell && cell.t!=='s'){ cell.t='s'; cell.v=String(cell.v); }
    }
  }
  // Sütun genişliklerini hesapla
  let wscols=[];
  for(let C=range.s.c;C<=range.e.c;C++){
    let maxW=6;
    for(let R=range.s.r;R<=range.e.r;R++){
      let cell=ws[XLSX.utils.encode_cell({r:R,c:C})];
      if(cell&&cell.v) maxW=Math.max(maxW,String(cell.v).length+2);
    }
    wscols.push({wch:Math.min(maxW,32)});
  }
  ws['!cols']=wscols;
  return ws;
}

function xXL(id,fn){
  let tbl=getEl(id), wb=XLSX.utils.book_new();
  let ws=_tblToWsSafe(tbl);
  XLSX.utils.book_append_sheet(wb,ws,'Rapor');
  XLSX.writeFile(wb,fn+'.xlsx');
}

function xXLMul(cId,fn){
  let wb=XLSX.utils.book_new(), ts=getEl(cId).getElementsByTagName('table');
  for(let i=0;i<ts.length;i++){
    let ws=_tblToWsSafe(ts[i]);
    XLSX.utils.book_append_sheet(wb,ws,ts[i].getAttribute('data-sh')||('Sayfa'+i));
  }
  XLSX.writeFile(wb,fn+'.xlsx');
}

// ---- xPR: merkezi yazdırma motoru ----
// Tek kaynak: yön, grid, kart, istatistik, tablo, grafik ve sayfa kırma kuralları burada yönetilir.
// Özel modlar yalnızca çıktı türü gerektirdiğinde devreye girer:
//   - compact-list: çok satırlı toplu liste tabloları
//   - one-page-summary: tek sınav öğrenci özeti
const _XPR_LANDSCAPE_IDS = new Set(['kCont','raporCont','raporRes']);
const _XPR_LANDSCAPE_TITLES = new Set(['Ogrenci_Tek_Sinav','Ogrenci_Ders','Ogrenci_Veri','Sinif_Analizi']);
function _xprIsLandscape(sourceId, title, orientation){
  if(orientation === 'landscape') return true;
  if(orientation === 'portrait')  return false;
  if(_XPR_LANDSCAPE_IDS.has(sourceId)) return true;
  if(_XPR_LANDSCAPE_TITLES.has(title)) return true;
  return false; // varsayılan dikey
}

function _xprIsMobilePrintDevice(){
  let ua = (navigator.userAgent || navigator.vendor || '').toString();
  let mobileUA = /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua);
  let coarse = false;
  try { coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch(e){}
  let sw = (window.screen && window.screen.width) ? window.screen.width : window.innerWidth;
  let sh = (window.screen && window.screen.height) ? window.screen.height : window.innerHeight;
  let smallScreen = Math.min(sw || 0, sh || 0) <= 820;
  return mobileUA || (smallScreen && (coarse || (navigator.maxTouchPoints || 0) > 1));
}

// Sınav türü paleti — style.css'teki .exam-color-N ile birebir aynı (yeni pencerede style.css yok, inline yazıyoruz)
// Yeni palet: birbirinden net ayırt edilebilen, şık 8 renk.
const _XPR_EXAM_PALETTE = ['#2563eb','#059669','#d97706','#dc2626','#7c3aed','#0891b2','#be185d','#4b5563'];

function _xprExamColorFor(el){
  // 1) Önce element veya en yakın atadan data-exam-color="0..7" oku
  let scope = el.closest && el.closest('[data-exam-color]');
  if(scope){
    let idx = parseInt(scope.getAttribute('data-exam-color'), 10);
    if(!isNaN(idx) && idx >= 0 && idx < _XPR_EXAM_PALETTE.length) return _XPR_EXAM_PALETTE[idx];
  }
  // 2) exam-color-N sınıfını ara
  let cl = (el.className && el.className.toString) ? el.className.toString() : '';
  let m = cl.match(/exam-color-(\d)/);
  if(m){ return _XPR_EXAM_PALETTE[parseInt(m[1],10)] || null; }
  let anc = el.closest && el.closest('[class*="exam-color-"]');
  if(anc){
    let m2 = (anc.className.toString()||'').match(/exam-color-(\d)/);
    if(m2) return _XPR_EXAM_PALETTE[parseInt(m2[1],10)] || null;
  }
  // 3) Computed --exam-color
  try {
    let cs = window.getComputedStyle(el);
    let v = (cs.getPropertyValue('--exam-color')||'').trim();
    if(v) return v;
  } catch(e){}
  return null;
}

function xPR(sourceId, title, btn, orientation) {
  // Chart tooltip temizliği (orijinal davranış korunuyor)
  if(window._karneCharts) window._karneCharts.forEach(ch => { try { ch.tooltip.setActiveElements([]); ch.update('none'); } catch(e){} });
  if(window._raporCharts) window._raporCharts.forEach(ch => { try { ch.tooltip.setActiveElements([]); ch.update('none'); } catch(e){} });
  try { if(c && c.a){ c.a.tooltip.setActiveElements([]); c.a.update('none'); } } catch(e){}
  try { if(c && c.h){ c.h.tooltip.setActiveElements([]); c.h.update('none'); } } catch(e){}

  // YÖN: explicit param > merkezi harita > default portrait

  let sourceEl = getEl(sourceId);
  if(!sourceEl){ return; }
  let isLandscape = _xprIsLandscape(sourceId, title, orientation);
  let isExamDetailListPrint = (sourceId === 'pED' || sourceId === 'pEDAll') && !!sourceEl.querySelector('.list-scroll table');
  let isCompactListPrint = (sourceId === 'raporCont' && sourceEl.classList.contains('print-compact-list')) || isExamDetailListPrint;
  let isMobileListPrint = isCompactListPrint && _xprIsMobilePrintDevice();
  let isOnePageSummaryPrint = title === 'Ogrenci_Tek_Sinav';
  // Masaüstünde liste yatay kalır. Mobil tarayıcılar çoğu kez landscape'i yok saydığı için
  // mobil liste çıktısı özel portrait düzeniyle hazırlanır.
  if(isCompactListPrint) isLandscape = !isMobileListPrint;
  let orig = btn ? btn.innerHTML : '';
  if(btn){ btn.innerHTML = "<i class='fas fa-spinner fa-spin me-1'></i>"; btn.disabled = true; }
  let winW = isLandscape ? 1200 : 900;
  let printWin = window.open('', '_blank', `width=${winW},height=820,scrollbars=yes`);
  if(!printWin){
    if(typeof showToast === 'function') showToast('Açılır pencere engellendi! Tarayıcıdan izin verin.', 'warning', 6000);
    if(btn){ btn.innerHTML = orig; btn.disabled = false; }
    return;
  }
  try {
    printWin.document.write('<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><title>Rapor hazırlanıyor</title></head><body style="font-family:Arial,sans-serif;padding:20px;">Rapor hazırlanıyor...</body></html>');
    printWin.document.close();
  } catch(e){}

  // Canvas → PNG
  let canvasMap = [];
  sourceEl.querySelectorAll('canvas').forEach(cv => {
    try { canvasMap.push({ id: cv.id, url: cv.toDataURL('image/png', 1.0) }); } catch(e){}
  });

  // CSS link'leri (style.css HARİÇ — proje stilleri kasıtlı dışarıda; AdminLTE/FA içeride)
  let cssLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .filter(l => !l.href.includes('style.css'))
    .map(l => `<link rel="stylesheet" href="${l.href}">`).join('\n');

  let clone = sourceEl.cloneNode(true);
  if(isExamDetailListPrint){
    clone.classList.add('exam-detail-list-print', 'rapor-list-report');
    clone.querySelectorAll('.list-scroll table').forEach(tbl => {
      tbl.classList.add('rapor-list-table', 'exam-detail-list-table');
      let headCells = Array.from(tbl.querySelectorAll('thead tr:last-child th'));
      let totalCols = headCells.length;
      if(totalCols > 0 && !tbl.querySelector('thead tr.print-title-row')){
        let titleMain = (clone.querySelector('.report-title-main')?.textContent || title || 'Toplu Liste').replace(/\s+/g, ' ').trim();
        let titleSub = (clone.querySelector('.report-title-sub')?.textContent || '').replace(/\s+/g, ' ').trim();
        let titleRow = document.createElement('tr');
        titleRow.className = 'print-title-row';
        let titleCell = document.createElement('th');
        titleCell.colSpan = totalCols;
        titleCell.textContent = titleSub ? `${titleMain} | ${titleSub}` : titleMain;
        titleRow.appendChild(titleCell);
        let thead = tbl.querySelector('thead');
        if(thead) thead.insertBefore(titleRow, thead.firstChild);
      }
      let columnRole = idx => {
        if(idx === 0) return 'rl-idx';
        if(idx === 1) return 'rl-name';
        if(idx === 2) return 'rl-class';
        if(idx === 3) return 'rl-date';
        if(idx === 4) return 'rl-publisher';
        if(idx >= totalCols - 4) {
          if(idx === totalCols - 4) return 'rl-net';
          if(idx === totalCols - 3) return 'rl-score';
          return 'rl-rank';
        }
        return 'rl-sub';
      };
      tbl.querySelectorAll('tr').forEach(row => {
        Array.from(row.cells || []).forEach((cell, idx) => {
          if(row.classList.contains('print-title-row')) return;
          cell.classList.add(columnRole(idx));
        });
      });
      if(!tbl.querySelector('colgroup')){
        if(totalCols > 0){
          let subjectCols = Math.max(totalCols - 9, 0);
          let subjectWidth = subjectCols ? Math.max(3.2, (100 - 60) / subjectCols) : 4;
          let widths = [];
          for(let i=0; i<totalCols; i++){
            if(i === 0) widths.push(3.4);
            else if(i === 1) widths.push(16);
            else if(i === 2) widths.push(4.6);
            else if(i === 3) widths.push(7.2);
            else if(i === 4) widths.push(6);
            else if(i >= totalCols - 4) widths.push(i >= totalCols - 2 ? 6 : 5.4);
            else widths.push(subjectWidth);
          }
          let cg = document.createElement('colgroup');
          widths.forEach((w, idx) => {
            let col = document.createElement('col');
            col.style.width = w + '%';
            let role = columnRole(idx).replace('rl-', 'rl-col-');
            col.className = role;
            cg.appendChild(col);
          });
          tbl.insertBefore(cg, tbl.firstChild);
        }
      }
    });
  }

  // Canvas → IMG değişimi
  clone.querySelectorAll('canvas').forEach((cv, idx) => {
    let entry = canvasMap.find(m => m.id && m.id === cv.id) || canvasMap[idx];
    if(!entry){ cv.remove(); return; }
    let img = document.createElement('img');
    img.src = entry.url;
    img.className = 'print-chart-img';
    cv.parentElement.replaceChild(img, cv);
  });

  // Etkileşimli risk düğmelerini yazdırmada statik etikete çevir.
  clone.querySelectorAll('button.risk-badge').forEach(btn => {
    let span = document.createElement('span');
    span.className = btn.className;
    span.innerHTML = btn.innerHTML;
    span.setAttribute('title', btn.getAttribute('title') || '');
    btn.parentElement.replaceChild(span, btn);
  });

  // Yazdırılmaması gerekenleri at
  clone.querySelectorAll('.no-print, .d-flex.justify-content-end, .scroll-hint, button:not(.risk-badge), .btn:not(.risk-badge)').forEach(el => el.remove());
  clone.querySelectorAll('.report-header').forEach(el => el.style.display = 'flex');

  // Ortak parça düzeni: bilgi kartı, istatistik, kutu grafik, tablo ve grafik bloklarını yazdırmada ayır.
  const markPrintPart = el => {
    if(!el || el.classList.contains('analysis-print-part')) return;
    if((el.classList.contains('table-responsive') || el.classList.contains('scroll')) && !el.querySelector('table')) return;
    el.classList.add('analysis-print-part');
  };
  clone.querySelectorAll('.trend-card, .boxplot-card, .chart-box, .table-responsive, .scroll, .card.shadow-sm.avoid-break, .risk-note, #riskStatCards, .risk-list-wrap').forEach(markPrintPart);
  clone.querySelectorAll('.row').forEach(row => {
    try {
      if(row.querySelector(':scope > [class*="col-"] .sec-card, :scope > [class*="col-"] .risk-stat-card')) markPrintPart(row);
    } catch(e) {
      if(row.querySelector('.sec-card, .risk-stat-card')) markPrintPart(row);
    }
  });
  if(isCompactListPrint){
    clone.querySelectorAll('.scroll.list-scroll, .table-responsive').forEach(el => {
      if(el.querySelector('table')) el.classList.remove('analysis-print-part');
    });
  }

  // ── SINAV TÜRÜ RENKLERİNİ INLINE YAZ ───────────────────────────────
  // Her .exam-type-block / .karne-bolum / üst seviye renkli kart için
  // gerçek hex rengi DOM'dan oku ve hem CSS değişkeni hem inline border olarak yapıştır.
  let srcBlocks   = sourceEl.querySelectorAll('.exam-type-block, .karne-bolum, [data-exam-color]');
  let cloneBlocks = clone.querySelectorAll('.exam-type-block, .karne-bolum, [data-exam-color]');
  cloneBlocks.forEach((el, idx) => {
    let src = srcBlocks[idx]; if(!src) return;
    let color = _xprExamColorFor(src);
    if(!color) return;
    el.style.setProperty('--exam-color', color);
    el.setAttribute('data-print-color', color);
    if(el.classList.contains('exam-type-block') || el.classList.contains('karne-bolum')){
      el.style.borderLeft  = `4px solid ${color}`;
      el.style.borderRight = `4px solid ${color}`;
      el.style.borderTop   = `1px solid #c7d0db`;
      el.style.borderBottom= `1px solid #c7d0db`;
      el.style.borderRadius= '6px';
      el.style.background  = '#fff';
      el.style.padding     = el.style.padding || '8px 10px';
    }
    // Bloğun içindeki tüm "kimlik" öğelerini sınav türü rengiyle boya
    // (varsayılan lacivert gradient/mavi başlıklar yerine).
    el.querySelectorAll('.report-header, .print-page-hdr').forEach(h => {
      h.style.background = '#f3f6fb';
      h.style.color = '#111827';
      h.style.borderLeft = `4px solid ${color}`;
      h.style.borderBottom = '1px solid #cbd5e1';
      h.querySelectorAll('*').forEach(child => child.style.color = '#111827');
    });
    el.querySelectorAll('.table thead th, table thead th').forEach(th => {
      th.style.background = '#f1f5f9';
      th.style.color = '#111827';
      th.style.borderBottom = `2px solid ${color}`;
    });
    el.querySelectorAll('tr.avg-row td').forEach(td => {
      td.style.background = `${color}1a`; // ~10% opacity
      td.style.color = color;
      td.style.borderTop = `2px solid ${color}80`;
    });
    el.querySelectorAll('.text-primary, .card-title, h3, h4, h5').forEach(t => {
      // Sadece sınav türü bloğunun "kimlik" başlıklarını boya
      t.style.color = color;
    });
    el.querySelectorAll('.card-header').forEach(ch => {
      ch.style.borderBottom = `2px solid ${color}`;
      ch.style.background = `${color}14`; // ~8% opacity
    });
    // Blok içindeki tüm kartlara sınav türü rengini şerit olarak da uygula
    el.querySelectorAll('.card').forEach(cd => {
      // Mevcut inline border varsa (cards loop'unda set edilecek) bozmamak için
      // sadece soldaki şeridi güçlendir.
      cd.style.borderLeft = `3px solid ${color}`;
    });
  });

  // ── KARTLARIN ÇERÇEVELERİNİ INLINE GARANTİLE ──────────────────────
  let srcCards   = sourceEl.querySelectorAll('.card, .home-stat-card, .boxplot-card, .trend-card, .risk-stat-card, .sec-card');
  let cloneCards = clone.querySelectorAll('.card, .home-stat-card, .boxplot-card, .trend-card, .risk-stat-card, .sec-card');
  cloneCards.forEach((el, idx) => {
    let src = srcCards[idx]; if(!src) return;
    let cs = window.getComputedStyle(src);
    // Renkli sol/sağ şerit varsa koru
    let leftW  = parseFloat(cs.borderLeftWidth)  || 0;
    let rightW = parseFloat(cs.borderRightWidth) || 0;
    let leftC  = (cs.borderLeftColor  && cs.borderLeftColor  !== 'rgba(0, 0, 0, 0)') ? cs.borderLeftColor  : '';
    let rightC = (cs.borderRightColor && cs.borderRightColor !== 'rgba(0, 0, 0, 0)') ? cs.borderRightColor : '';
    let topC   = (cs.borderTopColor   && cs.borderTopColor   !== 'rgba(0, 0, 0, 0)') ? cs.borderTopColor   : '#dee2e6';
    let topW   = parseFloat(cs.borderTopWidth)   || 1;
    // Sınav rengi var mı? (kart kendi exam-color-N taşıyor olabilir veya atasından miras alır)
    let exC = _xprExamColorFor(src);
    if(exC){
      if(leftW >= 2 || el.classList.contains('home-stat-card') || el.classList.contains('sec-card')){
        el.style.borderLeft  = `${Math.max(leftW,3)}px solid ${exC}`;
      } else if(leftW > 0){
        el.style.borderLeft  = `${leftW}px solid ${leftC || exC}`;
      }
      if(rightW >= 2 || el.classList.contains('sec-card')){
        el.style.borderRight = `${Math.max(rightW,3)}px solid ${exC}`;
      } else if(rightW > 0){
        el.style.borderRight = `${rightW}px solid ${rightC || exC}`;
      }
      if(topW >= 2){
        el.style.borderTop = `${topW}px solid ${exC}`;
      }
    } else {
      if(leftW > 0)  el.style.borderLeft  = `${leftW}px solid ${leftC || '#dee2e6'}`;
      if(rightW > 0) el.style.borderRight = `${rightW}px solid ${rightC || '#dee2e6'}`;
      if(topW > 0)   el.style.borderTop   = `${topW}px solid ${topC}`;
    }
    el.style.borderBottom = el.style.borderBottom || `1px solid #dee2e6`;
    el.style.background = (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') ? cs.backgroundColor : '#fff';
    if(cs.backgroundImage && cs.backgroundImage !== 'none') el.style.backgroundImage = cs.backgroundImage;
    el.style.boxShadow = 'none';
    el.style.borderRadius = cs.borderRadius || '4px';
  });

  // ── SAYFA KIRMA: Her sınav türü kendi sayfasında ──────────────────
  // Toplu rapor (öğrenciler arası): her wrapper yeni sayfa
  let wrappers = clone.querySelectorAll('.student-rapor-wrapper');
  wrappers.forEach((w, i) => {
    if(i > 0) w.style.cssText += ';page-break-before:always;break-before:page;';
    w.style.cssText += ';page-break-inside:auto;break-inside:auto;';
  });

  // .exam-type-block: her biri kendi sayfasında başlar (wrapper içinde ilk hariç, global ilk hariç)
  clone.querySelectorAll('.exam-type-block').forEach((blk, idx) => {
    let wrapper = blk.closest('.student-rapor-wrapper');
    let isFirst;
    if(wrapper){
      isFirst = wrapper.querySelector('.exam-type-block') === blk;
    } else {
      isFirst = (idx === 0);
    }
    if(!isCompactListPrint && !isFirst){
      blk.style.cssText += ';page-break-before:always;break-before:page;';
    }
    // Bloğun kendisi taşabilir; içerik tek sayfaya zaten sığacak şekilde tasarlandı
    blk.style.cssText += ';page-break-inside:auto;break-inside:auto;';
    // Blok içindeki kart/grafik/tablo birimleri: compact liste modunda avoid yazma,
    // CSS kuralları yönetir. Diğer modlarda inline avoid yaz.
    if(!isCompactListPrint){
      blk.querySelectorAll('.card, .chart-box, .boxplot-card, .trend-card, .risk-stat-card, .sec-card').forEach(el => {
        el.style.cssText += ';page-break-inside:avoid;break-inside:avoid;';
      });
    }
    // Stu name (varsa) bloğun başına başlık olarak ekle
    let stuName  = blk.getAttribute('data-stu-name')  || '';
    let stuClass = blk.getAttribute('data-stu-class') || '';
    if(stuName && !blk.classList.contains('karne-bolum')){
      let hdr = document.createElement('div');
      hdr.className = 'report-header print-page-hdr';
      hdr.style.cssText = 'margin:0 0 8px 0;';
      hdr.innerHTML = `<span style="font-size:14px;"><i class="fas fa-user-graduate" style="margin-right:6px;"></i><strong>${escapeHtml(stuName)}</strong></span><span style="font-size:11px;">Sınıf: ${escapeHtml(stuClass)} &nbsp;|&nbsp; ${new Date().toLocaleDateString('tr-TR')}</span>`;
      blk.insertBefore(hdr, blk.firstChild);
    }
  });

  // .karne-bolum (exam-type-block değilse): her biri yeni sayfa (ilk hariç)
  clone.querySelectorAll('.karne-bolum').forEach((blk, idx) => {
    if(blk.classList.contains('exam-type-block')) return;
    if(!isCompactListPrint && idx > 0) blk.style.cssText += ';page-break-before:always;break-before:page;';
    blk.style.cssText += ';page-break-inside:auto;break-inside:auto;';
  });

  // Liste tabloları (pED, pEDAll vb.): satır içi kırma yok, thead her sayfada
  clone.querySelectorAll('table').forEach(tbl => {
    tbl.style.pageBreakInside = 'auto';
    tbl.style.breakInside = 'auto';
    tbl.style.width = '100%';
    tbl.style.borderCollapse = 'collapse';
  });
  clone.querySelectorAll('tbody tr').forEach(tr => {
    tr.style.pageBreakInside = 'avoid';
    tr.style.breakInside = 'avoid';
  });
  clone.querySelectorAll('thead').forEach(h => {
    h.style.display = 'table-header-group';
  });
  clone.querySelectorAll('tfoot').forEach(f => {
    f.style.display = 'table-footer-group';
  });

  // Sınav türü palet sabitleri yeni pencerede de class olarak çalışsın diye CSS bloğu üret
  let paletteCss = _XPR_EXAM_PALETTE.map((c,i) => `.exam-color-${i}{--exam-color:${c};}`).join('\n');
  let printModeClass = isCompactListPrint
    ? `print-compact-list-mode${isMobileListPrint ? ' print-mobile-list-mode' : ''}${isExamDetailListPrint ? ' print-exam-detail-list-mode' : ''}`
    : (isOnePageSummaryPrint ? 'print-one-page-summary-mode' : 'print-standard-report-mode');
  let printBaseFont = isMobileListPrint ? '9.2px' : (isCompactListPrint ? '10.5px' : (isOnePageSummaryPrint ? '9px' : (isLandscape ? '10px' : '10.5px')));
  let printPageMargin = isMobileListPrint ? '4mm 2.5mm' : (isCompactListPrint ? '7mm 6mm' : (isOnePageSummaryPrint ? '6mm 6mm' : '8mm 7mm'));
  let printTableFont = isMobileListPrint ? '7.4px' : (isCompactListPrint ? '9px' : (isOnePageSummaryPrint ? '7.5px' : (isLandscape ? '8px' : '9px')));
  let printTableHeadFont = isMobileListPrint ? '7px' : (isCompactListPrint ? '8.8px' : (isOnePageSummaryPrint ? '7.2px' : (isLandscape ? '7.5px' : '8.5px')));
  let printTablePadding = isMobileListPrint ? '1.35px 1.6px' : (isCompactListPrint ? '3px 4px' : (isOnePageSummaryPrint ? '1.5px 3px' : '2px 4px'));
  let printChartMaxHeight = isOnePageSummaryPrint ? '112px' : (isLandscape ? '150px' : '180px');
  let printBoxplotMaxHeight = isOnePageSummaryPrint ? '92px' : (isLandscape ? '110px' : '140px');

  let printHtml = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title}</title>
${cssLinks}
<style>
  *,*::before,*::after{box-sizing:border-box;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
  html,body{width:100%;margin:0;padding:0;background:#fff;color:#212529;font-family:'Source Sans 3','Source Sans Pro',"Segoe UI",Arial,sans-serif;font-size:${printBaseFont};}
  @page{size:A4 ${isLandscape?'landscape':'portrait'};margin:${printPageMargin};}

  /* Sınav türü paleti (yeni pencerede style.css yok) */
  ${paletteCss}

  /* Grid */
  .row{display:flex !important;flex-wrap:wrap !important;width:100% !important;margin:0 -4px !important;}
  .col-12,.col-sm-12,.col-md-12,.col-lg-12{flex:0 0 100% !important;max-width:100% !important;padding:0 4px !important;}
  .col-6,.col-sm-6,.col-md-6,.col-lg-6{flex:0 0 50% !important;max-width:50% !important;padding:0 4px !important;}
  .col-md-4,.col-lg-4,.col-md-4.col-sm-12{flex:0 0 33.333% !important;max-width:33.333% !important;padding:0 4px !important;}
  .col-md-3,.col-sm-3{flex:0 0 25% !important;max-width:25% !important;padding:0 4px !important;}
  .col-md-2{flex:0 0 16.666% !important;max-width:16.666% !important;padding:0 4px !important;}
  .col,.col-lg{flex:1 1 0 !important;max-width:100% !important;padding:0 4px !important;}

  .mb-1{margin-bottom:3px !important;} .mb-2{margin-bottom:5px !important;}
  .mb-3{margin-bottom:8px !important;} .mb-4{margin-bottom:12px !important;}
  .mt-2{margin-top:5px !important;} .mt-3{margin-top:8px !important;}
  .p-2{padding:5px !important;} .p-0{padding:0 !important;}

  /* Rapor başlığı (varsayılan; sınav türü blokları içindeki başlıklar inline ile sınav rengine boyanır) */
  .report-header{display:flex !important;align-items:center;justify-content:space-between;background:#f3f6fb !important;color:#111827 !important;padding:8px 14px;border-radius:5px;margin-bottom:8px;border-left:4px solid #64748b;border-bottom:1px solid #cbd5e1;}
  .report-header *{color:#111827 !important;}

  /* Tablolar — başlık her sayfada, satır içi kırma yok */
  .table{width:100% !important;border-collapse:collapse !important;font-size:${printTableFont} !important;margin-bottom:5px;}
  .table th,.table td{border:1px solid #bbb !important;padding:${printTablePadding} !important;color:#212529 !important;vertical-align:middle !important;}
  .table thead th{background:#f1f5f9 !important;color:#111827 !important;font-size:${printTableHeadFont} !important;font-weight:700;border-bottom:2px solid #cbd5e1 !important;}
  .scroll table thead th,.table-responsive table thead th{position:static !important;top:auto !important;z-index:auto !important;}
  thead{display:table-header-group !important;}
  tfoot{display:table-footer-group !important;}
  tbody tr{page-break-inside:avoid !important;break-inside:avoid !important;}
  .scroll,.list-scroll,.table-responsive{overflow:visible !important;max-height:none !important;}
  tr.highlight-row td{background:#fff3cd !important;font-weight:bold !important;}
  tr.absent-row td{background:#f8d7da !important;color:#721c24 !important;}
  tr.avg-row td{background:#e8eef7 !important;color:#1a5fa8 !important;font-weight:bold !important;border-top:2px solid #9cb3d8 !important;}
  /* Tekrarlanan başlık satırı — ekranda gizli, yazdırmada her sayfada göster */
  tr.print-title-row{display:none;}
  @media print{
    /* rapor-list-block card-header print'te gizli — yerine print-title-row her sayfada tekrar eder */
    .rapor-list-block>.card-header{display:none !important;}
    tr.print-title-row{display:table-row !important;}
    tr.print-title-row th{
      display:table-cell !important;
      background:var(--exam-color,#1a5fa8) !important;
      color:#fff !important;
      font-size:9px !important;
      font-weight:700 !important;
      padding:3px 6px !important;
      border:none !important;
      letter-spacing:0.2px;
    }
  }

  /* Kartlar — inline border'ları KORU; sadece varsayılanları ver */
  .card{background:#fff;border:1px solid #dee2e6;border-radius:4px;margin-bottom:6px;display:block;box-shadow:none !important;background-clip:padding-box !important;}
  .card-header{background:#f5f5f5 !important;padding:5px 10px;border-bottom:1px solid #dee2e6;font-size:${isLandscape?'10px':'10.5px'};font-weight:600;}
  .card-body{padding:6px 8px;}
  .card-title{font-size:${isLandscape?'10.5px':'11px'} !important;margin:0;}

  /* Sınav türü blokları — inline renk gelir; varsayılan da ver */
  .exam-type-block,.karne-bolum{background:#fff;border:1px solid #c7d0db;border-left:4px solid var(--exam-color,#1a5fa8);border-right:4px solid var(--exam-color,#1a5fa8);border-radius:6px;padding:8px 10px;background-clip:padding-box !important;}
  .exam-type-block>h5,.karne-bolum>h5{font-size:11px !important;border-bottom:1px solid #d5dde7;padding-bottom:5px;margin:0 0 10px 0;color:var(--exam-color,#1a5fa8);}

  /* sec-card / home-stat-card */
  .sec-card,.home-stat-card{background:#fff;border:1px solid #e9ecef;border-left:3px solid var(--exam-color,#1a5fa8);border-right:3px solid var(--exam-color,#1a5fa8);border-radius:8px;padding:8px 10px;display:flex;align-items:center;gap:10px;min-height:60px;box-shadow:none !important;}
  .sec-card .sec-icon{flex-shrink:0;width:36px;height:36px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;color:#fff !important;background:var(--exam-color,#1a5fa8) !important;font-size:1em;}
  .sec-card.sec-pos .sec-icon{background:#198754 !important;}
  .sec-card.sec-neg .sec-icon{background:#dc3545 !important;}
  .sec-card.sec-neutral .sec-icon{background:#6c757d !important;}
  .sec-card .sec-label{font-size:0.7rem;font-weight:700;color:#6c757d;text-transform:uppercase;}
  .sec-card .sec-value{font-size:1rem;font-weight:700;color:#212529;line-height:1.2;}
  .sec-card .sec-sub{font-size:0.7rem;color:#6c757d;}
  .sec-card.sec-pos .sec-value{color:#198754;}
  .sec-card.sec-neg .sec-value{color:#dc3545;}
  .class-info-cards{display:flex !important;flex-wrap:wrap !important;align-items:stretch !important;margin:0 -3px 5px !important;}
  .class-info-cards>[class*="col-"]{display:flex !important;padding:0 3px !important;margin-bottom:5px !important;}
  .class-info-cards .sec-card{width:100%;min-height:54px;}
  body.print-standard-report-mode #pC .class-summary-cards>[class*="col-"]{flex:0 0 33.333% !important;max-width:33.333% !important;}
  body.print-standard-report-mode #pC .class-compare-cards>[class*="col-"]{flex:0 0 50% !important;max-width:50% !important;}
  body.print-standard-report-mode #pC .class-context-cards>[class*="col-"]{flex:1 1 0 !important;max-width:100% !important;}
  body.print-standard-report-mode #pC .class-progress-cards>[class*="col-"]{flex:0 0 50% !important;max-width:50% !important;}
  body.print-standard-report-mode #pC .class-info-cards.analysis-print-part + .class-info-cards.analysis-print-part{margin-top:0 !important;padding-top:0 !important;border-top:0 !important;}
  body.print-standard-report-mode #pC .class-info-cards.analysis-print-part + .class-info-cards.analysis-print-part::before{content:none !important;display:none !important;}
  .class-rank-tables{display:flex !important;flex-wrap:nowrap !important;align-items:stretch !important;margin:0 -3px 5px !important;}
  .class-rank-tables>[class*="col-"]{display:flex !important;flex:0 0 50% !important;max-width:50% !important;padding:0 3px !important;}
  .class-rank-tables .card{width:100%;}

  /* İstatistik blokları */
  .stats-block{background:#f5f7fa !important;border:1px solid #dee2e6;border-radius:6px;padding:6px 8px;margin-bottom:5px;page-break-inside:avoid !important;break-inside:avoid !important;}
  .stats-row{display:flex !important;flex-wrap:wrap !important;align-items:stretch !important;width:100% !important;}
  .stats-item{flex:1 1 160px;min-width:140px;position:relative;text-align:center;padding:5px 10px;}
  .stats-item:not(:last-child)::after{content:"";position:absolute;top:16%;bottom:16%;right:0;width:1px;background:linear-gradient(180deg,transparent,#c7d0dc 16%,#8fa0b5 50%,#c7d0dc 84%,transparent);box-shadow:1px 0 0 rgba(255,255,255,0.9);}
  .stats-label{font-size:0.68rem;font-weight:800;color:#64748b;text-transform:uppercase;line-height:1.12;}
  .stats-value{font-size:0.96rem;font-weight:800;color:#334155;line-height:1.15;margin-top:2px;}
  .stats-sub{font-size:0.68rem;color:#6c757d;line-height:1.2;margin-top:2px;}
  .stats-item.stat-pos .stats-value{color:#198754;}
  .stats-item.stat-neg .stats-value{color:#dc3545;}
  .stats-item.stat-neutral .stats-value{color:#495057;}

  /* Risk sayaç kartları */
  .risk-stat-card{display:flex !important;align-items:center;gap:8px;border-radius:5px;margin-bottom:4px;padding:6px 8px;page-break-inside:avoid !important;break-inside:avoid !important;}
  .risk-stat-icon{display:flex !important;align-items:center;justify-content:center;width:34px !important;min-width:34px;height:34px;border-radius:7px;background:rgba(255,255,255,0.18);font-size:1em;color:inherit;}
  .risk-stat-content{flex:1;min-width:0;}
  .risk-stat-label{display:block;font-size:0.72em;font-weight:700;line-height:1.15;}
  .risk-stat-number{display:block;font-size:1.05em;font-weight:bold;margin:1px 0;line-height:1.1;}

  /* Trend kartı */
  .trend-card{background:#f5f7fa !important;border:1px solid #dee2e6;border-radius:6px;padding:6px 8px;margin-bottom:5px;page-break-inside:avoid !important;break-inside:avoid !important;}
  .trend-card .trend-metric{position:relative !important;padding-left:6px !important;padding-right:6px !important;}
  .trend-card .trend-metric:not(:last-child)::after{content:"" !important;position:absolute !important;top:16% !important;bottom:16% !important;right:0 !important;width:1px !important;background:linear-gradient(180deg,transparent,#c7d0dc 16%,#8fa0b5 50%,#c7d0dc 84%,transparent) !important;box-shadow:1px 0 0 rgba(255,255,255,0.9) !important;}
  .trend-stat-card{overflow:hidden !important;page-break-inside:avoid !important;break-inside:avoid !important;}
  .trend-stat-grid{display:grid !important;grid-template-columns:repeat(auto-fit,minmax(118px,1fr)) !important;margin:0 -1px -1px 0 !important;}
  .trend-stat-item{position:relative !important;border-right:0 !important;}
  .trend-stat-item:not(:last-child)::after{content:"" !important;position:absolute !important;top:18% !important;bottom:18% !important;right:0 !important;width:1px !important;background:linear-gradient(180deg,transparent,#c7d0dc 16%,#8fa0b5 50%,#c7d0dc 84%,transparent) !important;box-shadow:1px 0 0 rgba(255,255,255,0.9) !important;}
  body.print-standard-report-mode #pC .trend-stat-grid{grid-template-columns:repeat(4,1fr) !important;}
  body.print-standard-report-mode #pC .trend-stat-item:nth-child(4n)::after{display:none !important;}
  .trend-stat-item{min-height:56px !important;padding:5px 7px !important;text-align:center;display:flex !important;flex-direction:column !important;justify-content:center !important;border-bottom:1px solid #d7dde5 !important;}
  .trend-stat-value{font-size:0.86rem !important;line-height:1.1 !important;min-height:0 !important;}
  .trend-stat-value .trend-indicator{font-size:0.72rem !important;white-space:normal !important;}
  .trend-stat-label{font-size:0.58rem !important;line-height:1.08 !important;margin-top:3px !important;}
  .trend-stat-sub{font-size:0.56rem !important;line-height:1.1 !important;margin-top:2px !important;}
  .trend-indicator{display:inline-flex;align-items:center;padding:2px 7px;border-radius:20px;font-size:0.78em;font-weight:bold;}
  .trend-up{background:rgba(40,167,69,0.15) !important;color:#1e7e34 !important;}
  .trend-down{background:rgba(220,53,69,0.15) !important;color:#b02a37 !important;}
  .trend-stable{background:rgba(108,117,125,0.15) !important;color:#495057 !important;}

  /* Grafikler */
  .print-chart-img{max-width:100%;width:100%;max-height:${printChartMaxHeight};height:auto;object-fit:contain;display:block;margin:2px auto 4px;}
  .chart-box{height:auto !important;margin-bottom:4px;page-break-inside:avoid !important;break-inside:avoid !important;}
  .analysis-print-part{position:relative;page-break-inside:avoid;break-inside:avoid;}
  .analysis-print-part + .analysis-print-part{margin-top:10px !important;padding-top:9px !important;border-top:1px solid #d8dee8 !important;}
  .analysis-print-part + .analysis-print-part::before{content:"";position:absolute;top:-1px;left:50%;width:min(360px,72%);height:1px;transform:translateX(-50%);background:linear-gradient(90deg,transparent,#c7d0dc 16%,#9aa9ba 50%,#c7d0dc 84%,transparent);}
  .analysis-print-part:has(> [class*="col-"] .sec-card) + .analysis-print-part:has(> [class*="col-"] .sec-card),
  .analysis-print-part:has(> [class*="col-"] .risk-stat-card) + .analysis-print-part:has(> [class*="col-"] .risk-stat-card){margin-top:4px !important;padding-top:0 !important;border-top:0 !important;}
  .analysis-print-part:has(> [class*="col-"] .sec-card) + .analysis-print-part:has(> [class*="col-"] .sec-card)::before,
  .analysis-print-part:has(> [class*="col-"] .risk-stat-card) + .analysis-print-part:has(> [class*="col-"] .risk-stat-card)::before{content:none !important;display:none !important;}
  .single-exam-chart-title.chart-section-title{position:relative;margin-top:10px !important;padding-top:9px !important;margin-bottom:3px !important;}
  .single-exam-chart-title.chart-section-title::before{content:"";position:absolute;top:0;left:50%;width:min(360px,72%);height:1px;transform:translateX(-50%);background:linear-gradient(90deg,transparent,#c7d0dc 16%,#9aa9ba 50%,#c7d0dc 84%,transparent);}
  .single-exam-chart-title + .chart-box.analysis-print-part{margin-top:0 !important;padding-top:0 !important;border-top:0 !important;}
  .single-exam-chart-title + .chart-box.analysis-print-part::before{display:none !important;}
  .exam-type-block>h5 + .analysis-print-part,.karne-bolum>h5 + .analysis-print-part,.report-card-body>.analysis-print-part:first-child{margin-top:0 !important;padding-top:0 !important;border-top:0 !important;}
  .exam-type-block>h5 + .analysis-print-part::before,.karne-bolum>h5 + .analysis-print-part::before,.report-card-body>.analysis-print-part:first-child::before{display:none !important;}

  /* Box plot */
  .boxplot-card{background:#f8f9ff !important;border:1px solid #c8d4ee !important;border-radius:6px;padding:5px 8px;margin-top:3px;page-break-inside:avoid !important;break-inside:avoid !important;}
  .boxplot-title{font-size:9px;font-weight:700;color:#1a5fa8;margin-bottom:3px;}
  .boxplot-wrap{overflow:visible !important;}
  .boxplot-svg{max-height:${printBoxplotMaxHeight} !important;width:100% !important;height:auto !important;}

  /* Risk badge */
  .risk-badge{display:inline-flex;align-items:center;gap:2px;padding:1px 6px;border-radius:20px;font-size:0.68em;font-weight:600;white-space:nowrap;}
  .rb-abs{background:rgba(255,193,7,0.2) !important;color:#664d03 !important;}
  .rb-trend{background:rgba(220,53,69,0.12) !important;color:#842029 !important;}
  .rb-rank{background:rgba(108,117,125,0.12) !important;color:#495057 !important;}
  .rb-subj{background:rgba(111,66,193,0.12) !important;color:#4a1d8a !important;}

  /* Sınav türü blok başlığı (üst sayfada öğrenci adı) — sınav rengiyle */
  .print-page-hdr{display:flex !important;align-items:center;justify-content:space-between;background:linear-gradient(135deg,var(--exam-color,#334155),#111827) !important;color:#fff !important;padding:6px 12px;border-radius:4px;}
  .print-page-hdr *{color:#fff !important;}

  /* Tipografi */
  h4{font-size:12px !important;margin:5px 0;}
  h5{font-size:11px !important;margin:4px 0;}
  .text-primary{color:#1a5fa8 !important;}
  .text-success{color:#198754 !important;}
  .text-danger{color:#dc3545 !important;}
  .text-muted{color:#6c757d !important;}
  .small,small{font-size:0.82em;}
  .badge{display:inline-block;padding:1px 5px;border-radius:8px;font-size:0.72em;}
  .shadow-sm{box-shadow:none !important;}

  /* Sayfa kırma kuralları */
  .exam-type-block{page-break-inside:auto;break-inside:auto;}
  .karne-bolum{page-break-inside:auto;break-inside:auto;}
  .student-rapor-wrapper{page-break-inside:auto;break-inside:auto;}

  /* Tek sınav öğrenci özeti: aynı merkezi kuralların tek sayfaya sıkı hali */
  body.print-one-page-summary-mode{line-height:1.18;}
  body.print-one-page-summary-mode>div{padding:0 !important;}
  body.print-one-page-summary-mode .card{margin-bottom:0;border-radius:4px;}
  body.print-one-page-summary-mode .card-body,
  body.print-one-page-summary-mode .report-card-body-spacious{padding:4px 6px !important;}
  body.print-one-page-summary-mode .report-header{padding:5px 8px;margin-bottom:4px;border-radius:4px;}
  body.print-one-page-summary-mode .report-title-main{font-size:10.5px !important;line-height:1.15;}
  body.print-one-page-summary-mode .report-title-sub{font-size:9px !important;line-height:1.15;}
  body.print-one-page-summary-mode .single-exam-cards{margin-bottom:0 !important;}
  body.print-one-page-summary-mode .single-exam-cards .row{margin:0 -2px !important;}
  body.print-one-page-summary-mode .single-exam-cards .col-lg{flex:0 0 20% !important;max-width:20% !important;padding:0 2px !important;}
  body.print-one-page-summary-mode .sec-card{min-height:46px;padding:4px 5px;gap:5px;border-radius:5px;}
  body.print-one-page-summary-mode .sec-card .sec-icon{width:24px;height:24px;border-radius:5px;font-size:0.75em;}
  body.print-one-page-summary-mode .sec-card .sec-label{font-size:0.54rem;line-height:1.05;}
  body.print-one-page-summary-mode .sec-card .sec-value{font-size:0.76rem;line-height:1.08;margin-top:1px;}
  body.print-one-page-summary-mode .sec-card .sec-sub{font-size:0.55rem;line-height:1.08;margin-top:1px;}
  body.print-one-page-summary-mode .stats-block,
  body.print-one-page-summary-mode .trend-card{padding:4px 6px;margin-bottom:2px;border-radius:5px;}
  body.print-one-page-summary-mode .stats-row{flex-wrap:nowrap !important;}
  body.print-one-page-summary-mode .stats-item{flex:1 1 0 !important;min-width:0 !important;padding:3px 8px;}
  body.print-one-page-summary-mode .stats-label{font-size:0.58rem;}
  body.print-one-page-summary-mode .stats-value{font-size:0.78rem;}
  body.print-one-page-summary-mode .stats-sub{font-size:0.56rem;}
  body.print-one-page-summary-mode .single-exam-chart-title{font-size:8.8px !important;margin:3px 0 2px !important;line-height:1.1;}
  body.print-one-page-summary-mode .single-exam-chart-title.chart-section-title{margin:4px 0 2px !important;padding-top:4px !important;}
  body.print-one-page-summary-mode .analysis-print-part + .analysis-print-part{margin-top:4px !important;padding-top:4px !important;}
  body.print-one-page-summary-mode .table{font-size:${printTableFont} !important;line-height:1.12 !important;margin-bottom:0 !important;}
  body.print-one-page-summary-mode .table th,
  body.print-one-page-summary-mode .table td{padding:${printTablePadding} !important;line-height:1.12 !important;}
  body.print-one-page-summary-mode .table thead th{font-size:${printTableHeadFont} !important;line-height:1.1 !important;}
  body.print-one-page-summary-mode .avg-row td{font-size:7.2px !important;line-height:1.1 !important;}

  /* Toplu Liste: mobil yazdırmada gereksiz sayfa kırmalarını ve boşlukları azalt */
  body.print-compact-list-mode{line-height:1.25;}
  body.print-compact-list-mode>div{padding:0 !important;}
  body.print-compact-list-mode .rapor-list-report{width:100% !important;margin:0 !important;padding:0 !important;}
  body.print-compact-list-mode .report-header{padding:6px 8px;margin-bottom:6px;border-radius:4px;}
  body.print-compact-list-mode .report-card{page-break-inside:auto !important;break-inside:auto !important;margin:0 !important;padding:0 !important;}
  body.print-compact-list-mode .report-card-body{padding:4px 0 0 !important;}
  body.print-compact-list-mode .list-scroll{page-break-inside:auto !important;break-inside:auto !important;margin:0 !important;padding:0 !important;border:0 !important;}
  body.print-compact-list-mode .analysis-print-part{page-break-inside:auto !important;break-inside:auto !important;}
  body.print-compact-list-mode .exam-detail-list-print .report-header{margin-bottom:4px !important;}
  body.print-compact-list-mode .exam-detail-list-table{table-layout:auto !important;width:100% !important;max-width:100% !important;margin:0 !important;page-break-inside:auto !important;break-inside:auto !important;}
  body.print-compact-list-mode .exam-type-block,
  body.print-compact-list-mode .karne-bolum{padding:6px 8px;margin-bottom:8px;border-left-width:3px !important;border-right-width:0 !important;border-radius:4px;page-break-before:auto !important;break-before:auto !important;page-break-inside:auto !important;break-inside:auto !important;}
  body.print-compact-list-mode .exam-type-block>h5,
  body.print-compact-list-mode .karne-bolum>h5{font-size:10px !important;margin:0 0 5px 0;padding-bottom:4px;}
  body.print-compact-list-mode .card{margin-bottom:6px;border-radius:4px;}
  body.print-compact-list-mode .card-header{padding:5px 8px;font-size:9px;line-height:1.25;}
  body.print-compact-list-mode .card-body{padding:5px 6px;}
  body.print-compact-list-mode .card-title{font-size:9.4px !important;line-height:1.25;}
  body.print-compact-list-mode .rapor-list-block{page-break-before:auto !important;break-before:auto !important;page-break-inside:auto !important;break-inside:auto !important;}
  body.print-compact-list-mode .rapor-list-table{table-layout:auto !important;width:100% !important;max-width:100% !important;font-size:${printTableFont} !important;line-height:1.3 !important;margin:0 !important;page-break-inside:auto !important;break-inside:auto !important;}
  body.print-compact-list-mode .rapor-list-table th,
  body.print-compact-list-mode .rapor-list-table td{padding:${printTablePadding} !important;line-height:1.3 !important;overflow:hidden !important;border-color:#cfd6df !important;}
  body.print-compact-list-mode .rapor-list-table thead th{font-size:${printTableHeadFont} !important;line-height:1.25 !important;font-weight:800 !important;white-space:nowrap !important;}
  body.print-compact-list-mode .rapor-list-table tbody,
  body.print-compact-list-mode .rapor-list-table tr{page-break-inside:auto !important;break-inside:auto !important;}
  body.print-compact-list-mode .rapor-list-table .rl-name{text-align:left !important;font-weight:600;white-space:normal !important;word-break:break-word !important;min-width:5rem;}
  body.print-compact-list-mode .rapor-list-table th:not(.rl-name),
  body.print-compact-list-mode .rapor-list-table td:not(.rl-name){white-space:nowrap !important;text-overflow:clip !important;}
  body.print-compact-list-mode .rapor-list-table th.rl-sub,body.print-compact-list-mode .rapor-list-table .rl-sub,
  body.print-compact-list-mode .rapor-list-table th.rl-idx,body.print-compact-list-mode .rapor-list-table .rl-idx,
  body.print-compact-list-mode .rapor-list-table th.rl-class,body.print-compact-list-mode .rapor-list-table .rl-class,
  body.print-compact-list-mode .rapor-list-table th.rl-date,body.print-compact-list-mode .rapor-list-table .rl-date,
  body.print-compact-list-mode .rapor-list-table th.rl-publisher,body.print-compact-list-mode .rapor-list-table .rl-publisher,
  body.print-compact-list-mode .rapor-list-table th.rl-net,body.print-compact-list-mode .rapor-list-table .rl-net,
  body.print-compact-list-mode .rapor-list-table th.rl-score,body.print-compact-list-mode .rapor-list-table .rl-score,
  body.print-compact-list-mode .rapor-list-table th.rl-rank,body.print-compact-list-mode .rapor-list-table .rl-rank,
  body.print-compact-list-mode .rapor-list-table th.rl-count,body.print-compact-list-mode .rapor-list-table .rl-count{text-align:center !important;}
  body.print-compact-list-mode .avg-row td{font-size:8.6px !important;line-height:1.3 !important;}
  body.print-compact-list-mode .mb-4{margin-bottom:8px !important;}
  body.print-compact-list-mode .mb-3{margin-bottom:6px !important;}
  body.print-compact-list-mode h4{font-size:10px !important;margin:4px 0;}
  body.print-compact-list-mode h5{font-size:9.6px !important;margin:4px 0;}

  /* Mobil liste çıktısı: Android/iOS print genelde A4 portrait'e zorlar.
     Bu mod sadece listelerde devreye girer; satır kırılmalarını azaltıp sayfa sayısını düşürür. */
  body.print-mobile-list-mode{line-height:1.06;}
  body.print-mobile-list-mode>div{padding:0 !important;}
  body.print-mobile-list-mode .report-header{
    padding:3px 5px !important;
    margin-bottom:2px !important;
    gap:4px !important;
    align-items:flex-start !important;
    border-left-width:2px !important;
    border-radius:3px !important;
  }
  body.print-mobile-list-mode .report-title-main{font-size:8.4px !important;line-height:1.08 !important;}
  body.print-mobile-list-mode .report-title-sub{font-size:7.2px !important;line-height:1.08 !important;text-align:right !important;}
  body.print-mobile-list-mode .card,
  body.print-mobile-list-mode .report-card,
  body.print-mobile-list-mode .exam-type-block,
  body.print-mobile-list-mode .rapor-list-block{
    margin:0 0 3px !important;
    padding:0 !important;
    border-radius:3px !important;
    page-break-inside:auto !important;
    break-inside:auto !important;
  }
  body.print-mobile-list-mode .card-body,
  body.print-mobile-list-mode .report-card-body{padding:1px 0 0 !important;}
  body.print-mobile-list-mode .rapor-list-block>.card-header{display:none !important;}
  body.print-mobile-list-mode tr.print-title-row th{
    font-size:7.2px !important;
    line-height:1.05 !important;
    padding:1.2px 2px !important;
  }
  body.print-mobile-list-mode .rapor-list-table,
  body.print-mobile-list-mode .exam-detail-list-table{
    table-layout:fixed !important;
    width:100% !important;
    max-width:100% !important;
    margin:0 !important;
    font-size:${printTableFont} !important;
    line-height:1.06 !important;
    page-break-inside:auto !important;
    break-inside:auto !important;
  }
  body.print-mobile-list-mode .rapor-list-table col.rl-col-idx{width:3.4% !important;}
  body.print-mobile-list-mode .rapor-list-table col.rl-col-name{width:16% !important;}
  body.print-mobile-list-mode .rapor-list-table col.rl-col-class{width:4.6% !important;}
  body.print-mobile-list-mode .rapor-list-table col.rl-col-date{width:7.2% !important;}
  body.print-mobile-list-mode .rapor-list-table col.rl-col-publisher{width:6% !important;}
  body.print-mobile-list-mode .rapor-list-table col.rl-col-net{width:6.2% !important;}
  body.print-mobile-list-mode .rapor-list-table col.rl-col-score{width:6.2% !important;}
  body.print-mobile-list-mode .rapor-list-table col.rl-col-rank{width:5.8% !important;}
  body.print-mobile-list-mode .rapor-list-table col.rl-col-count{width:4.8% !important;}
  body.print-mobile-list-mode .rapor-list-table th,
  body.print-mobile-list-mode .rapor-list-table td,
  body.print-mobile-list-mode .exam-detail-list-table th,
  body.print-mobile-list-mode .exam-detail-list-table td{
    padding:${printTablePadding} !important;
    line-height:1.06 !important;
    white-space:nowrap !important;
    word-break:normal !important;
    overflow:hidden !important;
    text-overflow:clip !important;
  }
  body.print-mobile-list-mode .rapor-list-table thead th,
  body.print-mobile-list-mode .exam-detail-list-table thead th{
    font-size:${printTableHeadFont} !important;
    line-height:1.05 !important;
    font-weight:800 !important;
  }
  body.print-mobile-list-mode .rapor-list-table .rl-name{
    min-width:0 !important;
    white-space:nowrap !important;
    word-break:normal !important;
    text-align:left !important;
  }
  body.print-mobile-list-mode .avg-row td{
    font-size:7px !important;
    line-height:1.05 !important;
    padding:1.2px 1.4px !important;
  }
  body.print-mobile-list-mode tbody tr{
    page-break-inside:avoid !important;
    break-inside:avoid !important;
  }

  /* Gizle */
  .no-print,button:not(.risk-badge),.btn:not(.risk-badge),.scroll-hint,.d-flex.justify-content-end,#riskPanel,
  .app-sidebar,.app-header,.app-main>.overlay{display:none !important;}

  /* Tam genişlik */
  .app-wrapper,.app-main,.container-fluid{margin:0 !important;padding:0 !important;width:100% !important;max-width:100% !important;}
</style>
</head>
<body class="${printModeClass}">
<div style="padding:0 2px;">${clone.outerHTML}</div>
<script>
(function(){
  var printed=false;
  function doPrint(){ if(printed) return; printed=true; window.print(); }
  function waitImages(){
    return Promise.all(Array.prototype.slice.call(document.images).map(function(img){
      if(img.complete) return Promise.resolve();
      return new Promise(function(resolve){ img.onload=resolve; img.onerror=resolve; });
    }));
  }
  function waitFonts(){
    return document.fonts && document.fonts.ready ? document.fonts.ready.catch(function(){}) : Promise.resolve();
  }
  window.addEventListener('load',function(){
    Promise.all([waitImages(), waitFonts()]).then(function(){ setTimeout(doPrint, 250); });
    setTimeout(doPrint, 2500);
  });
})();
<\/script>
</body>
</html>`;

  try {
    printWin.document.open();
    printWin.document.write(printHtml);
    printWin.document.close();
  } catch(err) {
    if(typeof showToast === 'function') showToast('Yazdırma penceresi hazırlanamadı: ' + err.message, 'error', 6000);
    if(btn){ btn.innerHTML = orig; btn.disabled = false; }
    return;
  }
  if(btn){ btn.innerHTML = orig; btn.disabled = false; }
}


function debounceSearch(){clearTimeout(searchDebounceTimer);searchDebounceTimer=setTimeout(sSearch,280);}

function sSearch(){
  let v=getEl('sInp').value.trim(),r=getEl('sRes'); if(!v){r.innerHTML='';r.style.display='none';return;}
  let trm=normTR(v).split(/\s+/), m=DB.s.filter(x=>{let txt=normTR(x.no+' '+x.name+' '+x.class);return trm.every(t=>txt.includes(t));});
  if(!m.length){r.innerHTML='<div class="s-item text-muted" role="status">Bulunamadı.</div>';r.style.display='block';return;}
  let h=''; m.slice(0,20).forEach(x=>{
    let noArg = jsArg(x.no), delMsgArg = jsArg(`${x.no} silinsin mi?`);
    h+=`<div class="s-item" role="option" tabindex="0" onclick="if(event.target.closest('button'))return;sAct(${noArg},true);" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();sAct(${noArg},true);}"><div class="s-info"><strong>${escapeHtml(x.no)}</strong> — ${escapeHtml(x.name)} <span class="text-muted">(${escapeHtml(x.class)})</span></div><div class="s-actions"><button class="btn btn-sm btn-warning admin-only" onclick="event.stopPropagation();eStu(${noArg})"><i class="fas fa-edit"></i></button><button class="btn btn-sm btn-danger admin-only" onclick="event.stopPropagation();cDel('student',${delMsgArg},${noArg})"><i class="fas fa-trash"></i></button></div></div>`;
  });
  r.innerHTML=h; r.style.display='block';
}

function clrS(){getEl('sInp').value='';getEl('sRes').innerHTML='';getEl('sRes').style.display='none';sAct(null,false);}

function anlStuDoSearch(){clearTimeout(anlDebounceTimer);anlDebounceTimer=setTimeout(execAnlStuSearch,280);}

function execAnlStuSearch(){
  let v=getEl('anlStuInp').value.trim(), res=getEl('anlStuRes'); if(!v){res.style.display='none';res.innerHTML='';return;}
  let trm=normTR(v).split(/\s+/), m=DB.s.filter(x=>{let txt=normTR(x.no+' '+x.name+' '+x.class);return trm.every(t=>txt.includes(t));});
  if(!m.length){res.innerHTML='<div class="anlStu-item text-muted" role="status">Bulunamadı.</div>';res.style.display='block';return;}
  res.innerHTML=m.slice(0,20).map(x=>`<div class="anlStu-item" role="option" tabindex="0" onclick="anlStuSelect(${jsArg(x.no)})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();anlStuSelect(${jsArg(x.no)});}"><div class="anlStu-main"><strong>${escapeHtml(x.no)}</strong> — ${escapeHtml(x.name)} <span class="text-muted">(${escapeHtml(x.class)})</span></div></div>`).join(''); res.style.display='block';
}

function anlStuSelect(no){
  getEl('anlStuRes').style.display='none';
  // Öğrenci değişince önceki öğrenciye ait sınav/tarih/veri türü seçimlerini temizle
  if(aNo !== no){
    ['aEx','aExDate','aSub'].forEach(id => {
      let el = getEl(id); if(!el) return;
      el.innerHTML = '';   // option listesini temizle (reqUI yeniden dolduracak)
      el.value = '';
    });
  }
  // Öğrenci seçilince arama kutusu temizlenir; seçili öğrenci rozette gösterilir.
  getEl('anlStuInp').value=''; aNo = no; let s=getStuMap().get(no);
  let ab=getEl('anlStuBadge'); if(ab) ab.innerHTML=s?`<span class="badge rounded-pill px-2 py-1 sa-selected-pill selected-student-pill"><i class="fas fa-check-circle me-1"></i>Seçili Öğrenci: ${escapeHtml(s.name)} (${escapeHtml(s.class)})</span>`:'';
  getEl('aBadge').innerHTML=s?`<span class="badge rounded-pill px-3 py-2 sa-selected-pill"><i class="fas fa-check-circle me-1"></i>Seçili Öğrenci: ${escapeHtml(s.name)} (${escapeHtml(s.class)})</span>`:'<span class="text-muted">Seçilmedi</span>'; reqUI(); 
}

function anlStuClear(){ getEl('anlStuInp').value=''; getEl('anlStuRes').style.display='none'; getEl('anlStuRes').innerHTML=''; getEl('anlStuBadge').innerHTML=''; sAct(null,false); }

document.addEventListener('click',e=>{ let res=getEl('anlStuRes'),inp=getEl('anlStuInp'); if(res&&inp&&!res.contains(e.target)&&e.target!==inp)res.style.display='none'; let res2=getEl('sRes'),inp2=getEl('sInp'); if(res2&&inp2&&!res2.contains(e.target)&&e.target!==inp2)res2.style.display='none'; });

// ---- Klavye gezintisi: sRes ve anlStuRes için ArrowDown/Up/Enter/Escape ----
(function _initSearchKeyNav(){
  function _navList(inpId, resId, e){
    let res = getEl(resId); if(!res || res.style.display==='none') return;
    let items = Array.from(res.querySelectorAll('[role="option"]'));
    if(!items.length) return;
    let focused = res.querySelector('[role="option"]:focus');
    let idx = focused ? items.indexOf(focused) : -1;
    if(e.key==='ArrowDown'){
      e.preventDefault();
      let next = idx < items.length-1 ? items[idx+1] : items[0];
      next.focus();
    } else if(e.key==='ArrowUp'){
      e.preventDefault();
      let prev = idx > 0 ? items[idx-1] : items[items.length-1];
      prev.focus();
    } else if(e.key==='Escape'){
      e.preventDefault();
      res.style.display='none';
      let inp = getEl(inpId); if(inp) inp.focus();
    }
  }
  // sInp → sRes
  document.addEventListener('keydown', e => {
    let inp = getEl('sInp'); if(!inp) return;
    let res = getEl('sRes'); if(!res) return;
    if(document.activeElement === inp){
      if(e.key==='ArrowDown'){ e.preventDefault(); let first=res.querySelector('[role="option"]'); if(first) first.focus(); return; }
      if(e.key==='Escape'){ res.style.display='none'; return; }
    }
    if(res.contains(document.activeElement)) _navList('sInp','sRes',e);
  });
  // anlStuInp → anlStuRes
  document.addEventListener('keydown', e => {
    let inp = getEl('anlStuInp'); if(!inp) return;
    let res = getEl('anlStuRes'); if(!res) return;
    if(document.activeElement === inp){
      if(e.key==='ArrowDown'){ e.preventDefault(); let first=res.querySelector('[role="option"]'); if(first) first.focus(); return; }
      if(e.key==='Escape'){ res.style.display='none'; return; }
    }
    if(res.contains(document.activeElement)) _navList('anlStuInp','anlStuRes',e);
  });
}());

// ---- examColorIdx: sınav türü adından deterministik renk index'i (0-7) üretir ----
function examColorIdx(name){
  let s = String(name||''); let h = 0;
  for(let i=0;i<s.length;i++){ h = ((h<<5) - h) + s.charCodeAt(i); h |= 0; }
  return Math.abs(h) % 8;
}
// ---- toExamLabel: "tyt deneme" -> "TYT Denemesi" gibi Türkçe-uyumlu Title Case + ek ----
function toExamLabel(t){
  let s = String(t||'').trim();
  if(!s) return '';
  // Kelime bazlı Title Case (Türkçe karakter güvenli)
  return s.split(/\s+/).map(w => {
    if(!w) return w;
    // Kısaltma gibi tamamı büyük harfse aynen bırak (TYT, AYT, KTT, LGS vb.)
    if(w.length <= 4 && w === w.toLocaleUpperCase('tr')) return w;
    let first = w.charAt(0).toLocaleUpperCase('tr');
    let rest  = w.slice(1).toLocaleLowerCase('tr');
    return first + rest;
  }).join(' ');
}

function uStat(){
  const g=getEl('dynamicStatsGrid'); if(!g) return;
  // Sınav türü -> { total, grades:{9:n,10:n,...} }
  const u = {};
  Object.values(EXAM_META).forEach(m => {
    const t = m.examType; if(!t) return;
    if(!u[t]) u[t] = { total:0, grades:{} };
    u[t].total += 1;
    // Sınıf seviyelerini m.grades veya m.grade'dan al
    let gs = [];
    if(Array.isArray(m.grades) && m.grades.length) gs = m.grades.map(String);
    else if(m.grade) gs = [String(m.grade)];
    gs.forEach(gr => {
      if(!gr) return;
      u[t].grades[gr] = (u[t].grades[gr]||0) + 1;
    });
  });

  const ic = ['fas fa-file-alt','fas fa-check-circle','fas fa-star','fas fa-trophy','fas fa-bookmark','fas fa-graduation-cap','fas fa-clipboard-list','fas fa-chart-line'];
  const entries = Object.entries(u).sort((a,b)=> a[0].localeCompare(b[0],'tr'));
  let h = '';

  if(entries.length === 0){
    // Boş durum kartı: admin ve normal kullanıcı için ayrı metin
    const isAdm = document.body.classList.contains('is-admin');
    const emptyMsg = isAdm
      ? 'Henüz sınav verisi yok. <strong>Ayarlar</strong> bölümünden Excel ile veri yükleyebilirsiniz.'
      : 'Sınav verileri yüklendiğinde burada görünecek.';
    h = `<div class="col-12"><div class="stat-empty-state"><i class="fas fa-inbox stat-empty-icon"></i><span class="stat-empty-text">${emptyMsg}</span></div></div>`;
    g.innerHTML = h;
    return;
  }

  entries.forEach(([t, info]) => {
    const colorIdx = examColorIdx(t);
    const label = toExamLabel(t);
    const gradeKeys = Object.keys(info.grades).sort((a,b)=> Number(a)-Number(b));
    const gradesHtml = gradeKeys.length
      ? gradeKeys.map(gr => `<span class="hsc-grade hsc-grade-link" onclick="goToAnaliz(${jsArg(t)},${jsArg(gr)})" title="${escapeHtml(label)} — ${escapeHtml(gr)}. Sınıf analizine git"><strong>${escapeHtml(gr)}. Sınıf:</strong> ${escapeHtml(info.grades[gr])} <small>Sınav</small> <i class="fas fa-arrow-right hsc-arrow"></i></span>`).join('')
      : '<span class="hsc-empty">Sınıf bilgisi yok</span>';
    
    h += `<div class="col-md-4 col-sm-6 col-12 mb-3">
      <div class="home-stat-card exam-color-${colorIdx}">
        <div class="hsc-head">
          <span class="hsc-title"><i class="${ic[colorIdx % ic.length]}"></i>${escapeHtml(label)}</span>
          <span class="hsc-count">${info.total} Sınav</span>
        </div>
        <div class="hsc-grades hsc-grades-grid">${gradesHtml}</div>
      </div>
    </div>`;
  });
  g.innerHTML = h;
}

// ---- goToAnaliz: Sistem Özeti'nden Sınav Analizi sayfasına yönlendirme ----
// _waitTick: sabit bekleme (sekme geçişi gibi DOM dışı gecikmeler için)
function _waitTick(ms){ return new Promise(res => setTimeout(res, ms || 0)); }
// _waitForOption: belirtilen select'te value option'ı görünene kadar bekle (max ~200ms)
function _waitForOption(selectId, value, maxMs){
  return new Promise(res => {
    const deadline = Date.now() + (maxMs || 200);
    (function check(){
      const el = getEl(selectId);
      if(!el || Date.now() >= deadline){ res(); return; }
      if(Array.from(el.options).some(o => o.value === value)){ res(); return; }
      setTimeout(check, 16);
    }());
  });
}

async function goToAnaliz(examType, grade) {
  try {
  // 1. Sınav Analizi sekmesine geç
  sTab('sonuclar', document.getElementById('nav-sonuclar'));

  // 2. Sekme geçiş animasyonu — sabit bekleme (DOM dışı)
  await _waitTick(150);

  // Analiz Türü: Sınav Analizi (examdetail)
  let aTypeEl = getEl('aType');
  if (aTypeEl) aTypeEl.value = 'examdetail';

  // Sınıf/şube dropdown'larını yenile; aLvl option'larını bekle
  uUI();
  await _waitForOption('aLvl', String(grade));
  let aLvlEl = getEl('aLvl');
  if (aLvlEl) aLvlEl.value = String(grade);

  // Şube dropdown'unu doldur; __ALL__ option'ını bekle
  uBranches();
  await _waitForOption('aBr', '__ALL__');
  let aBrEl = getEl('aBr');
  if (aBrEl) aBrEl.value = '__ALL__';

  // Sınav türü dropdown'unu doldur; istenen examType option'ını bekle
  uExamTypes();
  await _waitForOption('aEx', examType);
  let aExEl = getEl('aEx');
  if (aExEl) aExEl.value = examType;
  applyExamColorToFilters();

  // Sınav tarihleri dropdown'unu doldur; __ALL__ option'ını bekle
  uExamDates();
  await _waitForOption('aDate', '__ALL__');
  let aDateEl = getEl('aDate');
  if (aDateEl) aDateEl.value = '__ALL__';

  // Veri türü: Genel Sınav Özeti
  uSub();
  await _waitForOption('aSub', 'general_summary');
  let aSubEl = getEl('aSub');
  if (aSubEl) aSubEl.value = 'general_summary';

  _updateGDateVisibility();
  _updateAnalysisFilterLocks();
  reqAnl();
  } catch(e) { console.warn('goToAnaliz hatası:', e); }
}

function uDrp(){
  uExamTypes(); if(aNo){ let s=getStuMap().get(aNo); if(s&&getEl('anlStuInp'))getEl('anlStuInp').value=s.name+' ('+s.class+')'; }
}

function _classParts(cls){
  return typeof getClassParts === 'function' ? getClassParts(cls) : { grade:getGrade(cls), branch:'' };
}

function _hasScoreData(e){
  return e && e.studentNo && !e.abs;
}

function _resultRows(filters = {}){
  let grade = filters.grade || '';
  let branch = filters.branch === '__ALL__' ? '' : (filters.branch || '');
  let examType = filters.examType || '';
  let date = filters.date === '__ALL__' ? '' : (filters.date || '');
  let studentNo = filters.studentNo || '';
  return (DB.e || []).filter(e => {
    if(!_hasScoreData(e)) return false;
    if(studentNo && e.studentNo !== studentNo) return false;
    if(examType && e.examType !== examType) return false;
    if(date && e.date !== date) return false;
    let parts = _classParts(e.studentClass);
    if(grade && parts.grade !== grade) return false;
    if(branch && parts.branch !== branch) return false;
    return true;
  });
}

function _resultGrades(filters = {}){
  return [...new Set(_resultRows(filters).map(e => _classParts(e.studentClass).grade).filter(Boolean))]
    .sort((a,b)=>parseInt(a)-parseInt(b));
}

function _resultBranches(filters = {}){
  return [...new Set(_resultRows(filters).map(e => _classParts(e.studentClass).branch).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,'tr'));
}

function _resultExamTypes(filters = {}){
  return [...new Set(_resultRows(filters).map(e => e.examType).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,'tr'));
}

function _resultSubjects(filters = {}){
  let subjects = new Set();
  _resultRows(filters).forEach(e => {
    Object.keys(e.subs || {}).forEach(s => subjects.add(s.toLocaleLowerCase('tr-TR')));
  });
  return [...subjects].sort((a,b)=>a.localeCompare(b,'tr'));
}

function _setSelectPlaceholder(id, label){
  let el = getEl(id); if(!el) return;
  el.innerHTML = optionHtml('', label, true, true);
  el.value = '';
}

function _setSelectLock(id, locked, title){
  let el = getEl(id); if(!el) return;
  el.disabled = !!locked;
  let msg = locked ? (title || 'Önce önceki filtreyi seçin') : '';
  el.title = msg;
  // Kapalıyken ilk disabled option'ın metnini güncelle (zincirleme mesaj dropdown içinde görünsün)
  if(locked && msg && el.options.length > 0 && el.options[0].disabled){
    el.options[0].text = msg;
    if(el.value === '') el.options[0].selected = true;
  }
}

function _selectHasConcreteValue(id){
  let el = getEl(id);
  if(!el || el.selectedIndex < 0) return false;
  let opt = el.options[el.selectedIndex];
  return !!(opt && !opt.disabled && el.value !== '');
}

function uBranches(){
  let aT = getEl('aType') ? getEl('aType').value : '';
  if(!(aT==='class'||aT==='subject'||aT==='examdetail')) return;
  let brSel = getEl('aBr'); if(!brSel) return;
  let lvlF = getEl('aLvl') ? getEl('aLvl').value : '';
  if(!lvlF){
    _setSelectPlaceholder('aBr', 'Önce sınıf seviyesi seçin');
    return;
  }
  let prev = brSel.value;
  let sorted = _resultBranches({ grade:lvlF });
  brSel.innerHTML = optionHtml('', 'Şube Seç', !prev, true)
    + (sorted.length ? optionHtml('__ALL__', 'Tümü', prev==='__ALL__') : '')
    + sorted.map(x=>optionHtml(x, x, prev===x)).join('');
  if(prev==='__ALL__' && sorted.length) brSel.value = prev;
  else if(sorted.includes(prev)) brSel.value = prev;
  else brSel.value = '';
}

function uExamTypes(){
  let aT = getEl('aType') ? getEl('aType').value : '';
  let exSel = getEl('aEx'); if(!exSel) return;
  let lvlF = (aT==='class'||aT==='subject'||aT==='examdetail') && getEl('aLvl') ? getEl('aLvl').value : '';
  let brRaw = (aT==='class'||aT==='subject'||aT==='examdetail') && getEl('aBr') ? getEl('aBr').value : '';
  let brF  = brRaw === '__ALL__' ? '' : brRaw;
  let sortedTypes = [];

  if(aT === 'student'){
    if(!aNo){
      _setSelectPlaceholder('aEx', 'Önce öğrenci seçin');
      return;
    }
    sortedTypes = _resultExamTypes({ studentNo:aNo });
  } else if(aT==='class'||aT==='subject'||aT==='examdetail') {
    if(!lvlF){
      _setSelectPlaceholder('aEx', 'Önce sınıf seviyesi seçin');
      return;
    }
    if(!brRaw){
      _setSelectPlaceholder('aEx', 'Önce şube seçin');
      return;
    }
    sortedTypes = _resultExamTypes({ grade:lvlF, branch:brF });
  } else {
    sortedTypes = _resultExamTypes();
  }

  let prev = exSel.value;
  exSel.innerHTML = optionHtml('', sortedTypes.length ? 'Sınav Türü Seçiniz' : 'Uygun sınav türü yok', !(prev && sortedTypes.includes(prev)), true)
    + sortedTypes.map(x=>optionHtml(x, x, prev===x)).join('');
  if(sortedTypes.includes(prev)) exSel.value = prev;
  else exSel.value = '';
}

// ---- analysis filter memory ----
const ANALYSIS_SUB_STORAGE_KEY = 'sinavAnalizi.analysisSubMemory.v1';
const ANALYSIS_SUB_MEMORY = (() => {
  try { return JSON.parse(localStorage.getItem(ANALYSIS_SUB_STORAGE_KEY) || '{}') || {}; }
  catch(e) { return {}; }
})();

function _saveAnalysisSubMemory(){
  try { localStorage.setItem(ANALYSIS_SUB_STORAGE_KEY, JSON.stringify(ANALYSIS_SUB_MEMORY)); } catch(e){}
}

function _analysisSubKeys(){
  let aT = getEl('aType') ? getEl('aType').value : '';
  let eT = getEl('aEx') ? getEl('aEx').value : '';
  let single = (aT === 'student' && typeof isStudentSingleExamSelection === 'function' && isStudentSingleExamSelection()) ? 'single' : 'all';
  let lvl = (getEl('aLvl') && getEl('aLvl').value) || '';
  let br = (getEl('aBr') && getEl('aBr').value) || '';
  let primary = `${aT}|${eT || '*'}|${single}|${lvl || '*'}|${br || '*'}`;
  return [
    primary,
    `${aT}|${eT || '*'}|${single}|${lvl || '*'}|*`,
    `${aT}|${eT || '*'}|${single}|*|*`,
    `${aT}|${eT || '*'}|*|*|*`,
    `${aT}|*|${single}|*|*`,
    `${aT}|*|*|*|*`,
    `${aT}|${eT}|${single}`,
    `${aT}|${eT}`,
    `${aT}|*|${single}`,
    `${aT}|*`
  ];
}

function _rememberAnalysisSub(value){
  let el = getEl('aSub');
  let val = value !== undefined ? value : (el ? el.value : '');
  if(!val) return;
  let keys = _analysisSubKeys();
  if(keys.length) ANALYSIS_SUB_MEMORY[keys[0]] = val;
  _saveAnalysisSubMemory();
}

function _preferredAnalysisSub(defaultVal){
  let el = getEl('aSub');
  let cur = el ? el.value : '';
  if(cur) return cur;
  for(let k of _analysisSubKeys()){
    if(ANALYSIS_SUB_MEMORY[k]) return ANALYSIS_SUB_MEMORY[k];
  }
  return defaultVal || '';
}

function _applyAnalysisSubValue(defaultVal, preferredOverride){
  let el = getEl('aSub'); if(!el) return '';
  let preferred = preferredOverride !== undefined ? preferredOverride : _preferredAnalysisSub(defaultVal);
  let options = [...el.options];
  let validPreferred = preferred && options.some(o => o.value === preferred && !o.disabled);
  let validDefault = defaultVal && options.some(o => o.value === defaultVal && !o.disabled);
  if(validPreferred) el.value = preferred;
  else if(validDefault) el.value = defaultVal;
  else if(options.length && options[0].disabled) options[0].selected = true;
  else if(options.length) el.value = options[0].value;
  if(validPreferred) _rememberAnalysisSub(el.value);
  return el.value;
}

function _selectedOptionText(id){
  let el = getEl(id);
  if(!el || el.selectedIndex < 0) return '';
  let opt = el.options[el.selectedIndex];
  if(!opt || opt.disabled) return '';
  return (opt.textContent || '').trim();
}

const CARD_EXPLANATIONS = {
  trend_direction: {
    title: 'Genel Yön (Trend)',
    badge: 'Trend',
    summary: 'Seçilen verinin genel gidiş yönünü gösterir: yükseliyor, düşüyor, sabit ya da dalgalı.',
    interpretation: 'En az 3 sınav olunca yorumlanmalıdır. R² yüksekse yön daha güvenilir okunur.',
    caution: 'Az sınavda veya çok dalgalı sonuçlarda kesin karar değil, izleme ipucu olarak değerlendirilmelidir.'
  },
  total_change: {
    title: 'Toplam Değişim',
    badge: 'Trend',
    summary: 'İlk sınavdan son sınava kadar beklenen toplam net/puan değişimini gösterir.',
    interpretation: 'Pozitif değer gelişimi, negatif değer gerileme eğilimini anlatır.',
    caution: 'Sınavlar çok zikzaklıysa toplam değişim R² ile birlikte okunmalıdır.'
  },
  change_per_exam: {
    title: 'Sınav Başına Değişim',
    badge: 'Trend',
    summary: 'Her sınavda ortalama kaç net ya da puan değiştiğini gösterir.',
    interpretation: '+ değer ilerleme, - değer düşüş eğilimini gösterir.',
    caution: 'Bu değer tek tek iki sınav farkı değil, tüm sürece en yakın çizginin eğimidir.'
  },
  trend_reliability: {
    title: 'Trend Güvenilirliği (R²)',
    badge: 'Güvenilirlik',
    summary: 'Sonuçların düzenli bir artış veya düşüş çizgisine ne kadar uyduğunu gösterir.',
    interpretation: 'Değer yükseldikçe trend daha güvenilir okunur; düşük değer dalgalanmayı gösterir.',
    caution: 'R² düşükse yön oku kesin karar değil, öğretmen için izleme sinyalidir.'
  },
  current_performance: {
    title: 'Güncel Performans (EWMA)',
    badge: 'Güncel durum',
    summary: 'Son sınavlara daha fazla ağırlık vererek öğrencinin, sınıfın veya dersin güncel seviyesini gösterir.',
    interpretation: 'Klasik ortalamadan daha hızlı tepki verir; son durumdaki değişimi daha görünür kılar.',
    caution: 'Tek bir ani sonuç, genel tablo ve katılım bilgisiyle birlikte değerlendirilmelidir.'
  },
  surprise: {
    title: 'Sürpriz Payı (RMSE)',
    badge: 'Dalgalanma',
    summary: 'Gerçek sonuçların beklenen trend çizgisinden ortalama ne kadar saptığını gösterir.',
    interpretation: 'Düşük değer daha düzenli, yüksek değer daha dalgalı performans anlamına gelir.',
    caution: 'Sürpriz payı yüksekse trend yorumları daha temkinli yapılmalıdır.'
  },
  position_z: {
    title: 'Ortalamaya Göre Konum',
    badge: 'Karşılaştırma',
    summary: 'Öğrencinin sınıf veya kurum ortalamasına göre yerini gösterir.',
    interpretation: '0 ortalama düzeyidir; + değer ortalamanın üstünü, - değer ortalamanın altını anlatır. Standart sapma, gruptaki tipik uzaklığı ifade eder.',
    caution: 'Grup küçükse veya sonuçlar birbirine çok yakınsa bu gösterge tek başına öğrenci etiketi olarak kullanılmamalıdır.'
  },
  rank_position: {
    title: 'Sıralama Konumu',
    badge: 'Sıra',
    summary: 'Öğrencinin sınıf veya kurum içindeki sıra bilgisini gösterir.',
    interpretation: 'Sıra değerinde küçük sayı daha iyi konumu ifade eder.',
    caution: 'Sıra, net/puan farkının büyüklüğünü göstermez; mutlaka net veya puanla birlikte okunmalıdır.'
  },
  previous_delta: {
    title: 'Önceki Sınava Fark',
    badge: 'Karşılaştırma',
    summary: 'Seçili sınavın hemen önceki sınava göre artışını veya düşüşünü gösterir.',
    interpretation: 'Net ve puanda artış iyiye işaret eder. Sıralamada sayının küçülmesi iyileşme anlamına gelir.',
    caution: 'İki sınav farkı trend değildir; sınav zorluğu ve konu kapsamı sonucu etkileyebilir.'
  },
  distribution_sd: {
    title: 'Ortalamadan Uzaklık (Standart Sapma)',
    badge: 'Dağılım',
    summary: 'Grup sonuçlarının ortalamanın etrafında ne kadar dağıldığını gösterir.',
    interpretation: 'Değer büyüdükçe öğrenciler arası seviye farkı artar; değer küçüldükçe sonuçlar birbirine yaklaşır.',
    caution: 'Çok küçük gruplarda tek bir uç sonuç dağılımı kolayca değiştirebilir.'
  },
  distribution_cv: {
    title: 'Dağılım / Homojenlik',
    badge: 'Dağılım',
    summary: 'Öğrenciler birbirine yakın mı, yoksa seviye farkı fazla mı, bunu gösterir.',
    interpretation: 'Değer büyüdükçe grup daha heterojen; değer küçüldükçe daha homojen kabul edilir.',
    caution: 'Ortalama çok düşükse CV olduğundan yüksek görünebilir; öğrenci sayısıyla birlikte okunmalıdır.'
  },
  median: {
    title: 'Medyan Net',
    badge: 'Dağılım',
    summary: 'Sonuçlar küçükten büyüğe dizildiğinde ortadaki öğrencinin netini gösterir.',
    interpretation: 'Tipik öğrenciyi anlatır; uç sonuçlardan ortalamaya göre daha az etkilenir.',
    caution: 'Medyan ve ortalama belirgin ayrışıyorsa uç öğrenciler genel ortalamayı etkiliyor olabilir.'
  },
  iqr: {
    title: 'Çeyrekler Arası Aralık (IQR)',
    badge: 'Dağılım',
    summary: 'Ortadaki yüzde 50 öğrencinin hangi genişlikte bir aralığa yayıldığını gösterir.',
    interpretation: 'Büyük IQR, orta grubun bile dağınık olduğunu; küçük IQR, orta grubun daha toplu olduğunu gösterir.',
    caution: 'IQR uç değerleri dışarıda bırakır; en yüksek ve en düşük öğrencileri tek başına anlatmaz.'
  },
  effect_size: {
    title: "Etki Büyüklüğü (Cohen's d)",
    badge: 'Karşılaştırma',
    summary: 'Şubeler ya da gruplar arasındaki farkın gerçekten güçlü olup olmadığını gösterir.',
    interpretation: 'Yaklaşık 0.20 küçük, 0.50 orta, 0.80 ve üzeri büyük fark olarak okunabilir.',
    caution: 'Ortalama farkı tek başına yeterli değildir; grupların kendi içindeki dağılımı da dikkate alınır.'
  },
  group_difference: {
    title: 'Gruplar Arası Fark',
    badge: 'Karşılaştırma',
    summary: 'En yüksek ortalamalı grup ile en düşük ortalamalı grup arasındaki ham net/puan farkını gösterir.',
    interpretation: 'Fark büyüdükçe gruplar arasındaki seviye ayrımı artar.',
    caution: 'Ham fark dağılımı hesaba katmaz; varsa Cohen d ile birlikte yorumlanmalıdır.'
  },
  branch_institution_delta: {
    title: 'Şube - Kurum Farkı',
    badge: 'Karşılaştırma',
    summary: 'Seçili şubenin kurum ortalamasına göre ne kadar üstte veya altta olduğunu gösterir.',
    interpretation: '+ değer şubenin kurum ortalamasının üstünde, - değer altında olduğunu anlatır.',
    caution: 'Bu ham farktır; öğrenci sayısı, dağılım ve sınav zorluğu ile birlikte okunmalıdır.'
  },
  boxplot: {
    title: 'Kutu Grafiği',
    badge: 'Dağılım',
    summary: 'Sadece ortalamayı değil, orta grubu, yayılımı ve uç değerleri birlikte gösterir.',
    interpretation: 'Kutu orta grubu, medyan çizgisi tipik öğrenciyi; işaretli değer varsa seçili öğrenci veya grubun konumunu gösterir.',
    caution: 'Az sınav veya küçük grup varsa dağılım grafiği geçici dalgalanmaları büyütebilir.'
  },
  score_rank: {
    title: 'Puan ve Sıra',
    badge: 'Öğrenci',
    summary: 'Seçili sınavdaki puan, toplam net ve varsa sınıf/kurum sırasını birlikte gösterir.',
    interpretation: 'Puan mutlak başarıyı, sıra ise aynı sınava giren grup içindeki göreli konumu anlatır.',
    caution: 'Tek sınavlık sonuç trend değildir; önceki sınav farkı ve genel gidişle birlikte okunmalıdır.'
  }
};

function _cardExplanationEsc(v){
  return (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v ?? '');
}

function _cardExplanationNorm(v){
  return String(v || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[ıİ]/g, 'i')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’´`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function _cardExplanationKeyFromText(text){
  let n = _cardExplanationNorm(text);
  if(!n) return '';

  // Basit ve ilk bakışta anlaşılır öğrenci özet kartlarında info butonu gösterme.
  // Bu kartlar açıklama ihtiyacı taşımadığı için popup sistemi dışında tutulur.
  const simpleStudentCardLabels = [
    'ortalama net',
    'ortalama puan',
    'katilim',
    'sinif derece',
    'kurum derece'
  ];
  if(simpleStudentCardLabels.includes(n)) return '';

  // Risk Analizi sayfasındaki ve diğer sayfalardaki risk kartlarında info sistemi kullanılmayacak.
  if(
    n.includes('risk') ||
    n.includes('devamsizlik') ||
    n.includes('sira gerileme') ||
    n.includes('dusus trendi') ||
    n.includes('dusme trendi') ||
    n.includes('ders dususu')
  ) return '';

  if(n.includes('genel yon') || n.includes('genel egilim')) return 'trend_direction';
  if(n.includes('trend guvenilirligi') || n.includes('r²') || /\br2\b/.test(n)) return 'trend_reliability';
  if(n.includes('sinav basina') || n.includes('sinav basi')) return 'change_per_exam';
  if(n.includes('toplam') && n.includes('degisim')) return 'total_change';
  if(n.includes('guncel performans') || n.includes('ewma')) return 'current_performance';
  if(n.includes('surpriz payi') || n.includes('rmse')) return 'surprise';
  if(n.includes('sinif ici konum') || n.includes('kurum ici konum') || n.includes('ortalamaya gore konum') || n.includes('sinif karsilastirma') || n.includes('kurum karsilastirma')) return 'position_z';
  if(n.includes('puan') && n.includes('sira')) return 'score_rank';
  if(n.includes('sinif sira') || n.includes('kurum sira') || n.includes('genel sira') || n.includes('ortalama sira')) return 'rank_position';
  if(n.includes('onceki sinava fark')) return 'previous_delta';
  if(n.includes('standart sapma') || n.includes('ortalamadan uzaklik')) return 'distribution_sd';
  if(n.includes('sinif ici dagilim') || n.includes('ogrenciler arasi dagilim') || n.includes('homojenlik') || /\bcv\b/.test(n)) return 'distribution_cv';
  if(n.includes('medyan')) return 'median';
  if(n.includes('ceyrek') || n.includes('iqr') || n.includes('orta grup yayilimi')) return 'iqr';
  if(n.includes('cohen') || n.includes('etki buyuklugu')) return 'effect_size';
  if(n.includes('subeler arasi fark') || n.includes('siniflar arasi fark')) return 'group_difference';
  if(n.includes('sube') && n.includes('kurum') && n.includes('fark')) return 'branch_institution_delta';
  if(n.includes('kutu grafigi') || n.includes('box plot')) return 'boxplot';
  return '';
}

function _cardExplanationTextForElement(el){
  if(!el) return '';
  const selectors = [
    '.trend-stat-label',
    '.stats-label',
    '.trend-label',
    '.sec-label',
    '.boxplot-title',
    '.boxplot-card-title',
    '.risk-info-title',
    '.risk-score-badge small',
    '.card-title',
    'h6',
    'h5'
  ];
  for(const sel of selectors){
    let node = el.querySelector(sel);
    if(node && (node.textContent || '').trim()) return node.textContent.trim();
  }
  return (el.textContent || '').trim();
}

function _cardExplanationKeyForElement(el){
  if(el && el.classList && (el.classList.contains('risk-card') || el.classList.contains('risk-info-card') || el.classList.contains('risk-stat-card'))) return '';
  let text = _cardExplanationTextForElement(el);
  let key = _cardExplanationKeyFromText(text);
  if(key) return key;
  if(el && el.classList && el.classList.contains('boxplot-card')) return 'boxplot';
  return '';
}

function _cardExplanationRender(data){
  let sections = [];
  if(data.summary) sections.push(`<div class="card-explanation-section card-explanation-definition"><strong class="card-explanation-section-title"><i class="fas fa-circle-question" aria-hidden="true"></i>Nedir?</strong><span>${_cardExplanationEsc(data.summary)}</span></div>`);
  if(data.interpretation) sections.push(`<div class="card-explanation-section"><strong class="card-explanation-section-title"><i class="fas fa-chart-line" aria-hidden="true"></i>Nasıl okunur?</strong><span>${_cardExplanationEsc(data.interpretation)}</span></div>`);
  if(data.caution) sections.push(`<div class="card-explanation-caution"><strong class="card-explanation-section-title"><i class="fas fa-lightbulb" aria-hidden="true"></i>Not</strong><span>${_cardExplanationEsc(data.caution)}</span></div>`);
  return sections.join('');
}

function _cardExplanationTitleWithBadge(data, trigger){
  let selectedTitle = trigger && trigger.dataset ? (trigger.dataset.cardExplanationTitle || '') : '';
  if(selectedTitle) return selectedTitle;
  return data && data.title ? String(data.title) : 'Açıklama';
}


let _lastCardExplanationTrigger = null;
let _activeCardExplanationPopover = null;
let _activeCardExplanationSheet = null;

function _cardExplanationIsMobile(){
  try {
    return window.matchMedia && window.matchMedia('(max-width: 575px)').matches;
  } catch(e) {
    return window.innerWidth <= 575;
  }
}

function _cardExplanationDesktopPlacement(trigger){
  try {
    let anchor = trigger && trigger.closest ? (trigger.closest('.has-card-info') || trigger) : trigger;
    if(!anchor || !anchor.getBoundingClientRect) return 'auto';
    let rect = anchor.getBoundingClientRect();
    let vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    let vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);

    // Masaüstü kuralı:
    // 1) Sağda yer varsa sağda aç.
    // 2) Sağda yer yoksa altta aç.
    // 3) Altta da yer yoksa üstte aç.
    // 4) Bunlar mümkün değilse son çare olarak solda/auto davranışına düş.
    let rightSpace = vw - rect.right;
    let leftSpace = rect.left;
    let bottomSpace = vh - rect.bottom;
    let topSpace = rect.top;

    let popoverWidth = 405;
    let popoverHeightEstimate = 260;
    let gap = 18;

    if(rightSpace >= popoverWidth + gap) return 'right';
    if(bottomSpace >= popoverHeightEstimate + gap) return 'bottom';
    if(topSpace >= popoverHeightEstimate + gap) return 'top';
    if(leftSpace >= popoverWidth + gap) return 'left';

    return bottomSpace >= topSpace ? 'bottom' : 'top';
  } catch(e) {
    return 'auto';
  }
}

function _cardExplanationPopoverHtml(data, trigger){
  return `<div class="card-explanation-popover-card">
    <div class="card-explanation-popover-head">
      <div class="card-explanation-title-wrap">
        <h5 class="card-explanation-popover-title">${_cardExplanationEsc(_cardExplanationTitleWithBadge(data, trigger))}</h5>
      </div>
      <button type="button" class="card-explanation-mini-close" data-card-explanation-close aria-label="Açıklamayı kapat">
        <i class="fas fa-times" aria-hidden="true"></i>
      </button>
    </div>
    <div class="card-explanation-body">${_cardExplanationRender(data)}</div>
  </div>`;
}

function _cardExplanationFillSheet(data, trigger){
  let title = document.getElementById('cardExplanationSheetTitle');
  let badge = document.getElementById('cardExplanationSheetBadge');
  let body = document.getElementById('cardExplanationSheetBody');
  if(!title || !badge || !body) return false;
  title.textContent = _cardExplanationTitleWithBadge(data, trigger);
  badge.textContent = '';
  badge.hidden = true;
  body.innerHTML = _cardExplanationRender(data);
  if(typeof body.scrollTo === 'function') body.scrollTo({ top: 0 });
  else body.scrollTop = 0;
  return true;
}

function openCardExplanation(key, trigger){
  let data = CARD_EXPLANATIONS[key];
  if(!data || !trigger) return;
  closeCardExplanation(false);
  _lastCardExplanationTrigger = trigger || null;

  if(_cardExplanationIsMobile()) {
    if(!_cardExplanationFillSheet(data, trigger)) return;
    let sheetEl = document.getElementById('cardExplanationSheet');
    if(!sheetEl || !window.bootstrap || !bootstrap.Offcanvas) return;
    _activeCardExplanationSheet = bootstrap.Offcanvas.getOrCreateInstance(sheetEl, {
      backdrop: true,
      keyboard: true,
      scroll: false
    });
    sheetEl.addEventListener('hidden.bs.offcanvas', () => closeCardExplanation(false), { once: true });
    trigger.setAttribute('aria-expanded', 'true');
    document.body.classList.add('card-explanation-open');
    _activeCardExplanationSheet.show();
    return;
  }

  if(!window.bootstrap || !bootstrap.Popover) {
    if(typeof showToast === 'function') showToast(data.summary || data.title || 'Açıklama', 'info', 4500);
    return;
  }

  _activeCardExplanationPopover = new bootstrap.Popover(trigger, {
    container: 'body',
    html: true,
    sanitize: false,
    trigger: 'manual',
    placement: _cardExplanationDesktopPlacement(trigger),
    fallbackPlacements: ['right', 'bottom', 'top', 'left'],
    boundary: 'viewport',
    offset: [0, 10],
    customClass: 'card-explanation-popover no-print',
    title: '',
    content: _cardExplanationPopoverHtml(data, trigger)
  });
  trigger.setAttribute('aria-expanded', 'true');
  document.body.classList.add('card-explanation-open');
  _activeCardExplanationPopover.show();
}

function closeCardExplanation(restoreFocus = true){
  if(_activeCardExplanationPopover) {
    try { _activeCardExplanationPopover.dispose(); } catch(e) {}
    _activeCardExplanationPopover = null;
  }
  if(_activeCardExplanationSheet) {
    try {
      let sheetEl = document.getElementById('cardExplanationSheet');
      if(sheetEl && sheetEl.classList.contains('show')) _activeCardExplanationSheet.hide();
    } catch(e) {}
    _activeCardExplanationSheet = null;
  }
  document.body.classList.remove('card-explanation-open');
  if(_lastCardExplanationTrigger) {
    _lastCardExplanationTrigger.setAttribute('aria-expanded', 'false');
    if(restoreFocus && typeof _lastCardExplanationTrigger.focus === 'function') {
      _lastCardExplanationTrigger.focus({ preventScroll: true });
    }
  }
  _lastCardExplanationTrigger = null;
}

function _cardExplanationButtonExists(el){
  return Array.from(el.children || []).some(child => child.classList && child.classList.contains('card-info-btn'));
}

function _cardExplanationAddButton(el, key, titleOverride){
  if(!el || !key || !CARD_EXPLANATIONS[key] || _cardExplanationButtonExists(el)) return;
  el.classList.add('has-card-info');
  let btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'card-info-btn no-print';
  btn.dataset.cardExplanation = key;
  if(titleOverride) btn.dataset.cardExplanationTitle = titleOverride;
  btn.setAttribute('aria-label', `${titleOverride || CARD_EXPLANATIONS[key].title} açıklamasını göster`);
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<i class="fas fa-info" aria-hidden="true"></i>';
  el.appendChild(btn);
}

function _cardExplanationStripNativeTooltips(el){
  if(!el || !el.querySelectorAll) return;
  if(el.hasAttribute && el.hasAttribute('title')) el.removeAttribute('title');
  el.querySelectorAll('[title]').forEach(node => {
    // Eski kart açıklamaları native tooltip olarak görünmesin.
    // Erişilebilirlik için info butonunda aria-label zaten var.
    node.removeAttribute('title');
  });
}

function decorateCardExplanations(root){
  let scope = root && root.nodeType === 1 ? root : document;
  const selector = [
    '.trend-stat-item',
    '.stats-item',
    '.trend-card .trend-metric',
    '.boxplot-card',
    '.sec-card'
  ].join(',');
  let cards = [];
  if(scope.matches && scope.matches(selector)) cards.push(scope);
  cards = cards.concat(Array.from(scope.querySelectorAll(selector)));
  cards.forEach(card => {
    _cardExplanationStripNativeTooltips(card);
    let originalTitle = _cardExplanationTextForElement(card);
    let key = _cardExplanationKeyForElement(card);
    if(!key) return;
    // Kart adları artık üretim kaynağında (app-analysis.js) sabitlendi.
    // Burada yalnızca popup başlığı karttaki mevcut görünen adla aynı tutulur.
    _cardExplanationAddButton(card, key, originalTitle);
  });
}

let _cardExplanationDecorateScheduled = false;
function scheduleCardExplanationDecorate(root){
  if(_cardExplanationDecorateScheduled) return;
  _cardExplanationDecorateScheduled = true;
  requestAnimationFrame(() => {
    _cardExplanationDecorateScheduled = false;
    decorateCardExplanations(root || document);
  });
}

function initCardExplanationSystem(){
  if(window.__cardExplanationSystemReady) return;
  window.__cardExplanationSystemReady = true;
  document.addEventListener('click', event => {
    if(event.target.closest('[data-card-explanation-close]')) {
      event.preventDefault();
      event.stopPropagation();
      closeCardExplanation(true);
      return;
    }
    let btn = event.target.closest('[data-card-explanation]');
    if(btn) {
      event.preventDefault();
      event.stopPropagation();
      openCardExplanation(btn.dataset.cardExplanation, btn);
      return;
    }
    if(_activeCardExplanationPopover && !event.target.closest('.card-explanation-popover')) {
      closeCardExplanation(false);
    }
  });
  document.addEventListener('keydown', event => {
    if(event.key === 'Escape') closeCardExplanation();
  });
  ['homeArea', 'anlRes', 'riskPanel', 'kCont', 'raporRes'].forEach(id => {
    let el = document.getElementById(id);
    if(!el || typeof MutationObserver === 'undefined') return;
    let observer = new MutationObserver(() => scheduleCardExplanationDecorate(el));
    observer.observe(el, { childList: true, subtree: true });
  });
  window.addEventListener('resize', () => closeCardExplanation(false));
  window.addEventListener('orientationchange', () => closeCardExplanation(false));
  decorateCardExplanations(document);
}

if(document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCardExplanationSystem);
} else {
  setTimeout(initCardExplanationSystem, 0);
}

window.decorateCardExplanations = decorateCardExplanations;
window.openCardExplanation = openCardExplanation;
window.closeCardExplanation = closeCardExplanation;

function updateFilterSummary(){
  let box = getEl('filterSummary'); if(!box) return;
  box.hidden = true;
  box.innerHTML = '';
}

function resetAnalysisFilters(){
  let currentType = getEl('aType') ? (getEl('aType').value || 'student') : 'student';
  const resetControls = () => {
    if(currentType === 'student') ['aEx','aExDate','aSub'].forEach(_resetSel);
    else if(currentType === 'risk') ['riskGradeFilter','riskBranchFilter','riskExTypeFilter','riskLevelFilter'].forEach(_resetSel);
    else ['aLvl','aBr','aEx','aDate','aSub'].forEach(_resetSel);
  };
  if(currentType === 'student'){
    aNo = null;
    ['anlStuInp','anlStuRes','anlStuBadge','aBadge'].forEach(id => {
      let el = getEl(id); if(!el) return;
      if(id.endsWith('Inp')) el.value = '';
      else if(id.endsWith('Res')) { el.innerHTML = ''; el.style.display = 'none'; }
      else el.innerHTML = id === 'aBadge' ? '<span class="text-muted">Seçilmedi</span>' : '';
    });
  }
  resetControls();
  if(getEl('aType')) getEl('aType').value = currentType;
  if(getEl('anlRes')) getEl('anlRes').innerHTML = '';
  uUI();
  resetControls();
  if(currentType === 'student') {
    uStudentExamDates();
    resetControls();
    uSub();
  } else if(currentType !== 'risk') {
    uBranches();
    uExamTypes();
    resetControls();
    uExamDates();
    uSub();
    _updateGDateVisibility();
  }
  applyExamColorToFilters();
  _updateAnalysisFilterLocks();
  updateFilterSummary();
  if(currentType === 'risk' && typeof renderRiskPanel === 'function') renderRiskPanel();
  reqAnl();
}

function onRiskFilterChange(rebuild){
  if(rebuild) _populateRiskFilterDropdowns();
  else _populateRiskFilterDropdowns();
  _updateAnalysisFilterLocks();
  renderRiskPanel();
  applyExamColorToFilters();
  updateFilterSummary();
}

// Ders Analizi › "Tüm Dersler" seçeneğinin değeri (gerçek ders adlarıyla çakışmaz)
const SUBJ_ALL_VALUE = '__ALL_SUBJECTS__';

function uSub(){
  let aT=getEl('aType')?getEl('aType').value:'', t=getEl('aEx')?getEl('aEx').value:'';
  let subEl = getEl('aSub'); if(!subEl) return;
  let lvlF = (aT==='class'||aT==='subject'||aT==='examdetail') && getEl('aLvl') ? getEl('aLvl').value : '';
  let brRaw = (aT==='class'||aT==='subject'||aT==='examdetail') && getEl('aBr') ? getEl('aBr').value : '';
  let brF  = brRaw === '__ALL__' ? '' : brRaw;
  let dtF  = (aT==='class'||aT==='subject'||aT==='examdetail') && getEl('aDate')
    ? (typeof getAnalysisDateValue === 'function' ? getAnalysisDateValue() : getEl('aDate').value)
    : '';
  let subjectFilters = { grade:lvlF, branch:brF, examType:t, date:dtF };
  let subjects = [];
  
  if(aT === 'student' || aT === 'class') {
    let _isSingleExam = (aT === 'student') && typeof isStudentSingleExamSelection === 'function' && isStudentSingleExamSelection();
    let _curVal = subEl.value || '';
    let o = optionHtml('', 'Veri Seçiniz', !_curVal, true);
    if(_isSingleExam) o += optionHtml('summary', 'Sınav Özeti', _curVal==='summary');
    o += optionHtml('totalNet', 'Toplam Net', _curVal==='totalNet') + optionHtml('score', 'Puan', _curVal==='score');
    if (aT === 'student') { o += optionHtml('rank_c', 'Sınıf Sıralaması', _curVal==='rank_c') + optionHtml('rank_i', 'Kurum Sıralaması', _curVal==='rank_i') + optionHtml('rank_g', 'Genel Sıralama', _curVal==='rank_g'); }
    if(aT === 'student') {
      let dateRaw = typeof getStudentExamDateValue === 'function' ? getStudentExamDateValue() : ((getEl('aExDate')||{}).value || '');
      let date = '', publisher = '';
      if(dateRaw && dateRaw !== '__ALL__') [date, publisher=''] = dateRaw.split('||');
      subjects = _resultSubjects({ studentNo:aNo, examType:t, date });
      if(date && publisher) {
        subjects = [...new Set(_resultRows({ studentNo:aNo, examType:t, date }).filter(e => (e.publisher||'') === publisher).flatMap(e => Object.keys(e.subs || {}).map(s => s.toLocaleLowerCase('tr-TR'))))].sort();
      }
    } else {
      subjects = _resultSubjects(subjectFilters);
    }
    subjects.forEach(x=> o += optionHtml(`s_${x}`, `${toTitleCase(x)} Neti`, _curVal==='s_'+x)); subEl.innerHTML = o;
    _applyAnalysisSubValue('', _curVal);
  } else if (aT === 'examdetail') {
    let prev = subEl.value || '';
    let rawDate = getEl('aDate') ? getEl('aDate').value : '';
    let _validVals = rawDate === '__ALL__'
      ? ['general_summary','list_all']
      : (rawDate ? ['summary','list_single'] : []);
    let _selVal = _validVals.includes(prev) ? prev : '';
    if(!_validVals.length) {
      subEl.innerHTML = optionHtml('', 'Önce sınav seçin', true, true);
    } else if(rawDate === '__ALL__') {
      subEl.innerHTML = optionHtml('', 'Veri Seçiniz', !_selVal, true)
        + optionHtml('general_summary', 'Sınav Özeti (Tüm Sınavlar)', _selVal==='general_summary')
        + optionHtml('list_all', 'Toplu Liste (Tüm Sınavlar)', _selVal==='list_all');
    } else {
      subEl.innerHTML = optionHtml('', 'Veri Seçiniz', !_selVal, true)
        + optionHtml('summary', 'Sınav Özeti (Tek Sınav)', _selVal==='summary')
        + optionHtml('list_single', 'Toplu Liste (Tek Sınav)', _selVal==='list_single');
    }
    _applyAnalysisSubValue('', _selVal);
  } else if (aT === 'subject') {
    subjects = _resultSubjects(subjectFilters);
    // Sınav türü veya diğer filtreler değişince ders "Ders Seç" durumunda kalmalı.
    // _preferredAnalysisSub kullanmıyoruz; sadece mevcut subEl.value'yu (sıfırlanmış olabilir) koruyoruz.
    let prev = subEl.value || '';
    let opts = subjects.map(x=>optionHtml(x, toTitleCase(x))).join('');
    let allOpt = subjects.length ? optionHtml(SUBJ_ALL_VALUE, 'Tüm Dersler', prev === SUBJ_ALL_VALUE) : '';
    let ph = optionHtml('', 'Ders Seç', !prev, true);
    subEl.innerHTML = opts ? (ph + allOpt + opts) : optionHtml('', 'Ders bulunamadı', true, true);
    _applyAnalysisSubValue('', prev);
  } else {
    subEl.innerHTML=optionHtml('', 'Veri Seç', true, true);
    _applyAnalysisSubValue('');
  }
}

function _updateGDateVisibility() {
  let t = getEl('aType') ? getEl('aType').value : '';
  let sub = getEl('aSub') ? getEl('aSub').value : '';
  if(t === 'examdetail') {
    getEl('gDate').style.display = 'block';
  } else if(t === 'student') {
    getEl('gDate').style.display = 'none';
  } else if(t === 'class' || t === 'subject') {
    getEl('gDate').style.display = 'block';
  }
}

function _resetSel(id){
  let el = getEl(id); if(!el) return;
  el.value = '';
  if(el.options.length && el.options[0].disabled){ el.options[0].selected = true; }
}

function onLvlChange(){
  _rememberAnalysisSub();
  _resetSel('aBr'); _resetSel('aEx'); _resetSel('aDate'); _resetSel('aSub');
  uBranches(); uExamTypes();
  uExamDates(); uSub(); _updateGDateVisibility(); _updateAnalysisFilterLocks(); reqAnl();
}

function onBrChange(){
  _rememberAnalysisSub();
  _resetSel('aEx'); _resetSel('aDate'); _resetSel('aSub');
  uExamTypes();
  uExamDates(); uSub(); _updateGDateVisibility(); _updateAnalysisFilterLocks(); reqAnl();
}

function onExTypeChange(){
  let _aT = getEl('aType') ? getEl('aType').value : '';
  if(_aT === 'student' && !aNo){
    // Sınav türüne tıklandı ama öğrenci seçilmedi — uyarı ver ve dropdown'ı sıfırla
    showToast('Lütfen öğrenci seçiniz!', 'warning', 3000);
    getEl('aEx').value = '';
    return;
  }
  _rememberAnalysisSub();
  _resetSel('aDate');
  _resetSel('aSub');
  // Öğrenci modunda yeni sınav seçim dropdown'ı da sıfırlanır
  let _aExDate = getEl('aExDate'); if(_aExDate) _aExDate.value = '';
  uExamDates(); uStudentExamDates(); uSub(); _updateGDateVisibility();
  _updateAnalysisFilterLocks();
  applyExamColorToFilters(); reqAnl();
}

// ---- onExDateStudentChange: Öğrenci modu — tek sınav/Tümü ayrımı ----
function onExDateStudentChange(){
  let _aT = getEl('aType') ? getEl('aType').value : '';
  if(_aT === 'student' && !aNo){
    showToast('Lütfen öğrenci seçiniz!', 'warning', 3000);
    let _el = getEl('aExDate'); if(_el) _el.value = '';
    return;
  }
  // Veri listesi tek sınav/tüm sınav seçimine göre değişir; yeni seçimde veri tekrar seçilir.
  _resetSel('aSub');
  uSub();
  _updateAnalysisFilterLocks();
  applyExamColorToFilters();
  reqAnl();
}

// ---- uStudentExamDates: Öğrenci modunda aExDate dropdown'unu doldurur ----
// Seçilen sınav türüne ait sınavları tarih + yayınevi ile listeler.
// En üstte "Tümü" seçeneği, altında tarihe göre (en yeni en üstte) sıralı liste.
function uStudentExamDates(){
  let el = getEl('aExDate'); if(!el) return;
  let aT = getEl('aType') ? getEl('aType').value : '';
  let eT = getEl('aEx')   ? getEl('aEx').value   : '';
  if(aT !== 'student' || !aNo || !eT){
    el.innerHTML = optionHtml('', !aNo ? 'Önce öğrenci seçin' : (eT ? 'Sınav Seçiniz' : 'Önce sınav türü seçin'), true, true);
    el.value = '';
    return;
  }
  let entries = [];
  _resultRows({ studentNo:aNo, examType:eT }).forEach(e => entries.push({ date:e.date, publisher:e.publisher || '' }));
  // Unique (date+publisher), sonra tarih DESC sırala (en yeni en üstte)
  let seen = new Set(), unique = [];
  entries.forEach(x => { let k = x.date+'||'+x.publisher; if(!seen.has(k)){ seen.add(k); unique.push(x); } });
  unique.sort((a,b) => srt(b.date, a.date)); // DESC
  let prev = el.value;
  let opts = optionHtml('', unique.length ? 'Sınav Seçiniz' : 'Bu öğrenci için sınav yok', !prev, true)
    + (unique.length ? optionHtml('__ALL__', 'Tüm Sınavlar', prev === '__ALL__') : '')
    + unique.map(x => {
    let pub = x.publisher ? ` (${toTitleCase(x.publisher)})` : '';
    return optionHtml(`${x.date}||${x.publisher}`, `${x.date}${pub}`);
  }).join('');
  el.innerHTML = opts;
  // Önceki seçim geçerliyse koru; değilse kullanıcı açık seçim yapsın.
  if(prev && [...el.options].some(o=>o.value===prev && !o.disabled)) el.value = prev;
  else el.value = '';
}

// ---- applyExamColorToFilters: Sınav türü rengini filtre alanına ve analiz sonucuna uygular ----
function applyExamColorToFilters(){
  let aT = getEl('aType') ? getEl('aType').value : '';
  let eT = getEl('aEx')   ? getEl('aEx').value   : '';
  let riskETRaw = (getEl('riskExTypeFilter')||{}).value || '';
  let riskET = riskETRaw === '__ALL__' ? '' : riskETRaw;
  let filter = getEl('anlFilterCard');
  let res    = getEl('anlRes');
  let risk   = getEl('riskPanel');
  let aExWrap = getEl('aEx') ? getEl('aEx').closest('.aex-wrap') : null;

  // Eski sınıfları temizle
  [filter, res, risk, aExWrap].forEach(el => {
    if(!el) return;
    for(let i=0;i<8;i++) el.classList.remove('exam-color-'+i);
    el.removeAttribute('data-exam-color');
    if(aExWrap && el === aExWrap) el.removeAttribute('data-active');
  });

  let activeType = aT === 'risk' ? riskET : eT;
  if(!activeType) return;
  let idx = (typeof examColorIdx === 'function') ? examColorIdx(activeType) : 0;

  [filter, res].forEach(el => {
    if(!el) return;
    el.classList.add('exam-color-'+idx);
    el.setAttribute('data-exam-color', String(idx));
  });
  // Risk paneli sadece risk modunda ve riskExTypeFilter doluysa renk alır
  if(risk){
    if(aT === 'risk' && riskET){
      risk.classList.add('exam-color-'+idx);
      risk.setAttribute('data-exam-color', String(idx));
    }
  }
  // Dropdown yan badge
  if(aExWrap && aT !== 'risk'){
    aExWrap.classList.add('exam-color-'+idx);
    aExWrap.setAttribute('data-active','1');
  }
}

function onDateChange(){
  _rememberAnalysisSub();
  _resetSel('aSub');
  uSub(); _updateGDateVisibility(); _updateAnalysisFilterLocks(); reqAnl();
}

function uExamDates(){
  let t=getEl('aEx') ? getEl('aEx').value : '', dates=[], datePublisherMap = {}, aT = getEl('aType') ? getEl('aType').value : '';
  let dateEl = getEl('aDate'); if(!dateEl) return;
  if(!t){
    _setSelectPlaceholder('aDate', 'Önce sınav türü seçin');
    return;
  }
  let lvlGrade = (aT === 'subject' || aT === 'class' || aT === 'examdetail') && getEl('aLvl') ? (getEl('aLvl').value || '') : '';
  let brRaw = (aT === 'subject' || aT === 'class' || aT === 'examdetail') && getEl('aBr') ? getEl('aBr').value : '';
  let brF = brRaw === '__ALL__' ? '' : brRaw;
  _resultRows({ grade:lvlGrade, branch:brF, examType:t }).forEach(e => {
    dates.push(e.date);
    if(e.publisher) datePublisherMap[e.date] = e.publisher;
  });
  dates = [...new Set(dates)].sort((a,b)=>srt(b,a));
  let prev = dateEl.value;
  let prefixOpt = '';
  if(aT === 'class' || aT === 'subject' || aT === 'examdetail') {
    prefixOpt = optionHtml('', dates.length ? 'Sınav Seçiniz' : 'Uygun sınav yok', !prev, true)
      + (dates.length ? optionHtml('__ALL__', 'Tüm Sınavlar', prev === '__ALL__') : '');
  } else {
    prefixOpt = optionHtml('', dates.length ? 'Sınav Seç' : 'Uygun sınav yok', !prev, true);
  }
  dateEl.innerHTML = prefixOpt + dates.map(x => { let pub = datePublisherMap[x] ? ` (${toTitleCase(datePublisherMap[x])})` : ''; return optionHtml(x, `${x}${pub}`); }).join('');
  if(dates.includes(prev) || (prev === '__ALL__' && (aT === 'class' || aT === 'subject' || aT === 'examdetail'))) dateEl.value = prev;
  else dateEl.value = '';
}

function _populateAnalysisLevels(t){
  if(!(t==='class'||t==='examdetail'||t==='subject')) return;
  let lvlEl = getEl('aLvl'); if(!lvlEl) return;
  let prev = lvlEl.value;
  let levels = _resultGrades();
  lvlEl.innerHTML = optionHtml('', levels.length ? 'Sınıf Seviyesi Seç' : 'Verisi olan sınıf yok', !prev, true)
    + levels.map(x=>optionHtml(x, `${x}. Sınıf`, prev===x)).join('');
  if(levels.includes(prev)) lvlEl.value = prev;
  else lvlEl.value = '';
}

function _updateAnalysisFilterLocks(){
  let t = getEl('aType') ? getEl('aType').value : '';
  let lvl = getEl('aLvl') ? getEl('aLvl').value : '';
  let brRaw = getEl('aBr') ? getEl('aBr').value : '';
  let ex = getEl('aEx') ? getEl('aEx').value : '';
  let dateSelected = typeof hasAnalysisDateSelection === 'function' ? hasAnalysisDateSelection() : !!((getEl('aDate')||{}).value);
  let stuDateSelected = typeof hasStudentExamDateSelection === 'function' ? hasStudentExamDateSelection() : !!((getEl('aExDate')||{}).value);
  let sub = getEl('aSub') ? getEl('aSub').value : '';

  ['aLvl','aBr','aEx','aDate','aExDate','aSub','riskGradeFilter','riskBranchFilter','riskExTypeFilter','riskLevelFilter'].forEach(id => _setSelectLock(id, false, ''));

  if(t === 'student'){
    // Zincir: Öğrenci → Sınav Türü → Sınav → Veri
    // "Açık ama seçilmemiş ilk filtre" hangisi → ondan sonraki hepsi onu gösterir
    let blockMsg = !aNo ? 'Önce öğrenci seçin' : (!ex ? 'Önce sınav türü seçin' : 'Önce sınav seçin');
    _setSelectLock('aEx',     !aNo,                            !aNo ? 'Önce öğrenci seçin' : '');
    _setSelectLock('aExDate', !aNo || !ex,                     !aNo || !ex ? blockMsg : '');
    _setSelectLock('aSub',    !aNo || !ex || !stuDateSelected, !aNo || !ex || !stuDateSelected ? blockMsg : '');
  } else if(t === 'class' || t === 'subject'){
    // Zincir: Sınıf Seviyesi → Şube → Sınav Türü → Sınav → Veri
    let blockMsg = !lvl ? 'Önce sınıf seviyesi seçin' : (!brRaw ? 'Önce şube seçin' : (!ex ? 'Önce sınav türü seçin' : 'Önce sınav seçin'));
    _setSelectLock('aBr',   !lvl,                              !lvl ? 'Önce sınıf seviyesi seçin' : '');
    _setSelectLock('aEx',   !lvl || !brRaw,                    !lvl || !brRaw ? blockMsg : '');
    _setSelectLock('aDate', !lvl || !brRaw || !ex,             !lvl || !brRaw || !ex ? blockMsg : '');
    _setSelectLock('aSub',  !lvl || !brRaw || !ex || !dateSelected, !lvl || !brRaw || !ex || !dateSelected ? blockMsg : '');
  } else if(t === 'examdetail'){
    // Zincir: Sınıf Seviyesi → Şube → Sınav Türü → Sınav → Veri
    let blockMsg = !lvl ? 'Önce sınıf seviyesi seçin' : (!brRaw ? 'Önce şube seçin' : (!ex ? 'Önce sınav türü seçin' : 'Önce sınav seçin'));
    _setSelectLock('aBr',   !lvl,                              !lvl ? 'Önce sınıf seviyesi seçin' : '');
    _setSelectLock('aEx',   !lvl || !brRaw,                    !lvl || !brRaw ? blockMsg : '');
    _setSelectLock('aDate', !lvl || !brRaw || !ex,             !lvl || !brRaw || !ex ? blockMsg : '');
    _setSelectLock('aSub',  !lvl || !brRaw || !ex || !dateSelected, !lvl || !brRaw || !ex || !dateSelected ? blockMsg : '');
  } else if(t === 'risk'){
    // Zincir: Sınıf Seviyesi → Şube → Sınav Türü → Risk Türü
    let rg = getEl('riskGradeFilter') ? getEl('riskGradeFilter').value : '';
    let rb = getEl('riskBranchFilter') ? getEl('riskBranchFilter').value : '';
    let re = getEl('riskExTypeFilter') ? getEl('riskExTypeFilter').value : '';
    let blockMsg = !rg ? 'Önce sınıf seviyesi seçin' : (!rb ? 'Önce şube seçin' : 'Önce sınav türü seçin');
    _setSelectLock('riskBranchFilter', !rg,           !rg ? 'Önce sınıf seviyesi seçin' : '');
    _setSelectLock('riskExTypeFilter', !rg || !rb,    !rg || !rb ? blockMsg : '');
    _setSelectLock('riskLevelFilter',  !rg || !rb || !re, !rg || !rb || !re ? blockMsg : '');
  }
}

function uUI(){
  let t=getEl('aType').value;
  let isRisk = t === 'risk';

  // Risk modunda ana filtre alanlarını gizle, diğerlerinde normal davran
  getEl('gStu').style.display=(t==='student')?'block':'none';
  getEl('gLvl').style.display=(t==='class'||t==='examdetail'||t==='subject')?'block':'none';
  getEl('gBr').style.display=(t==='class'||t==='subject'||t==='examdetail')?'block':'none';

  // Risk modunda sınav türü, tarih, veri filtrelerini gizle
  let aExWrapper = getEl('aEx') ? getEl('aEx').closest('.mb-3')?.parentElement : null;
  if(aExWrapper) aExWrapper.style.display = isRisk ? 'none' : '';
  getEl('gDate').style.display = isRisk ? 'none' : (t==='student' ? 'none' : 'block');
  getEl('gSub').style.display = isRisk ? 'none' : 'block';
  // Öğrenci modunda yeni "Sınav Seç" dropdown'ı (aExDate) görünür
  let gExDateEl = getEl('gExDate');
  if(gExDateEl) gExDateEl.style.display = (!isRisk && t === 'student') ? 'block' : 'none';

  // Risk filtre slotları
  ['gRiskGrade','gRiskBranch','gRiskExType','gRiskLevel'].forEach(id => {
    let el = getEl(id); if(el) el.style.display = isRisk ? 'block' : 'none';
  });

  // anlRes ve riskPanel görünürlüğü
  getEl('anlRes').style.display = isRisk ? 'none' : 'block';
  getEl('riskPanel').style.display = isRisk ? 'block' : 'none';

  if(!isRisk){
    // gDate ve gSub görünürlüğü ve etiketleri
    if(t==='class'){
      getEl('gDate').style.display='block';
      let dateLbl=getEl('lblDate'); if(dateLbl) dateLbl.textContent='Sınav Seç';
      getEl('gSub').style.display='block'; getEl('lblSub').textContent='Veri';
    } else if(t==='subject'){
      getEl('gDate').style.display='block';
      let dateLbl=getEl('lblDate'); if(dateLbl) dateLbl.textContent='Sınav Seç';
      getEl('gSub').style.display='block'; getEl('lblSub').textContent='Ders';
    } else if(t==='examdetail'){
      getEl('gSub').style.display='block'; getEl('lblSub').textContent='Veri';
      getEl('gDate').style.display='block';
      let dateLbl=getEl('lblDate'); if(dateLbl) dateLbl.textContent='Sınav Seç';
    } else if(t==='student'){
      getEl('gDate').style.display='none';
      getEl('gSub').style.display='block'; getEl('lblSub').textContent='Veri';
    }

    _populateAnalysisLevels(t);
    uBranches(); uExamTypes(); uExamDates(); uSub(); uStudentExamDates();
  } else {
    // Risk modunda filtre dropdown'larını doldur
    _populateRiskFilterDropdowns();
    renderRiskPanel();
  }
  _updateAnalysisFilterLocks();
  applyExamColorToFilters();
  updateFilterSummary();
}

function _populateRiskFilterDropdowns() {
  let risks = (_riskCache && _riskCache.results) ? _riskCache.results : (typeof calcRiskScores === 'function' ? calcRiskScores() : []);
  let riskParts = (r) => _classParts(r.cls);
  // Sınıf Seviyesi
  let gradeEl = getEl('riskGradeFilter');
  if(gradeEl) {
    let prevG = gradeEl.value;
    let grades = risks.length
      ? [...new Set(risks.map(r => riskParts(r).grade).filter(Boolean))].sort((a,b)=>parseInt(a)-parseInt(b))
      : _resultGrades();
    gradeEl.innerHTML = optionHtml('', grades.length ? 'Sınıf Seviyesi Seç' : 'Risk verisi yok', !prevG, true)
      + (grades.length ? optionHtml('__ALL__', 'Tüm Sınıflar', prevG==='__ALL__') : '')
      + grades.map(g=>optionHtml(g, `${g}. Sınıf`, prevG===g)).join('');
    if(prevG === '__ALL__' && grades.length) gradeEl.value = prevG;
    else if(prevG && grades.includes(prevG)) gradeEl.value = prevG;
    else gradeEl.value = '';
  }
  // Şube (sınıf seviyesine göre filtreli)
  let branchEl = getEl('riskBranchFilter');
  if(branchEl) {
    let prevB = branchEl.value;
    let gradeRaw = getEl('riskGradeFilter') ? getEl('riskGradeFilter').value : '';
    let gradeF = gradeRaw === '__ALL__' ? '' : gradeRaw;
    let branches = [];
    if(gradeRaw) {
      branches = risks.length
        ? [...new Set(risks.filter(r => !gradeF || riskParts(r).grade === gradeF).map(r => riskParts(r).branch).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'tr'))
        : _resultBranches({ grade:gradeF });
    }
    branchEl.innerHTML = optionHtml('', gradeRaw ? (branches.length ? 'Şube Seç' : 'Uygun şube yok') : 'Önce sınıf seviyesi seçin', !prevB, true)
      + (branches.length ? optionHtml('__ALL__', 'Tüm Şubeler', prevB==='__ALL__') : '')
      + branches.map(b=>optionHtml(b, `${b} Şubesi`, prevB===b)).join('');
    if(prevB === '__ALL__' && branches.length) branchEl.value = prevB;
    else if(prevB && branches.includes(prevB)) branchEl.value = prevB;
    else branchEl.value = '';
  }
  // Sınav Türü — risk sonuçlarından, yoksa gerçek sonuç verisinden
  let exTypeEl = getEl('riskExTypeFilter');
  if(exTypeEl) {
    let prevET = exTypeEl.value;
    let gradeRaw = getEl('riskGradeFilter') ? getEl('riskGradeFilter').value : '';
    let branchRaw = getEl('riskBranchFilter') ? getEl('riskBranchFilter').value : '';
    let gradeF = gradeRaw === '__ALL__' ? '' : gradeRaw;
    let branchF = branchRaw === '__ALL__' ? '' : branchRaw;
    let allTypes = [];
    if(gradeRaw && branchRaw) {
      if(risks.length > 0) {
        let filteredRisks = risks.filter(r => {
          let p = riskParts(r);
          if(gradeF && p.grade !== gradeF) return false;
          if(branchF && p.branch !== branchF) return false;
          return true;
        });
        allTypes = [...new Set(filteredRisks.flatMap(r=>r.examTypes))].sort((a,b)=>a.localeCompare(b,'tr'));
      }
      if(!allTypes.length) allTypes = _resultExamTypes({ grade:gradeF, branch:branchF });
    }
    exTypeEl.innerHTML = optionHtml('', gradeRaw && branchRaw ? (allTypes.length ? 'Sınav Türü Seç' : 'Uygun sınav türü yok') : 'Önce şube seçin', !prevET, true)
      + (allTypes.length ? optionHtml('__ALL__', 'Tüm Sınav Türleri', prevET==='__ALL__') : '')
      + allTypes.map(t=>optionHtml(t, t, prevET===t)).join('');
    if(prevET === '__ALL__' && allTypes.length) exTypeEl.value = prevET;
    else if(prevET && allTypes.includes(prevET)) exTypeEl.value = prevET;
    else exTypeEl.value = '';
  }
}

function handleSubChange(){ 
  let t = getEl('aType').value, sub = getEl('aSub').value;
  if(t === 'student' && !aNo){
    showToast('Lütfen öğrenci seçiniz!', 'warning', 3000);
    let _sub = getEl('aSub'); if(_sub) { _sub.value = ''; if(_sub.options.length && _sub.options[0].disabled) _sub.options[0].selected = true; }
    return;
  }
  _rememberAnalysisSub(sub);
  _updateGDateVisibility();
  _updateAnalysisFilterLocks();
  reqAnl(); 
}

function _ensureTableScrollHints(scope){
  let boxes = [];
  if(scope.matches && scope.matches('.scroll, .table-responsive, .list-scroll')) boxes.push(scope);
  boxes = boxes.concat(Array.from(scope.querySelectorAll('.scroll, .table-responsive, .list-scroll')));
  let seen = new Set();
  boxes.forEach(box => {
    if(!box || seen.has(box) || !box.querySelector || !box.querySelector('table')) return;
    seen.add(box);
    let prev = box.previousElementSibling;
    let header = null;
    if(prev && prev.classList && prev.classList.contains('scroll-hint')){
      let headerCandidate = prev.previousElementSibling;
      if(headerCandidate && headerCandidate.classList && headerCandidate.classList.contains('sa-list-header')){
        header = headerCandidate;
        prev.remove();
      } else if(box.parentElement && box.parentElement.classList && box.parentElement.classList.contains('card-body')){
        headerCandidate = box.parentElement.previousElementSibling;
        if(headerCandidate && headerCandidate.classList && headerCandidate.classList.contains('sa-list-header')){
          header = headerCandidate;
          prev.remove();
        } else {
          return;
        }
      } else {
        return;
      }
    } else if(prev && prev.classList && prev.classList.contains('sa-list-header')){
      header = prev;
    } else if(box.parentElement && box.parentElement.classList && box.parentElement.classList.contains('card-body')){
      let headerCandidate = box.parentElement.previousElementSibling;
      if(headerCandidate && headerCandidate.classList && headerCandidate.classList.contains('sa-list-header')){
        header = headerCandidate;
      }
    }
    if(header){
      let inlineHint = header.querySelector(':scope > .scroll-hint-inline');
      if(!inlineHint){
        inlineHint = document.createElement('span');
        inlineHint.className = 'scroll-hint scroll-hint-inline';
        inlineHint.innerHTML = '<i class="fas fa-arrows-alt-h me-1"></i>Tabloyu kaydırın';
        header.appendChild(inlineHint);
      }
      inlineHint._scrollHintBox = box;
      return;
    }
    let hint = document.createElement('div');
    hint.className = 'scroll-hint';
    hint.innerHTML = '<i class="fas fa-arrows-alt-h me-1"></i>Tabloyu kaydırın';
    hint._scrollHintBox = box;
    box.parentNode.insertBefore(hint, box);
  });
}

function _tableNeedsHorizontalHint(box){
  if(!box) return false;
  let table = box.querySelector ? box.querySelector('table') : null;
  if(!table) return false;
  let estimateTableMinWidth = () => {
    let row = (table.tHead && table.tHead.rows && table.tHead.rows[0]) || table.rows[0];
    let cells = row ? Array.from(row.cells || []) : [];
    if(!cells.length) return 0;
    return cells.reduce((sum, cell) => {
      let text = (cell.textContent || '').replace(/\s+/g, ' ').trim();
      let len = Math.min(18, Math.max(2, text.length));
      return sum + Math.max(42, Math.min(150, 24 + len * 7));
    }, 10);
  };
  let boxRect = null, tableRect = null;
  try {
    boxRect = box.getBoundingClientRect();
    tableRect = table.getBoundingClientRect();
  } catch(e) {}
  let boxW = Math.max(box.clientWidth || 0, boxRect ? boxRect.width : 0);
  if(boxW <= 1) return false;
  let estimatedW = estimateTableMinWidth();
  let tableW = Math.max(table.scrollWidth || 0, table.offsetWidth || 0, tableRect ? tableRect.width : 0, estimatedW);
  if((box.scrollWidth || 0) > boxW + 2) return true;
  if(tableW > boxW + 2) return true;
  try {
    let viewportW = window.visualViewport && window.visualViewport.width
      ? window.visualViewport.width
      : (document.documentElement ? document.documentElement.clientWidth : window.innerWidth);
    if(tableRect && (tableRect.width > boxRect.width + 2 || tableRect.right > boxRect.right + 2)) return true;
    if(boxRect.right > viewportW + 2) return true;
    if(tableRect && tableRect.right > viewportW + 2) return true;
    let colCount = ((table.tHead && table.tHead.rows && table.tHead.rows[0]) || table.rows[0] || { cells:[] }).cells.length;
    if(viewportW <= 768 && colCount >= 6 && estimatedW > Math.min(boxW || viewportW, viewportW) + 2) return true;
  } catch(e) {}
  return false;
}

// Tablo ipucu: "Tabloyu kaydırın" sadece gerçekten yatay taşma varsa görünsün.
function updateScrollHints(root){
  let scope = root && root.querySelectorAll ? root : document;
  _ensureTableScrollHints(scope);
  scope.querySelectorAll('.scroll-hint').forEach(hint => {
    let box = hint._scrollHintBox && document.contains(hint._scrollHintBox) ? hint._scrollHintBox : null;
    if(!box){
      box = hint.nextElementSibling;
      while(box && !(box.classList && (box.classList.contains('scroll') || box.classList.contains('table-responsive') || box.classList.contains('list-scroll')))) {
        box = box.nextElementSibling;
      }
    }
    let needs = false;
    if(box) needs = _tableNeedsHorizontalHint(box);
    hint.classList.toggle('is-needed', !!needs);
  });
}
function scheduleScrollHints(root){
  clearTimeout(window._scrollHintTimer);
  window._scrollHintTimer = setTimeout(() => updateScrollHints(root || document), 80);
}
if(typeof document !== 'undefined'){
  document.addEventListener('DOMContentLoaded', () => {
    scheduleScrollHints();
    if(window.MutationObserver && document.body){
      let observer = new MutationObserver(() => scheduleScrollHints());
      observer.observe(document.body, { childList:true, subtree:true });
      window._scrollHintObserver = observer;
    }
    window.addEventListener('resize', () => scheduleScrollHints());
  });
}

