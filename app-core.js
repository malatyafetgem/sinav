// app-core.js — Firebase init, auth, global state, init, data fetch, helpers

Chart.register(ChartDataLabels);

const firebaseConfig = {
  apiKey: "AIzaSyCbgwrcjkFF8yf2S2zOFzIt8w18oqmI6oQ",
  authDomain: "fetgemfen-f9580.firebaseapp.com",
  projectId: "fetgemfen-f9580",
  storageBucket: "fetgemfen-f9580.firebasestorage.app",
  messagingSenderId: "220756328676",
  appId: "1:220756328676:web:def468b1b6a98474acecf1",
  databaseURL: "https://fetgemfen-f9580-default-rtdb.europe-west1.firebasedatabase.app"
};

firebase.initializeApp(firebaseConfig);

const database = firebase.database();

const auth = firebase.auth();

let APP_BROWSER_ONLINE = (typeof navigator === 'undefined') ? true : navigator.onLine !== false;
let APP_FIREBASE_CONNECTED = false;
let _lastOfflineWriteToastAt = 0;
let _raporInitTimer = null;
let _batchFetchChain = Promise.resolve();

function canWriteOnline(){
  return APP_BROWSER_ONLINE && APP_FIREBASE_CONNECTED;
}

function ensureOnlineForWrite(actionLabel = 'Bu işlem'){
  if(canWriteOnline()) return true;
  let now = Date.now();
  if(now - _lastOfflineWriteToastAt > 1500){
    showToast(`${actionLabel} için aktif internet/Firebase bağlantısı gerekiyor. Bağlantı kurulunca tekrar deneyin.`, 'warning', 5500);
    _lastOfflineWriteToastAt = now;
  }
  return false;
}

// Yönetici gerektiren yazma işlemlerinde arayüz düzeyinde ön kontrol (asıl koruma Firebase kurallarındadır)
function requireAdmin(actionLabel = 'Bu işlem'){
  if(document.body.classList.contains('is-admin')) return true;
  showToast(`${actionLabel} yalnızca yönetici tarafından yapılabilir.`, 'error');
  return false;
}

function uConn(online){
  APP_FIREBASE_CONNECTED = online === true;
  const d=document.getElementById('connDot'),t=document.getElementById('connTxt'),b=document.getElementById('connBadge');if(!d||!t||!b)return;
  d.textContent='';
  if(APP_BROWSER_ONLINE && APP_FIREBASE_CONNECTED){t.textContent='Bağlı';b.className='nav-link conn-badge is-online';b.title='Firebase bağlantısı aktif';}
  else{t.textContent='Çevrimdışı';b.className='nav-link conn-badge is-offline';b.title=APP_BROWSER_ONLINE?'Firebase bağlantısı yok':'İnternet bağlantısı yok';}
}

database.ref('.info/connected').on('value',snap=>uConn(snap.val()===true),()=>uConn(false));

window.addEventListener('online', () => {
  APP_BROWSER_ONLINE = true;
  uConn(APP_FIREBASE_CONNECTED);
  showToast('İnternet bağlantısı yeniden kuruldu.', 'success', 2500);
});

window.addEventListener('offline', () => {
  APP_BROWSER_ONLINE = false;
  uConn(false);
  showToast('İnternet bağlantısı kesildi. Veri yazma işlemleri bağlantı gelene kadar durduruldu.', 'warning', 5000);
});

function showStartup(message){
  document.body.classList.add('auth-pending');
  const loader = getEl('loader'), txt = getEl('l-txt');
  if(txt) txt.textContent = message || 'Oturum kontrol ediliyor...';
  if(loader) loader.style.display = 'flex';
}

function clearStartup(){
  document.body.classList.remove('auth-pending');
  const loader = getEl('loader');
  if(loader) loader.style.display = 'none';
}

function metaGrades(meta){
  if(!meta || !Array.isArray(meta.grades)) return [];
  return meta.grades.map(g => String(g).trim()).filter(Boolean);
}

function metaHasGrade(meta, grade){
  if(!grade) return true;
  const grades = metaGrades(meta);
  return !grades.length || grades.includes(String(grade).trim());
}

function metaIntersectsGrades(meta, grades){
  const wanted = [...(grades || [])].map(g => String(g).trim()).filter(Boolean);
  if(!wanted.length) return true;
  const existing = metaGrades(meta);
  return !existing.length || wanted.some(g => existing.includes(g));
}

function toCleanArray(val){
  // filter(x => x) yerine açık null/undefined kontrolü: 0 veya false değerli geçerli
  // kayıtların yanlışlıkla elenmesini önler.
  const notNullish = x => x !== null && x !== undefined;
  return Array.isArray(val)
    ? val.filter(notNullish)
    : (val && typeof val === 'object' ? Object.values(val).filter(notNullish) : []);
}

function getSelectValueIfEnabled(id){
  const el = getEl(id);
  if(!el || el.selectedIndex < 0) return '';
  const opt = el.options[el.selectedIndex];
  if(opt && opt.disabled) return '';
  return el.value || '';
}

function getAnalysisDateValue(){
  const raw = getSelectValueIfEnabled('aDate');
  return raw === '__ALL__' ? '' : raw;
}

function getStudentExamDateValue(){
  const raw = getSelectValueIfEnabled('aExDate');
  return raw === '__ALL__' ? '' : raw;
}

function hasAnalysisDateSelection(){
  const el = getEl('aDate');
  if(!el) return false;
  return !!getSelectValueIfEnabled('aDate');
}

function hasStudentExamDateSelection(){
  const el = getEl('aExDate');
  if(!el) return false;
  return !!getSelectValueIfEnabled('aExDate');
}

function isStudentSingleExamSelection(){
  const raw = getSelectValueIfEnabled('aExDate');
  return !!raw && raw !== '__ALL__';
}

function showAnalysisHint(message){
  const res = getEl('anlRes');
  if(res) res.innerHTML = `<div class="alert alert-default-info"><i class="fas fa-info-circle me-2"></i>${escapeHtml(message)}</div>`;
  if(typeof applyExamColorToFilters === 'function') applyExamColorToFilters();
}

function checkAuth(){
  let settled = false;
  const loaderDelay = setTimeout(() => {
    if(!settled) showStartup('Oturum kontrol ediliyor...');
  }, 2500);
  const authTimeout = setTimeout(() => {
    if(settled) return;
    const login = getEl('loginScreen'), app = getEl('mainApp');
    const loginHidden = !login || getComputedStyle(login).display === 'none';
    const appHidden = !app || getComputedStyle(app).display === 'none';
    if(login && app && loginHidden && appHidden){
      clearStartup();
      login.style.display = 'flex';
    }
  }, 7000);
  auth.onAuthStateChanged(async user=>{
    settled = true;
    clearTimeout(loaderDelay);
    clearTimeout(authTimeout);
    clearStartup();
    if(user){
      getEl('loginScreen').style.display='none';
      getEl('mainApp').style.display='';
      if(getEl('userEmail'))getEl('userEmail').textContent=user.email;
      document.body.classList.remove('is-admin');
      try {
  const tokenResult = await user.getIdTokenResult(true);
  if (tokenResult.claims.admin === true) {
    document.body.classList.add('is-admin');
  }
} catch (e) {
  console.warn('Admin claim okunamadı:', e);
}
      
      // Yenileme sonrası mevcut URL hash'ini oku ve o sekmede kal
      setTimeout(() => { 
        let targetPane = typeof paneFromLocation === 'function' ? paneFromLocation() : (window.location.hash.replace('#', '') || 'anasayfa_genel');
        if(targetPane === 'ayarlar' && !document.body.classList.contains('is-admin')) targetPane = 'anasayfa_genel';
        
        // History'yi güncelle ve sekmeyi aktif et
        if(typeof setPaneHistory === 'function') {
          setPaneHistory(targetPane, 'replace');
        } else {
          let base = window.location.protocol === 'file:' ? window.location.href.split('#')[0] : (window.location.pathname + window.location.search);
          try { window.history.replaceState({ pane: targetPane }, '', targetPane === 'anasayfa_genel' ? base : base + '#' + targetPane); } catch(e) {}
        }
        executeTabSwitch(targetPane, true); // UI'ı bu sekmeye geçir
        if(typeof ensurePaneVisibility === 'function') ensurePaneVisibility(targetPane);
      }, 100);
      init().catch(err => {
        console.error('Başlatma hatası:', err);
        if(typeof showToast === 'function') showToast('Veriler yüklenirken hata oluştu. Menü ve sayfa geçişleri açık tutuldu.', 'error');
        if(typeof ensurePaneVisibility === 'function') ensurePaneVisibility();
        ld(0);
      });
      showPwaPopupIfReady();

    }else{
      getEl('loginScreen').style.display='flex';
      getEl('mainApp').style.display='none';
      document.body.classList.remove('is-admin');
    }
  });
}

function login(){
  const em=getEl('loginEmail').value.trim(),pa=getEl('loginPass').value;
  const err=getEl('loginError'),btn=getEl('btnLogin');
  err.style.display='none';
  if(!em||!pa){err.textContent='E-posta ve şifre gerekli.';err.style.display='block';return;}
  const orgHTML='<i class="fas fa-sign-in-alt me-2"></i>Giriş Yap';
  btn.innerHTML='<span class="spinner-border spinner-border-sm me-2"></span>Giriş yapılıyor...';btn.disabled=true;
  auth.signInWithEmailAndPassword(em,pa).then(()=>{btn.innerHTML=orgHTML;btn.disabled=false;}).catch(e=>{
    btn.innerHTML=orgHTML;btn.disabled=false;
    err.className='alert alert-danger mt-3 mb-0';err.style.display='block';
    if(e.code.includes('user-not-found')||e.code.includes('wrong-password')||e.code.includes('invalid-credential')) err.innerHTML='<i class="fas fa-exclamation-circle me-2"></i>Hatalı e-posta veya şifre.';
    else err.innerHTML='<i class="fas fa-times-circle me-2"></i>Hata: '+escapeHtml(e.message);
  });
}

function logout(){
  // signOut() tamamlanmadan sayfa yenilenirse oturum açık kalabilir; bitişini bekle (hata olsa da yenile)
  const done = () => location.reload();
  try { Promise.resolve(auth.signOut()).then(done, done); } catch(e){ done(); }
}

function togglePassword(){
  let inp = getEl('loginPass'), icon = getEl('togglePassIcon');
  if(inp.type === 'password'){ inp.type = 'text'; icon.classList.replace('fa-eye', 'fa-eye-slash'); } 
  else { inp.type = 'password'; icon.classList.replace('fa-eye-slash', 'fa-eye'); }
}

function openForgotPassword(e) {
  e.preventDefault();
  let em = getEl('loginEmail').value.trim();
  if(em) getEl('forgotEmail').value = em;
  getEl('forgotMsg').innerHTML = ''; showModal('mForgot');
}

function sendPasswordReset() {
  let em = getEl('forgotEmail').value.trim(), msg = getEl('forgotMsg');
  if(!em) { msg.innerHTML = '<span class="text-danger">E-posta adresi gerekli.</span>'; return; }
  // Kullanıcı numaralandırmayı önlemek için "kayıtlı değil" durumunda da aynı genel mesaj gösterilir
  const showSent = () => {
    msg.innerHTML = '<span class="text-success"><i class="fas fa-check-circle me-1"></i>Bu e-posta kayıtlıysa sıfırlama bağlantısı gönderildi. Lütfen e-postanızı kontrol edin.</span>';
    setTimeout(() => hideModal('mForgot'), 3000);
  };
  auth.sendPasswordResetEmail(em).then(showSent).catch(err => {
    if(err.code === 'auth/user-not-found'){ showSent(); return; }
    let errMsg = 'Bir hata oluştu.';
    if(err.code === 'auth/invalid-email') errMsg = 'Geçersiz e-posta adresi.';
    msg.innerHTML = `<span class="text-danger"><i class="fas fa-times-circle me-1"></i>${errMsg}</span>`;
  });
}

// chart görünüm varsayılanları — Chart.js renk ayarı ve açık grafikleri günceller
function applyTheme(){
  Chart.defaults.color='#475569';
  if(c.h)c.h.update();if(c.a)c.a.update();
  if(window._karneCharts) window._karneCharts.forEach(ch=>ch.update());
  if(window._raporCharts) window._raporCharts.forEach(ch=>ch.update());
}

function getEl(i){return document.getElementById(i);}

// xlsx kütüphanesi sayfayı bloke etmesin diye asenkron yüklenir; kullanılmadan önce hazır olup olmadığı kontrol edilir
function xlsxReady(){
  if(typeof XLSX !== 'undefined') return true;
  showToast('Excel kütüphanesi henüz yüklenmedi. Birkaç saniye sonra tekrar deneyin.', 'warning');
  return false;
}

// ---- Kullanıcıya özel yerel depolama ----
// Paylaşımlı bilgisayarda bir kullanıcının kayıtlı tercihleri (sütun eşleştirmeleri, filtre belleği) diğerine sızmasın diye
// anahtar kullanıcı kimliğiyle (uid) ön eklenir. Oturum bilgisi yokken okuma/yazma yapılmaz.
// Eski (kullanıcısız) anahtar varsa, ilk erişen kullanıcıya bir kez taşınır.
function userStorageKey(base){
  const u = (typeof auth !== 'undefined' && auth) ? auth.currentUser : null;
  return (u && u.uid) ? base + '::' + u.uid : null;
}
function userStorageGet(base){
  try {
    const k = userStorageKey(base); if(!k) return null;
    let v = localStorage.getItem(k);
    if(v === null){
      const legacy = localStorage.getItem(base);
      if(legacy !== null){ localStorage.setItem(k, legacy); localStorage.removeItem(base); v = legacy; }
    }
    return v;
  } catch(e){ return null; }
}
function userStorageSet(base, val){
  try { const k = userStorageKey(base); if(k) localStorage.setItem(k, val); } catch(e){}
}

function cleanupModalState(){
  if(document.querySelector('.modal.show')) return;
  document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
  document.body.classList.remove('modal-open');
  document.body.style.removeProperty('overflow');
  document.body.style.removeProperty('padding-right');
}

function getModal(id, options) {
  const el = getEl(id);
  if(!el || !window.bootstrap || !window.bootstrap.Modal) return null;
  return window.bootstrap.Modal.getOrCreateInstance(el, options || {});
}

function showModal(id, options) {
  const el = getEl(id);
  const modal = getModal(id, options);
  if(modal) {
    modal.show();
    return;
  }
  if(!el) return;
  el.style.display = 'block';
  el.removeAttribute('aria-hidden');
  el.setAttribute('aria-modal', 'true');
  el.classList.add('show');
  document.body.classList.add('modal-open');
}

function hideModal(id) {
  const el = getEl(id);
  const modal = getModal(id);
  if(modal) {
    modal.hide();
    setTimeout(cleanupModalState, 200);
    return;
  }
  if(!el) return;
  el.classList.remove('show');
  el.setAttribute('aria-hidden', 'true');
  el.removeAttribute('aria-modal');
  el.style.display = 'none';
  cleanupModalState();
}

document.addEventListener('hidden.bs.modal', cleanupModalState);

let DB = { s: [], e: [] };

let EXAM_META = {};
// Sınav bilgilerinin yüklenme durumu: 'loading' | 'ready' | 'error'.
// Sistem Özeti, veri gelmeden "Henüz sınav verisi yok" uyarısını göstermesin diye kullanılır.
let EXAM_META_STATE = 'loading';

let CACHED_RESULTS = {};

let aNo=null, c={h:null,a:null};

const cols=['#2563eb','#059669','#d97706','#dc2626','#7c3aed','#0891b2','#be185d','#4b5563'];

let dInf={},searchDebounceTimer=null,anlDebounceTimer=null,chartTimer=null;

let currentExcelData=[], currentUploadType='', currentHeaders=[], PENDING_UPLOAD=null;

function ld(s,m="İşlem yapılıyor..."){
  const txt = getEl('l-txt'), loader = getEl('loader');
  if(txt) txt.textContent = m;
  if(loader) loader.style.display = s ? 'flex' : 'none';
}

function showToast(message, type = 'info', duration = 4000) {
  const container = getEl('toastContainer');
  if(!container){ console.warn(message); return null; }
  const icons = { success: 'fa-check-circle', error: 'fa-times-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
  const toast = document.createElement('div');
  toast.className = `toast-item ${type}`;
  toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${escapeHtml(message)}</span><span class="toast-close" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.animation = 'slideOutRight 0.3s ease-out forwards'; setTimeout(() => toast.remove(), 300); }, duration);
  return toast;
}

function rebuildDbFromCache(){
  let allE = [];
  Object.keys(CACHED_RESULTS || {}).forEach(bId => {
    if(Array.isArray(CACHED_RESULTS[bId])) allE = allE.concat(CACHED_RESULTS[bId]);
  });
  let validNos = new Set((DB.s || []).map(s => s.no));
  DB.e = allE
    .filter(e => e && e.studentNo && validNos.has(e.studentNo))
    .map(e => ({...e, studentClass: normalizeClassName(e.studentClass)}));
  _applyDerivedRanks(DB.e);
  _riskCache = null;
}

// Sınıf ve kurum sıraları (cR/cP/iR/iP), yükleme anında saklanan değerlerden değil, güncel veriden türetilir:
// öğrenci silinince, sınıf değişince ya da birleştirmeli yüklemede bayatlamaz.
// Puana göre azalan sıralanır; eşit puanlar aynı sırayı alır (1-2-2-4). Sınıf sırası sınav paketi + sınıf,
// kurum sırası sınav paketi + sınıf seviyesi içinde hesaplanır (yükleme anındaki gruplamayla aynı).
// Yalnızca bellekteki kopyalar (DB.e) güncellenir; CACHED_RESULTS ve Firebase'deki ham kayıtlara dokunulmaz.
function _applyDerivedRanks(rows){
  const clsGroups = new Map(), instGroups = new Map();
  const push = (map, key, item) => { let g = map.get(key); if(!g){ g = []; map.set(key, g); } g.push(item); };
  rows.forEach(e => {
    if(e.abs) return;
    const sc = typeof e.score === 'number' ? e.score : parseNumberStrict(e.score);
    if(sc === null || !isFinite(sc)) return;
    const item = { e, sc }, b = e.examBatchId || '';
    push(clsGroups, b + '|' + e.studentClass, item);
    push(instGroups, b + '|' + getGrade(e.studentClass), item);
  });
  const assign = (list, rk, pk) => {
    list.sort((a, b) => b.sc - a.sc);
    let rank = 0;
    list.forEach((it, i) => {
      if(i === 0 || it.sc !== list[i - 1].sc) rank = i + 1;
      it.e[rk] = String(rank); it.e[pk] = String(list.length);
    });
  };
  clsGroups.forEach(l => assign(l, 'cR', 'cP'));
  instGroups.forEach(l => assign(l, 'iR', 'iP'));
}

// Başka bir oturumda silinen ya da değiştirilen sınav paketlerinin bellek önbelleğini geçersiz kıl
// (karşılaştırmada boş değerler/diziler yok sayılır; Firebase boş dizileri saklamaz)
function _metaCanon(v){
  if(v === null || v === undefined) return undefined;
  if(Array.isArray(v)){ if(!v.length) return undefined; return '[' + v.map(x => _metaCanon(x)).join(',') + ']'; }
  if(typeof v === 'object'){
    const ks = Object.keys(v).sort().map(k => { const c = _metaCanon(v[k]); return c === undefined ? null : JSON.stringify(k) + ':' + c; }).filter(Boolean);
    return ks.length ? '{' + ks.join(',') + '}' : undefined;
  }
  return JSON.stringify(v);
}
function _invalidateStaleBatchCache(prevMeta, nextMeta){
  Object.keys(CACHED_RESULTS || {}).forEach(bId => {
    if(!nextMeta[bId]){ delete CACHED_RESULTS[bId]; return; }
    if(prevMeta && prevMeta[bId] && _metaCanon(prevMeta[bId]) !== _metaCanon(nextMeta[bId])) delete CACHED_RESULTS[bId];
  });
}

function scheduleRaporInit(delay = 150){
  if(!getEl('rapor') || !getEl('rapor').classList.contains('active-pane') || typeof raporInit !== 'function') return;
  clearTimeout(_raporInitTimer);
  _raporInitTimer = setTimeout(() => {
    if(getEl('rapor') && getEl('rapor').classList.contains('active-pane') && typeof raporInit === 'function') raporInit();
  }, delay);
}

function toTitleCase(str) {
  if (!str) return '';
  return String(str).toLocaleLowerCase('tr-TR').split(' ').map(word => word.charAt(0).toLocaleUpperCase('tr-TR') + word.slice(1)).join(' ');
}

async function init(){
  applyTheme();
  // ld(1,'Sistem altyapısı hazırlanıyor...'); // Bu satırı sildik/kapattık

  database.ref('db_v2/students').on('value', snap => { 
    let sData = snap.val(); DB.s = (sData ? (Array.isArray(sData) ? sData.filter(x => x) : Object.values(sData).filter(x => x)) : []).map(s => s ? {...s, name: toTitleCase(s.name), class: normalizeClassName(s.class)} : s);
    _stuMapCache = null; // Map index'i yenile
    rebuildDbFromCache();
    rTabS(); uStat(); uDrp();
    scheduleRaporInit();
  }, err => showToast('Öğrenci verileri okunamadı: ' + err.message, 'error'));

  database.ref('db_v2/examMeta').on('value', async snap => {
    let _nextMeta = snap.val() || {};
    _invalidateStaleBatchCache(EXAM_META, _nextMeta);
    EXAM_META = _nextMeta; EXAM_META_STATE = 'ready'; uDrp(); rTabE(); uStat();
    let allIds = Object.keys(EXAM_META);
    try {
      if(allIds.length) await fetchBatches(allIds, { showLoader:false });
      else rebuildDbFromCache();
    } catch(err) {
      rebuildDbFromCache();
    }
    uDrp(); uStat();
    if(getEl('sonuclar') && getEl('sonuclar').classList.contains('active-pane') && typeof uUI === 'function') uUI();
    if(getEl('anasayfa') && getEl('anasayfa').classList.contains('active-pane') && aNo) reqProfile();
    scheduleRaporInit();
    if(typeof renderRiskPanel === 'function') renderRiskPanel();
    ld(0);
  }, err => { EXAM_META_STATE = 'error'; uStat(); showToast('Sınav bilgileri okunamadı: ' + err.message, 'error'); });
}

async function fetchBatches(batchIds, options = {}) {
  let ids = [...new Set((batchIds || []).filter(Boolean))].filter(bId => !CACHED_RESULTS[bId]);
  if(!ids.length){ rebuildDbFromCache(); return; }

  let run = _batchFetchChain.then(async () => {
    let missing = ids.filter(bId => !CACHED_RESULTS[bId]);
    if(!missing.length){ rebuildDbFromCache(); return; }
    if(APP_BROWSER_ONLINE === false){
      showToast('İnternet yokken eksik sınav sonuçları indirilemedi. Bağlantı gelince tekrar deneyin.', 'warning', 5500);
      rebuildDbFromCache();
      return;
    }

    let useLoader = options.showLoader !== false;
    if(useLoader) ld(1, options.message || 'Sonuçlar indiriliyor...');
    try {
      const chunkSize = options.chunkSize || 6;
      for(let i = 0; i < missing.length; i += chunkSize){
        let chunk = missing.slice(i, i + chunkSize).filter(bId => !CACHED_RESULTS[bId]);
        if(!chunk.length) continue;
        await Promise.all(chunk.map(bId =>
          database.ref('db_v2/examResults/' + bId).once('value').then(snap => {
            let val = snap.val();
            CACHED_RESULTS[bId] = toCleanArray(val);
          })
        ));
      }
    } catch(err) {
      showToast('Sınav sonuçları indirilemedi: ' + err.message, 'error', 6000);
      throw err;
    } finally {
      rebuildDbFromCache();
      if(useLoader) ld(0);
    }
  });
  _batchFetchChain = run.catch(() => {});
  return run;
}

async function reqProfile() {
  if(!aNo) return;
  let st = getStuMap().get(aNo), stGrade = st ? getGrade(st.class) : null, neededBatches = [];
  Object.keys(EXAM_META).forEach(bId => { let meta = EXAM_META[bId]; if(metaHasGrade(meta, stGrade)) neededBatches.push(bId); });
  await fetchBatches(neededBatches); rH();
}

function refreshAfterAnalysisRender(){
  let root = getEl('anlRes') || getEl('riskPanel') || document;
  const refreshExplanations = () => {
    if(typeof decorateCardExplanations === 'function') decorateCardExplanations(root);
  };
  refreshExplanations();
  setTimeout(refreshExplanations, 120);
  setTimeout(refreshExplanations, 360);
  if(typeof scheduleScrollHints === 'function') {
    scheduleScrollHints(root);
    setTimeout(() => scheduleScrollHints(root), 160);
    setTimeout(() => scheduleScrollHints(root), 420);
  }
}

async function reqAnl() {
  let eT = getEl('aEx').value, dt = getAnalysisDateValue(), aT = getEl('aType').value, sub = getSelectValueIfEnabled('aSub');
  let needed = [];

  // Risk analizi tüm geçmiş sonuçlardan üretildiği için eksik paket varsa bu ekranda tamamlanır.
  if(aT === 'risk') {
    let ids = Object.keys(EXAM_META || {});
    if(ids.length) await fetchBatches(ids, { message:'Risk verileri hazırlanıyor...' });
    if(typeof renderRiskPanel === 'function') renderRiskPanel();
    if(typeof applyExamColorToFilters === 'function') applyExamColorToFilters();
    refreshAfterAnalysisRender();
    return;
  }

  if(aT === 'student'){
    if(!aNo){
      showAnalysisHint('Analiz oluşturmak için öğrenci seçin.');
      return;
    }
    if(!eT){
      showAnalysisHint('Analiz oluşturmak için sınav türünü seçin.');
      return;
    }
    if(!hasStudentExamDateSelection()){
      showAnalysisHint('Analiz oluşturmak için sınav seçin ya da "Tüm Sınavlar" seçeneğini kullanın.');
      return;
    }
    if(!sub){
      showAnalysisHint('Analiz oluşturmak için veri türünü seçin.');
      return;
    }
  }

  let lvlF = (aT==='class'||aT==='subject'||aT==='examdetail') && getEl('aLvl') ? getEl('aLvl').value : '';
  let brRawF = (aT==='class'||aT==='subject'||aT==='examdetail') && getEl('aBr') ? getEl('aBr').value : '';
  if((aT === 'class' || aT === 'subject' || aT === 'examdetail') && !lvlF){
    showAnalysisHint('Analiz oluşturmak için sınıf seviyesini seçin.');
    return;
  }
  if((aT === 'class' || aT === 'subject' || aT === 'examdetail') && !brRawF){
    showAnalysisHint('Analiz oluşturmak için şube seçin ya da "Tümü" seçeneğini kullanın.');
    return;
  }
  if((aT === 'class' || aT === 'subject' || aT === 'examdetail') && !eT){
    showAnalysisHint('Analiz oluşturmak için sınav türünü seçin.');
    return;
  }
  if((aT === 'class' || aT === 'subject') && !sub){
    showAnalysisHint(aT === 'subject' ? 'Analiz oluşturmak için dersi seçin.' : 'Analiz oluşturmak için veri türünü seçin.');
    return;
  }
  if((aT === 'class' || aT === 'subject') && !hasAnalysisDateSelection()){
    showAnalysisHint('Analiz oluşturmak için sınav seçin ya da "Tüm Sınavlar" seçeneğini kullanın.');
    return;
  }
  if(aT === 'examdetail' && !hasAnalysisDateSelection()){
    showAnalysisHint('Analiz oluşturmak için sınav seçin ya da "Tüm Sınavlar" seçeneğini kullanın.');
    return;
  }
  if(aT === 'examdetail' && !sub){
    showAnalysisHint('Analiz oluşturmak için veri türünü seçin.');
    return;
  }

  if(!eT){
    if(typeof applyExamColorToFilters === 'function') applyExamColorToFilters();
    if(typeof rAnl === 'function') rAnl();
    else getEl('anlRes').innerHTML='';
    refreshAfterAnalysisRender();
    return;
  }

  // Hangi batch'lerin yüklenmesi gerektiğini belirle
  if(aT === 'student'){
    // Öğrenci analizi: öğrenci seçilmeli
    if(!aNo){ getEl('anlRes').innerHTML=''; return; }
    let st = getStuMap().get(aNo), stuGrade = st ? getGrade(st.class) : null;
    Object.keys(EXAM_META).forEach(bId => {
      let m = EXAM_META[bId];
      if(m.examType !== eT) return;
      if(!metaHasGrade(m, stuGrade)) return;
      needed.push(bId);
    });
  } else if(aT === 'class' || aT === 'subject'){
    // Sınıf/Ders analizi: öğrenci seçiminden bağımsız
    Object.keys(EXAM_META).forEach(bId => {
      let m = EXAM_META[bId];
      if(m.examType !== eT) return;
      if(!metaHasGrade(m, lvlF)) return;
      if(dt && m.date !== dt) return;
      needed.push(bId);
    });
  } else if(aT === 'examdetail'){
    // Sınav analizi: öğrenci seçiminden bağımsız
    if(sub === 'general_summary' || sub === 'list_all'){
      // Tüm sınavlar
      Object.keys(EXAM_META).forEach(bId => {
        let m = EXAM_META[bId];
        if(m.examType !== eT) return;
        if(!metaHasGrade(m, lvlF)) return;
        needed.push(bId);
      });
    } else {
      // Tek sınav + önceki sınav (özet için)
      let allMatchingDates = [];
      Object.keys(EXAM_META).forEach(bId => {
        let m = EXAM_META[bId];
        if(m.examType !== eT) return;
        if(!metaHasGrade(m, lvlF)) return;
        allMatchingDates.push(m.date);
      });
      allMatchingDates = [...new Set(allMatchingDates)].sort(srt);
      Object.keys(EXAM_META).forEach(bId => {
        let m = EXAM_META[bId];
        if(m.examType !== eT) return;
        if(!metaHasGrade(m, lvlF)) return;
        if(m.date === dt){ needed.push(bId); }
        else if(sub === 'summary'){
          let ci = allMatchingDates.indexOf(dt);
          let prevDate = ci > 0 ? allMatchingDates[ci-1] : null;
          if(prevDate && m.date === prevDate) needed.push(bId);
        }
      });
    }
  }

  if(needed.length > 0) await fetchBatches(needed); 
  rAnl();
  refreshAfterAnalysisRender();
}

async function reqUI() {
  const typeEl = getEl('aType');
  const currentType = typeEl ? typeEl.value : '';
  const previousType = typeEl ? (typeEl.dataset.lastType || '') : '';
  if(previousType && previousType !== currentType && typeof _resetSel === 'function'){
    ['aLvl','aBr','aEx','aDate','aExDate','aSub'].forEach(_resetSel);
    if(getEl('anlRes')) getEl('anlRes').innerHTML = '';
  }
  if(typeEl) typeEl.dataset.lastType = currentType;
  uUI();
  await reqAnl();
}

function normTR(s){return String(s||'').toLocaleLowerCase('tr-TR').replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ç/g,'c');}

function pN(v){
  let n = parseNumberStrict(v);
  return n === null ? 0 : n;
}

function parseNumberStrict(v){
  if(v === null || v === undefined) return null;
  // Türkçe: binlik ayraç nokta, ondalık ayraç virgül → 1.234,56 veya 12,5
  // İngilizce: 12.5 → doğrudan geçer
  let s = String(v).trim().replace(/\s+/g, '').replace(/\u00a0/g, '');
  if(!s) return null;
  // Hem nokta hem virgül varsa: son gelen ondalık ayraçtır
  let hasDot   = s.includes('.');
  let hasComma = s.includes(',');
  if(hasDot && hasComma){
    // 1.234,56 → Türkçe: noktaları kaldır, virgülü noktaya çevir
    if(s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g,'').replace(',','.');
    // 1,234.56 → İngilizce: virgülleri kaldır
    else s = s.replace(/,/g,'');
  } else if(hasComma){
    // 12,5 → ondalık virgül
    s = s.replace(',','.');
  }
  if(!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) return null;
  let n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseExamDate(value){
  let s = String(value || '').trim();
  let day, month, year;
  if(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.test(s)){
    let p = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    day = parseInt(p[1], 10); month = parseInt(p[2], 10); year = parseInt(p[3], 10);
  } else {
    let p = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if(!p) return null;
    year = parseInt(p[1], 10); month = parseInt(p[2], 10); day = parseInt(p[3], 10);
  }
  if(year < 1900 || year > 2100) return null;
  let d = new Date(year, month - 1, day);
  if(d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return {
    day,
    month,
    year,
    value: `${String(day).padStart(2,'0')}.${String(month).padStart(2,'0')}.${year}`
  };
}

function normalizeExamDate(value){
  let parsed = parseExamDate(value);
  return parsed ? parsed.value : '';
}

function getClassParts(cls){
  let raw = String(cls || '').trim();
  let m = raw.match(/^(\d+)\s*[-/.]?\s*([a-zA-ZğüşıöçĞÜŞİÖÇ]+)$/);
  if(m) return { grade:m[1], branch:m[2].toLocaleUpperCase('tr-TR') };
  let gradeOnly = raw.match(/^(\d+)/);
  return { grade: gradeOnly ? gradeOnly[1] : '', branch: '' };
}

function normalizeClassName(cls){
  let raw = String(cls || '').trim().replace(/\s+/g, ' ');
  let parts = getClassParts(raw);
  return parts.grade && parts.branch ? `${parts.grade}${parts.branch}` : raw.toLocaleUpperCase('tr-TR');
}

function srt(a,b){
  // === FIX: Tarihler her zaman GG.AA.YYYY -> Date olarak karşılaştırılır (string sıralama yok) ===
  let parseDate = (dStr) => {
    if(!dStr) return new Date(0);
    let parsed = parseExamDate(dStr);
    if(parsed) return new Date(parsed.year, parsed.month - 1, parsed.day);
    let d = new Date(String(dStr).trim()); return isNaN(d.getTime()) ? new Date(0) : d;
  };
  return parseDate(a) - parseDate(b);
}

function linRegSlope(values){
  let arr = (values||[]).filter(v => v !== null && v !== undefined && !isNaN(v)).map(Number);
  let n = arr.length; if(n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for(let i = 0; i < n; i++){ sumX += i; sumY += arr[i]; sumXY += i*arr[i]; sumXX += i*i; }
  let denom = (n*sumXX - sumX*sumX); if(denom === 0) return 0;
  return (n*sumXY - sumX*sumY) / denom;
}

// ---- linRegR2: Regresyonun açıklayıcılığı (0=gürültü, 1=mükemmel trend) ----
function linRegR2(values){
  let arr = (values||[]).filter(v => v !== null && v !== undefined && !isNaN(v)).map(Number);
  let n = arr.length; if(n < 2) return 0;
  let meanY = arr.reduce((a,b)=>a+b,0)/n;
  let slope = linRegSlope(arr);
  // intercept
  let sumX = (n*(n-1))/2;
  let intercept = meanY - slope*(sumX/n);
  let ssTot = arr.reduce((a,v)=>a+Math.pow(v-meanY,2),0);
  if(ssTot===0) return 1;
  let ssRes = arr.reduce((a,v,i)=>a+Math.pow(v-(intercept+slope*i),2),0);
  return Math.max(0, Math.min(1, 1 - ssRes/ssTot));
}

// ---- linRegRMSE: Regresyon doğrusundan kalıntıların RMSE'si (Standart Hata) ----
// "Sürpriz Payı": öğrencinin sınav sonucu, trend doğrusunun tahmininden ortalama
// olarak ne kadar sapıyor? Düşük = trend güvenilir, yüksek = sürpriz dolu.
// İstatistiksel olarak: sqrt(SSres / (n-2)). En az 3 veri gerekir.
function linRegRMSE(values){
  let arr = (values||[]).filter(v => v !== null && v !== undefined && !isNaN(v)).map(Number);
  let n = arr.length; if(n < 3) return null;
  let meanY = arr.reduce((a,b)=>a+b,0)/n;
  let slope = linRegSlope(arr);
  let sumX = (n*(n-1))/2;
  let intercept = meanY - slope*(sumX/n);
  let ssRes = arr.reduce((a,v,i)=>a+Math.pow(v-(intercept+slope*i),2),0);
  // n-2: regresyon iki parametre (slope + intercept) tahmin ettiği için serbestlik derecesi
  return Math.sqrt(ssRes / (n - 2));
}

// ---- ewma: Üstel Ağırlıklı Hareketli Ortalama (son windowSize sınav baz alınır) ----
// alpha: düzeltme faktörü (varsayılan 0.5 — son sınavın ağırlığı daha yüksek)
function ewma(values, windowSize, alpha){
  let arr = (values||[]).filter(v => v !== null && v !== undefined && !isNaN(v)).map(Number);
  if(!arr.length) return null;
  alpha = (alpha !== null && alpha !== undefined) ? alpha : 0.5;
  windowSize = windowSize || 3;
  // Son windowSize sınava kısıtla
  let window_ = arr.slice(-windowSize);
  let result = window_[0];
  for(let i = 1; i < window_.length; i++){
    result = alpha * window_[i] + (1 - alpha) * result;
  }
  return result;
}

// ---- calcZScore: Bir değerin popülasyon içindeki z-skorunu hesapla ----
// ÖNEMLI — std seçimi:
//   Burada PAYDAsi n olan POPÜLASYON standart sapması kullanılır.
//   Çünkü elimizdeki grup (sınıf, kurum) zaten tüm popülasyonu temsil eder;
//   başka bir evrene genelleme yapmıyoruz.
//   app-analysis.js'teki _statStd ise (n-1) paydası kullanan ÖRNEKLEM std'dir —
//   o fonksiyon bir örneklemden evrene tahmin yapar (CV, dağılım kartları vb.).
//   İki fonksiyon kasıtlı olarak farklı; birini diğeriyle değiştirme.
function calcZScore(value, population){
  let arr = (population||[]).filter(v => v !== null && v !== undefined && !isNaN(v)).map(Number);
  let n = arr.length; if(n < 2) return 0;
  let mean = arr.reduce((a,b)=>a+b,0)/n;
  let variance = arr.reduce((a,v)=>a+Math.pow(v-mean,2),0)/n;
  let std = Math.sqrt(variance);
  if(std===0) return 0;
  return (value - mean) / std;
}

// ---- escapeHtml: XSS koruması için HTML özel karakterleri kaçış ----
function escapeHtml(str){
  if(str===null||str===undefined) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#x27;')
    .replace(/\//g,'&#x2F;');
}

function jsArg(value){
  return escapeHtml(JSON.stringify(String(value ?? '')));
}

function optionHtml(value, label, selected = false, disabled = false){
  return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}>${escapeHtml(label)}</option>`;
}

function safeFileName(value, fallback = 'rapor'){
  let s = String(value || fallback).trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
  return (s || fallback).slice(0, 120);
}

// ---- buildStuMap: O(1) öğrenci araması için Map index ----
// DB.s değiştiğinde (yeni dizi atandığında ya da _stuMapCache=null yapıldığında) yeniden kurulur
let _stuMapCache = null;
function getStuMap(){
  // Önbellek DB.s dizisinin kimliği ve uzunluğuyla doğrulanır (DB.s her değişimde yeni dizi olarak atanıyor;
  // eski sürümdeki her çağrıda tüm öğrenci listesini birleştiren imza hesabı döngü içinde çok pahalıydı).
  const src = DB.s || [];
  if(_stuMapCache && _stuMapCache._src === src && _stuMapCache._len === src.length) return _stuMapCache._map;
  _stuMapCache = { _map: new Map(src.map(s=>[s.no, s])), _src: src, _len: src.length };
  return _stuMapCache._map;
}
