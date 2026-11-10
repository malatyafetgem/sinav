// app-analysis.js — Risk scoring, box plots, karne, rH, rAnl, rapor

let _riskCache = null;

const RISK_SEV_W = { high: 3, med: 2, low: 1 };

// ============================================================
// ORTAK İSTATİSTİK YARDIMCI FONKSİYONLARI (yeni)
// Her sayfada tutarlı şekilde kullanılır. Pedagojik/bilimsel
// olarak hangi sayfada ne anlamlı: bkz. CHANGES.md kart matrisi.
// ============================================================

/**
 * Aritmetik ortalama. Boş diziye 0 döner.
 */
function _statMean(arr){
  if(!arr || !arr.length) return 0;
  return arr.reduce((a,b)=>a+b,0) / arr.length;
}

/**
 * Örneklem standart sapması (n-1 paydası).
 * En az 2 değer gerekir, aksi halde null.
 *
 * ÖNEMLI — std seçimi:
 *   Burada PAYDAsi (n-1) olan ÖRNEKLEM standart sapması kullanılır.
 *   CV, dağılım ve homojenlik kartları için bir örneklemden evrene tahmin yapılır.
 *   app-core.js'teki calcZScore ise n paydası kullanan POPÜLASYON std'dir —
 *   o fonksiyon elimizdeki grubun tamamına (sınıf/kurum) z-skoru hesaplar.
 *   İki fonksiyon kasıtlı olarak farklı; birini diğeriyle değiştirme.
 */
function _statStd(arr){
  if(!arr || arr.length < 2) return null;
  let m = _statMean(arr);
  let v = arr.reduce((a,x)=>a+Math.pow(x-m,2),0) / (arr.length - 1);
  return Math.sqrt(v);
}

/**
 * Medyan. Boş diziye null.
 */
function _statMedian(arr){
  if(!arr || !arr.length) return null;
  let s =[...arr].sort((a,b)=>a-b);
  let n = s.length, mid = Math.floor(n/2);
  return n % 2 === 1 ? s[mid] : (s[mid-1] + s[mid]) / 2;
}

/**
 * Çeyrekler (Q1, Q3) ve IQR (Q3-Q1).
 * Tukey yöntemi (linear interpolation). En az 4 veri tavsiye edilir.
 */
function _statQuartiles(arr){
  if(!arr || arr.length < 2) return { q1: null, q3: null, iqr: null };
  let s =[...arr].sort((a,b)=>a-b);
  let pct = (p) => {
    let pos = (s.length - 1) * p;
    let lo = Math.floor(pos), hi = Math.ceil(pos);
    if(lo === hi) return s[lo];
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  };
  let q1 = pct(0.25), q3 = pct(0.75);
  return { q1, q3, iqr: q3 - q1 };
}

/**
 * Etki büyüklüğü — iki bağımsız grup arasındaki standartlaştırılmış ortalama fark.
 * Birleşik (pooled) standart sapma kullanılır ve küçük örneklem yanlılığı Hedges düzeltmesiyle giderilir (Hedges g = d · J,
 * J = 1 − 3 / (4·(nA+nB−2) − 1)). Büyük gruplarda g ≈ Cohen d'dir. Yorum: ≈0.2 küçük, 0.5 orta, ≥0.8 büyük etki.
 * (Fonksiyon adı geriye dönük uyumluluk için _statCohenD olarak korunmuştur.)
 */
function _statCohenD(a, b){
  if(!a || !b || a.length < 2 || b.length < 2) return null;
  let mA = _statMean(a), mB = _statMean(b);
  let sA = _statStd(a), sB = _statStd(b);
  if(sA === null || sB === null) return null;
  let nA = a.length, nB = b.length;
  let pooled = Math.sqrt(((nA-1)*sA*sA + (nB-1)*sB*sB) / (nA + nB - 2));
  if(pooled === 0) return null;
  const J = 1 - 3 / (4 * (nA + nB - 2) - 1);
  return ((mA - mB) / pooled) * J;
}

/**
 * Etki büyüklüğü (Hedges g / Cohen d) için sözel etiket (TR).
 */
function _cohenLabel(d){
  if(d === null || d === undefined || isNaN(d)) return '—';
  let abs = Math.abs(d);
  if(abs < 0.2) return 'İhmal edilebilir';
  if(abs < 0.5) return 'Küçük';
  if(abs < 0.8) return 'Orta';
  return 'Büyük';
}

/**
 * Değişim katsayısı CV% — std/ortalama * 100.
 * Tutarlılık/homojenlik göstergesi olarak kullanılır.
 * <10 çok tutarlı, 10–20 tutarlı, 20–35 dalgalı, >35 çok dalgalı.
 */
function _statCV(arr){
  if(!arr || arr.length < 2) return null;
  let m = _statMean(arr); if(m === 0) return null;
  let sd = _statStd(arr); if(sd === null) return null;
  return (sd / Math.abs(m)) * 100;
}

// Sürpriz Payı etiketi — RMSE (regresyon kalıntılarının standart hatası) bazlı.
// RMSE düşükse trend tahmini güvenilir → sürpriz az; RMSE yüksekse sınavlar trendden
// büyük sapma gösteriyor → sürpriz yüksek.
// scaleSd verilirse etiket ölçekten bağımsızdır: RMSE, aynı sınavlardaki öğrenciler arası (sınav içi) standart sapmaya oranlanır
// (soru sayısı/puan ölçeği farklı sınavlarda aynı eşik anlamlı kalır). Eşikler sezgiseldir, kesin bilimsel sınır değildir.
function _surpriseLabel(rmse, scaleSd){
  if(rmse === null || rmse === undefined || isNaN(rmse)) return '—';
  if(scaleSd && scaleSd > 0){
    const ratio = rmse / scaleSd;
    if(ratio < 0.25) return 'Çok Düşük';
    if(ratio < 0.50) return 'Düşük';
    if(ratio < 0.75) return 'Orta';
    return 'Yüksek';
  }
  if(rmse < 4)   return 'Çok Düşük';
  if(rmse < 8)   return 'Düşük';
  if(rmse < 14)  return 'Orta';
  return 'Yüksek';
}
// Katılım oranı: (uygun öğrenci × sınav) çiftleri üzerinden. Uygun öğrenciler seçilen seviye/şubeye göre, sınavlar EXAM_META'dan
// (tür; isteğe bağlı tarih ve ders; her sınavın ilgili seviyeleri) gelir. "Katıldı" = o sınavda devamsız olmayan kaydı olması
// (ders verilmişse o dersin neti de olmalı). Daha önce analiz ekranlarında dört yerde kopyalanmıştı.
// looseClass: genel özetteki eski davranış (sınıf adı kalıba uymayan öğrenciler seviye/şube filtresinde elenmez).
function _calcParticipation({ examType, lvl = '', br = '', date = '', subject = '', looseClass = false }){
  const full = /^(\d+)([a-zA-ZğüşıöçĞÜŞİÖÇ]+)$/;
  const eligible = DB.s.filter(s => {
    if(looseClass){
      const m = s.class.match(/^(\d+)/);
      if(lvl && m && m[1] !== lvl) return false;
      if(br){ const mm = s.class.match(full); if(mm && mm[2].toLocaleUpperCase('tr-TR') !== br) return false; }
      return true;
    }
    const m = s.class.match(full);
    if(!m) return false;
    if(lvl && m[1] !== lvl) return false;
    if(br && m[2].toLocaleUpperCase('tr-TR') !== br) return false;
    return true;
  });
  const subjLower = subject ? subject.toLocaleLowerCase('tr-TR') : '';
  const subjTitle = subject ? toTitleCase(subject) : '';
  const examGradeMap = {};
  Object.values(EXAM_META).forEach(m => {
    if(m.examType !== examType) return;
    if(date && m.date !== date) return;
    if(subject && (!m.subjects || !m.subjects.map(x => x.toLocaleLowerCase('tr-TR')).includes(subjLower))) return;
    const key = m.date + '||' + (m.publisher || '');
    if(!examGradeMap[key]) examGradeMap[key] = { grades: new Set() };
    const gs = metaGrades(m).length ? metaGrades(m) : ['*'];
    gs.forEach(g => examGradeMap[key].grades.add(g));
  });
  const attendedSetByStu = {};
  DB.e.forEach(e => {
    if(e.examType !== examType || e.abs) return;
    if(date && e.date !== date) return;
    if(subject && (!e.subs || !e.subs[subjTitle])) return;
    const k = e.date + '||' + (e.publisher || '');
    if(!attendedSetByStu[e.studentNo]) attendedSetByStu[e.studentNo] = new Set();
    attendedSetByStu[e.studentNo].add(k);
  });
  let baseCount = 0, attendedCount = 0;
  eligible.forEach(stu => {
    const g = getGrade(stu.class);
    const att = attendedSetByStu[stu.no] || new Set();
    Object.entries(examGradeMap).forEach(([key, info]) => {
      if(!(info.grades.has('*') || info.grades.has(g))) return;
      baseCount++;
      if(att.has(key)) attendedCount++;
    });
  });
  const rate = baseCount > 0 ? Math.max(0, Math.min(100, Math.round((attendedCount / baseCount) * 100))) : 0;
  return { baseCount, attendedCount, rate };
}

// Ders bazlı metrikte (sb='s_...') dersi içermeyen kayıtlar 0 net sayılmasın: ders bazlı olmayan metriklerde her kayıt geçerlidir
function _hasMetric(x, sb){
  if(!sb || sb.indexOf('s_') !== 0) return true;
  const k = toTitleCase(sb.replace('s_', ''));
  return !!(x.subs && x.subs[k]);
}
// Öğrenci başına ortalama değerler (öğrencinin birden çok sınavdaki kayıtları tek gözleme indirgenir)
function _perStudentMeans(rows, getVal){
  const m = {};
  rows.forEach(x => {
    const v = getVal(x); if(v === null || v === undefined || !isFinite(v)) return;
    const s = m[x.studentNo] || (m[x.studentNo] = { sum: 0, n: 0 });
    s.sum += Number(v); s.n++;
  });
  return Object.keys(m).map(k => m[k].sum / m[k].n);
}
// Aynı sınavdaki öğrenciler arası (sınav içi) birleşik standart sapma — sınavlar arası zorluk farkını içermez
function _pooledWithinExamSd(rows, getVal){
  const g = {};
  rows.forEach(e => {
    const v = getVal(e); if(v === null || v === undefined || !isFinite(v)) return;
    const k = e.date + '||' + (e.publisher || '');
    (g[k] = g[k] || []).push(Number(v));
  });
  let ss = 0, df = 0;
  Object.values(g).forEach(arr => {
    if(arr.length < 3) return;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    ss += arr.reduce((a, v) => a + (v - m) * (v - m), 0); df += arr.length - 1;
  });
  return df > 0 ? Math.sqrt(ss / df) : null;
}
// IQR / medyan oranına göre dağılım etiketi (iki ekranda tekrarlanan blok tek yerde). Eşikler sezgiseldir, kesin bilimsel sınır değildir.
function _iqrSpreadInfo(iqr, med){
  if(iqr === null || iqr === undefined || !med) return { color: '#6c757d', label: '—' };
  const r = iqr / Math.abs(med);
  if(r < 0.20) return { color: '#28a745', label: 'Homojen / Dengeli' };
  if(r < 0.30) return { color: '#ffc107', label: 'Orta düzeyde dağılım' };
  if(r < 0.40) return { color: '#fd7e14', label: 'Seviye farkı belirgin' };
  return { color: '#dc3545', label: 'Seviye farkı çok yüksek' };
}
// Eşit değerli kayıtlara aynı sırayı veren (1-2-2-4) sıralama; sorted dizi azalan düzende, key aynı değerleri belirler
function _rankSorted(sorted, keyFn){
  const out = [];
  let rank = 0, prevKey = null;
  sorted.forEach((x, i) => { const k = keyFn(x); if(i === 0 || k !== prevKey) rank = i + 1; prevKey = k; out.push(rank); });
  return out;
}
function _homogeneityLabel(cv){
  if(cv === null) return '—';
  if(cv < 10)  return 'Çok homojen';
  if(cv < 20)  return 'Homojen';
  if(cv < 35)  return 'Heterojen';
  return 'Çok heterojen';
}

function _statTone(cls){
  if(!cls) return '';
  if(String(cls).indexOf('sec-pos') >= 0) return 'stat-pos';
  if(String(cls).indexOf('sec-neg') >= 0) return 'stat-neg';
  return 'stat-neutral';
}

function _statItem(label, valueHtml, subHtml, explainText, toneClass){
  let cls = toneClass ? ` ${toneClass}` : '';
  // explainText artık satır içinde gösterilmiyor; aynı bilgi info popup içinde yer alıyor.
  return `<div class="stats-item${cls}">
    <div class="stats-label">${escapeHtml(label)}</div>
    <div class="stats-value">${valueHtml}</div>
    ${subHtml ? `<div class="stats-sub">${subHtml}</div>` : ''}
  </div>`;
}

function _trendStatItem(label, valueHtml, subHtml, titleText, toneClass){
  let cls = toneClass ? ` ${toneClass}` : '';
  let title = titleText ? ` title="${escapeHtml(titleText)}"` : '';
  return `<div class="trend-stat-item${cls}"${title}>
    <div class="trend-stat-value">${valueHtml}</div>
    <div class="trend-stat-label">${escapeHtml(label)}</div>
    ${subHtml ? `<div class="trend-stat-sub">${subHtml}</div>` : ''}
  </div>`;
}

function _trendStatBlock(items){
  let visible = (items || []).filter(Boolean);
  if(!visible.length) return '';
  return `<div class="trend-card trend-stat-card mb-3"><div class="trend-stat-grid">${visible.join('')}</div></div>`;
}

function _statsRow(items){
  let visible = (items || []).filter(Boolean);
  if(!visible.length) return '';
  return `<div class="stats-row">${visible.join('')}</div>`;
}

function _statsInline(items){
  let row = _statsRow(items);
  return row ? `<div class="stats-inline-row">${row}</div>` : '';
}

function _appendStatsToTrend(trendHtml, items){
  let visible = (items || []).filter(Boolean);
  if(!visible.length) return trendHtml || '';
  if(!trendHtml) return _trendStatBlock(visible);
  if(String(trendHtml).indexOf('trend-stat-grid') >= 0) {
    let marker = '</div></div>';
    let idx = trendHtml.lastIndexOf(marker);
    if(idx >= 0) return trendHtml.slice(0, idx) + visible.join('') + trendHtml.slice(idx);
  }
  let inline = _statsInline(visible);
  let idx = trendHtml.lastIndexOf('</div>');
  return idx >= 0 ? (trendHtml.slice(0, idx) + inline + trendHtml.slice(idx)) : (trendHtml + inline);
}

function _statsBlock(title, items, icon){
  let row = _statsRow(items);
  return row ? `<div class="trend-card stats-block">${row}</div>` : '';
}

// Trend kartı için minimum sınav sayısı (regresyonun anlamlı olması için).
const _TREND_MIN_N = 3;

// Trend anlamlılığı: regresyon eğiminin t-testi (H0: eğim = 0, df = n-2, iki yönlü).
// Eski "adaptif R² eşiği" az veride eşiği DÜŞÜRÜYORDU; oysa az veride R² çok oynaktır ve rastgele verilerde bile yüksek çıkabilir
// (örn. n=4'te anlamlı sayılmak için R² ≳ 0.81, n=6'da ≳ 0.53 gerekir). Karar artık p-değerine göredir.
const _TREND_ALPHA = 0.10;        // anlamlılık düzeyi
const _TREND_SIG_MIN_N = 4;
const _PROGRESS_MIN_N = 4;        // "en çok ilerleyen/gerileyen" seçiminde öğrenci başına en az sınav sayısı       // anlamlılık iddiası için en az gözlem (n=3'te df=1: p≤.10 için R²≥.976 gerekir, pratikte anlamsız)

// Lanczos yaklaşımıyla ln Γ(x)
function _lgamma(xx){
  const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = xx, tmp = xx + 5.5;
  tmp -= (xx + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for(let j = 0; j < 6; j++){ y += 1; ser += cof[j] / y; }
  return -tmp + Math.log(2.5066282746310005 * ser / xx);
}
// Düzenlenmiş tamamlanmamış beta fonksiyonu I_x(a,b) (Lentz sürekli kesri)
function _betacf(a, b, x){
  const MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300;
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
  if(Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d; let h = d;
  for(let m = 1; m <= MAXIT; m++){
    let m2 = 2 * m, aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if(Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if(Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if(Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if(Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; let del = d * c; h *= del;
    if(Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function _betai(a, b, x){
  if(x <= 0) return 0;
  if(x >= 1) return 1;
  let bt = Math.exp(_lgamma(a + b) - _lgamma(a) - _lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * _betacf(a, b, x) / a : 1 - bt * _betacf(b, a, 1 - x) / b;
}
// Student t dağılımı, iki yönlü p-değeri
function _tTwoSidedP(t, df){
  if(!isFinite(t)) return 0;
  return _betai(df / 2, 0.5, df / (df + t * t));
}
// Doğrusal trend uyumu: eğim, R², p-değeri ve "anlamlı mı" kararı
function _trendFit(values){
  const v = (values || []).filter(x => x !== null && x !== undefined && isFinite(x)).map(Number);
  const n = v.length;
  if(n < 2) return { n, slope: 0, r2: 0, p: null, significant: false };
  if(v.every(x => x === v[0])) return { n, slope: 0, r2: 0, p: n >= 3 ? 1 : null, significant: false }; // sabit seri: trend yok
  const slope = linRegSlope(v), r2 = linRegR2(v);
  if(n < 3) return { n, slope, r2, p: null, significant: false };
  let p;
  if(r2 >= 1 - 1e-12) p = 0;
  else p = _tTwoSidedP(Math.sqrt(r2 * (n - 2) / (1 - r2)), n - 2);
  return { n, slope, r2, p, significant: n >= _TREND_SIG_MIN_N && p <= _TREND_ALPHA };
}
function _fmtP(p){ return p === null || p === undefined ? '' : (p < 0.01 ? 'p<0.01' : 'p=' + p.toFixed(2)); }

function _sampleConfidence(n){
  if(n >= 10) return { cls:'confidence-high', label:'Güven yüksek', note:'Örneklem güçlü' };
  if(n >= 5) return { cls:'confidence-med', label:'Güven orta', note:'Dikkatli yorum' };
  if(n >= 3) return { cls:'confidence-low', label:'Güven düşük', note:'Az veri' };
  return { cls:'confidence-low', label:'Yetersiz veri', note:'Trend kurulmaz' };
}

// ============================================================
// ORTAK YARDIMCILAR SONU
// ============================================================


function calcRiskScores() {
  if(!DB.e.length || !DB.s.length) return[];

  // O(1) öğrenci araması — O(N²) find() döngüsü yerine Map kullan
  const stuMap = getStuMap();
  let gradeOf = (no) => { let st = stuMap.get(no); return st ? (String(st.class||'').match(/^(\d+)/)?.[1] || '') : ''; };

  // 1. Popülasyon İstatistikleri (SınavTürü + SınıfSeviyesi + Tarih bazlı)
  // Z-skoru hesabı için her gruba ait tüm net dizisini tut
  let popStats = {};
  DB.e.forEach(x => {
    if(x.abs) return;
    let gr = gradeOf(x.studentNo);
    if(!gr) return;
    let key = x.examType + '||' + gr + '||' + x.date;
    if(!popStats[key]) popStats[key] = { totalNets:[], subjs: {}, stus: 0 };
    popStats[key].totalNets.push(x.totalNet);
    popStats[key].stus++;
    if(x.subs) {
      Object.keys(x.subs).forEach(s => {
        if(!popStats[key].subjs[s]) popStats[key].subjs[s] = [];
        popStats[key].subjs[s].push(x.subs[s].net);
      });
    }
  });

  let getAvg = (arr) => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
  let getStd = (arr, mean) => {
    if(arr.length < 2) return 0;
    let v = arr.reduce((a,x)=>a+Math.pow(x-mean,2),0)/arr.length;
    return Math.sqrt(v);
  };

  let popAvgs = {};
  Object.keys(popStats).forEach(k => {
    let p = popStats[k];
    let mean = getAvg(p.totalNets);
    let std  = getStd(p.totalNets, mean);
    popAvgs[k] = {
      totalNet: mean, totalStd: std, totalNets: p.totalNets,
      subjs: Object.fromEntries(Object.entries(p.subjs).map(([s, arr]) => {
        let sm = getAvg(arr); return[s, { avg: sm, std: getStd(arr, sm), vals: arr }];
      }))
    };
  });

  // 2. Devamsızlık hesabı için (SınavTürü + SınıfSeviyesi) sınav tarihleri
  let examDatesByGroup = {};
  DB.e.forEach(x => {
    let gr = gradeOf(x.studentNo);
    if(!gr) return;
    let key = x.examType + '||' + gr;
    if(!examDatesByGroup[key]) examDatesByGroup[key] = new Set();
    examDatesByGroup[key].add(x.date);
  });

  // 3. Öğrencilerin sınavlarını grupla
  let stuGroups = {};
  DB.e.forEach(x => {
    if(!stuGroups[x.studentNo]) stuGroups[x.studentNo] = {};
    if(!stuGroups[x.studentNo][x.examType]) stuGroups[x.studentNo][x.examType] = [];
    stuGroups[x.studentNo][x.examType].push(x);
  });

  let riskEntries =[];

  // 4. Rubrik Bazlı Hesaplama
  Object.entries(stuGroups).forEach(([no, types]) => {
    // O(1) Map araması
    let stu = stuMap.get(no);
    if(!stu) return;
    let gr = gradeOf(no);
    if(!gr) return;

    Object.entries(types).forEach(([eType, exams]) => {
      let typeScore = 0;
      let flags =[];

      exams.sort((a,b) => srt(a.date, b.date));

      let attended = exams.filter(x => !x.abs); // yalnızca katıldığı sınavlar

      let allDatesForGroup = [...(examDatesByGroup[eType + '||' + gr] ||[])].sort(srt);
      let totalHeld = allDatesForGroup.length;

      // A) KATILIM / DEVAMSIZLIK RİSKİ (Maks 30 Puan)
      if(totalHeld >= 2) {
        let attRate = totalHeld > 0 ? attended.length / totalHeld : 1;
        let last2Dates = allDatesForGroup.slice(-2);
        let attendedLast2 = attended.filter(x => last2Dates.includes(x.date)).length;

        if(attRate < 0.50 || attendedLast2 === 0) {
          flags.push({ type:'abs', severity:'high', examType:eType, detail:`${eType}: Katılım çok düşük (%${Math.round(attRate*100)}) veya son 2 sınava girmedi.`, z: 30 });
          typeScore += 30;
        } else if(attRate <= 0.75) {
          flags.push({ type:'abs', severity:'med', examType:eType, detail:`${eType}: Katılım oranı düşük (%${Math.round(attRate*100)}).`, z: 15 });
          typeScore += 15;
        }
      }

      // B ve C için en az 2 sınav gerekli
      if(attended.length >= 2) {
        // Öğrencinin HER sınavdaki göreli konumu (sınav içi z-skoru): sınavlar arası zorluk farkı ortadan kalkar.
        // (Ham net serisinin EWMA'sını son sınavın ham dağılımıyla kıyaslamak, düzleştirilmiş değeri düzleştirilmemiş dağılımla
        //  karşılaştırdığı için tutarsızdı.)
        let zSeries = [];
        attended.forEach(x => {
          let a = popAvgs[eType + '||' + gr + '||' + x.date];
          if(a && a.totalNets.length >= 3) zSeries.push(calcZScore(x.totalNet, a.totalNets));
        });
        let ewmaZ = ewma(zSeries, 3, 0.5); // son 3 sınavın göreli konumunun EWMA'sı

        // Trend güvenilirliği: göreli konumdaki DÜŞÜŞ eğiliminin istatistiksel anlamlılığı (eğim t-testi, p≤.10, en az 4 sınav).
        let zFit = _trendFit(zSeries);
        let trendReliable = zFit.significant && zFit.slope < 0;

        let lastEx = attended[attended.length - 1];
        let prevEx = attended[attended.length - 2];

        // B) SIRALAMA GERİLEMESİ — EWMA bazlı + R² güvenilirlik filtresi (Maks 40 Puan)
        let lastPct = (parseFloat(lastEx.iR) / parseFloat(lastEx.iP)) || null;
        let prevPct = (parseFloat(prevEx.iR) / parseFloat(prevEx.iP)) || null;

        if(lastPct !== null && prevPct !== null) {
          let delta = lastPct - prevPct;
          if(!trendReliable && delta >= 0.08 && delta < 0.20) {
            // Gürültülü trend — düşük R² ile sadece low severity
            flags.push({ type:'rank', severity:'low', examType:eType, detail:`${eType}: Sıralama geriledi ancak sonuçlar dalgalı — kesin bir düşüş trendi yok.`, z: 10 });
            typeScore += 10;
          } else if(delta >= 0.15) {
            flags.push({ type:'rank', severity:'high', examType:eType, detail:`${eType}: Kurum sıralamasında belirgin düşüş — son iki sınavta %${Math.round(delta*100)} geriledi.`, z: 40 });
            typeScore += 40;
          } else if(delta >= 0.08) {
            flags.push({ type:'rank', severity:'med', examType:eType, detail:`${eType}: Kurum sıralamasında gerileme — son iki sınavta %${Math.round(delta*100)} geriledi.`, z: 20 });
            typeScore += 20;
          }
        }

        // C) NORMALİZE NET DÜŞÜŞÜ — Z-Skoru + EWMA (Maks 30 Puan)
        let pKeyLast = eType + '||' + gr + '||' + lastEx.date;
        let aLast = popAvgs[pKeyLast];

        if(aLast && aLast.totalNets.length >= 3) {
          // Öğrencinin son dönemdeki göreli konumu (sınav içi z-skorlarının EWMA'sı)
          let stuZ = ewmaZ !== null ? ewmaZ : calcZScore(lastEx.totalNet, aLast.totalNets);

          let dropScore = 0;
          if(stuZ <= -2.0) {
            // 2 standart sapma altı = ciddi düşüş
            flags.push({ type:'trend', severity:'high', examType:eType, detail:`${eType}: Son dönem net ortalaması sınıf genelinin çok altında.`, z: 30 });
            dropScore = 30;
          } else if(stuZ <= -1.2) {
            flags.push({ type:'trend', severity:'med', examType:eType, detail:`${eType}: Son dönem net ortalaması sınıf genelinin altında.`, z: 15 });
            dropScore = 15;
          } else if(stuZ <= -0.7 && trendReliable) {
            // Sadece güvenilir trend varsa düşük uyarı
            flags.push({ type:'trend', severity:'low', examType:eType, detail:`${eType}: Hafif düşüş eğilimi — son sınavlarda net ortalaması düşüyor.`, z: 8 });
            dropScore = 8;
          }

          // Ders bazlı Z-skoru kontrolü (toplam düşüş yoksa ders bazlı bak)
          if(dropScore < 30 && lastEx.subs && aLast.subjs) {
            let droppedSubjs =[];
            let maxSubjSeverity = null;
            Object.keys(lastEx.subs).forEach(s => {
              let pSub = aLast.subjs[s];
              if(!pSub || !pSub.vals || pSub.vals.length < 3) return;
              let subjZ = calcZScore(lastEx.subs[s].net, pSub.vals);
              if(subjZ <= -2.0) { droppedSubjs.push(toTitleCase(s)); maxSubjSeverity = 'high'; }
              else if(subjZ <= -1.2 && maxSubjSeverity !== 'high') { droppedSubjs.push(toTitleCase(s)); maxSubjSeverity = maxSubjSeverity || 'med'; }
            });
            if(droppedSubjs.length > 0) {
              let sPts = maxSubjSeverity === 'high' ? 30 : 15;
              flags.push({ type:'subj', severity:maxSubjSeverity, examType:eType, detail:`${eType} — Sınıf ortalamasının belirgin altında kalan dersler: ${droppedSubjs.join(', ')}`, z: sPts });
              dropScore += sPts;
            }
          }
          typeScore += Math.min(dropScore, 30);

        } else {
          // Popülasyon küçükse eski normalize yönteme geri dön (güvenli fallback)
          let pKeyPrev = eType + '||' + gr + '||' + prevEx.date;
          let aPrev = popAvgs[pKeyPrev];
          if(aLast && aPrev) {
            let dropScore = 0;
            let checkDrop = (valL, avgL, valP, avgP) => {
              if(!avgL || !avgP) return 0;
              return (valP / avgP) - (valL / avgL);
            };
            let totalDrop = checkDrop(lastEx.totalNet, aLast.totalNet, prevEx.totalNet, aPrev.totalNet);
            if(totalDrop >= 0.20) {
              flags.push({ type:'trend', severity:'high', examType:eType, detail:`${eType}: Genel netlerde ortalamaya göre ciddi düşüş.`, z: 30 });
              dropScore += 30;
            } else if(totalDrop >= 0.10) {
              flags.push({ type:'trend', severity:'med', examType:eType, detail:`${eType}: Genel netlerde ortalamaya göre düşüş.`, z: 15 });
              dropScore += 15;
            }
            if(dropScore < 30 && lastEx.subs && prevEx.subs && aPrev.subjs) {
              let droppedSubjs =[];
              let maxSubjSeverity = null;
              Object.keys(lastEx.subs).forEach(s => {
                let pSubLast = aLast.subjs[s], pSubPrev = aPrev.subjs[s];
                if(!pSubLast || !pSubPrev) return;
                let d = checkDrop(lastEx.subs[s].net, pSubLast.avg, prevEx.subs[s]?prevEx.subs[s].net:0, pSubPrev.avg);
                if(d >= 0.20) { droppedSubjs.push(toTitleCase(s)); maxSubjSeverity = 'high'; }
                else if(d >= 0.10 && maxSubjSeverity !== 'high') { droppedSubjs.push(toTitleCase(s)); maxSubjSeverity = maxSubjSeverity || 'med'; }
              });
              if(droppedSubjs.length > 0) {
                let sPts = maxSubjSeverity === 'high' ? 30 : 15;
                flags.push({ type:'subj', severity:maxSubjSeverity, examType:eType, detail:`${eType} Ders Düşüşü: ${droppedSubjs.join(', ')}`, z: sPts });
                dropScore += sPts;
              }
            }
            typeScore += Math.min(dropScore, 30);
          }
        }
      }

      if(typeScore > 0) {
        let topLevel = typeScore >= 70 ? 'high' : (typeScore >= 40 ? 'med' : 'low');
        let seenTypes = new Set();
        let uniqueFlags =[];
        flags.forEach(f => {
          let k = f.type + '|' + f.examType;
          if(!seenTypes.has(k)) { seenTypes.add(k); uniqueFlags.push(f); }
        });
        riskEntries.push({
          no: no,
          name: stu.name, // ham değer; görüntülerken escapeHtml uygulanır (çift kaçış olmasın)
          cls: stu.class,
          score: typeScore,
          level: topLevel,
          flags: uniqueFlags,
          examTypes: [eType]
        });
      }
    });
  });

  riskEntries.sort((a,b) => b.score - a.score);
  _riskCache = { ts: Date.now(), results: riskEntries };
  return riskEntries;
}

function renderRiskPanel() {
  let panelEl = getEl('riskPanel'); if(!panelEl) return;
  let risks = (_riskCache && _riskCache.results) ? _riskCache.results : calcRiskScores();
  // Veri yoksa içeriği temizle ama paneli gizleme (uUI yönetiyor)
  if(!risks.length) {
    let listEl2 = getEl('riskList'); if(listEl2) listEl2.innerHTML = '<div class="risk-empty"><i class="fas fa-info-circle me-2"></i>Henüz yeterli sınav verisi bulunmuyor.</div>';
    ['riskCardHigh','riskCardMed','riskCardLow','riskCardTotal'].forEach(id => { let el=getEl(id); if(el) el.textContent='0'; });
    let badge = getEl('riskTotalBadge'); if(badge) badge.textContent = '';
    return;
  }

  // Filtreler
  let exTypeRaw = (getEl('riskExTypeFilter')||{}).value || '';
  let gradeRaw  = (getEl('riskGradeFilter')||{}).value  || '';
  let branchRaw = (getEl('riskBranchFilter')||{}).value || '';
  let exTypeF = exTypeRaw === '__ALL__' ? '' : exTypeRaw;
  let gradeF  = gradeRaw === '__ALL__' ? '' : gradeRaw;
  let branchF = branchRaw === '__ALL__' ? '' : branchRaw;
  let levelF  = (getEl('riskLevelFilter')||{}).value  || '';

  // Sınıf adından şubeyi ayıkla (örn. "10-A" → branch:"A")
  function getBranchFromCls(cls) { let m = String(cls||'').match(/[A-Za-z]+$/); return m ? m[0].toUpperCase() : ''; }

  let filtered = risks.filter(r => {
    if(exTypeF && !r.examTypes.includes(exTypeF)) return false;
    if(gradeF  && getGrade(r.cls) !== gradeF) return false;
    if(branchF && getBranchFromCls(r.cls) !== branchF) return false;
    if(levelF  && r.level !== levelF) return false;
    return true;
  });

  // Özet kartlarını güncelle (filtreli sayılar)
  let hi = filtered.filter(r=>r.level==='high').length;
  let me = filtered.filter(r=>r.level==='med').length;
  let lo = filtered.filter(r=>r.level==='low').length;
  let tot = filtered.length;
  let cH=getEl('riskCardHigh'),cM=getEl('riskCardMed'),cL=getEl('riskCardLow'),cT=getEl('riskCardTotal');
  if(cH) cH.textContent = hi;
  if(cM) cM.textContent = me;
  if(cL) cL.textContent = lo;
  if(cT) cT.textContent = tot;

  // Badge toplam
  let badge = getEl('riskTotalBadge');
  if(badge) badge.textContent = tot + ' öğrenci riskte';

  // Uyarı kartları
  const levelIcon = { high:'fa-exclamation-circle', med:'fa-exclamation-triangle', low:'fa-info-circle' };
  const typeIcon  = { trend:'fa-chart-line', rank:'fa-sort-amount-up', subj:'fa-book', abs:'fa-calendar-times' };
  const typeLabel = { trend:'Düşüş Trendi', rank:'Sıra Gerileme', subj:'Ders Düşüşü', abs:'Devamsızlık' };

  let listEl = getEl('riskList');
  if(!filtered.length) {
    listEl.innerHTML = `<div class="risk-empty"><i class="fas fa-filter me-2"></i>Seçili filtreye uyan riskli öğrenci bulunamadı.</div>`;
    return;
  }

  // Benzersiz flag türlerini grupla (bir öğrenci için en kötü flag önce)
  let html = filtered.map(r => {
    // Her flag türünden en kötü birini göster (max 4 rozet)
    let seen = new Set();
    let topFlags = r.flags.filter(f => { let k=f.type+'|'+f.examType; if(seen.has(k)) return false; seen.add(k); return true; })
                          .sort((a,b) => RISK_SEV_W[b.severity]-RISK_SEV_W[a.severity]).slice(0,4);
    let badgesHtml = topFlags.map(f => {
      let safeTitle = escapeHtml(f.detail);
      let typeKey = (typeLabel[f.type] && typeIcon[f.type]) ? f.type : 'trend';
      return `<button type="button" class="risk-badge rb-${escapeHtml(typeKey)}" title="${safeTitle}" onclick="showToast(${jsArg(f.detail)}, 'warning', 4000)"><i class="fas ${typeIcon[typeKey]} risk-badge-icon"></i>${escapeHtml(typeLabel[typeKey])}</button>`;
    }).join('');
    return `<div class="risk-card risk-${r.level}" role="listitem">
      <div class="risk-avatar"><i class="fas ${levelIcon[r.level]}"></i></div>
      <div class="risk-body">
        <div class="risk-name">${escapeHtml(r.name)}</div>
        <div class="risk-class"><i class="fas fa-school me-1"></i>${escapeHtml(r.cls)} &nbsp;·&nbsp; ${r.examTypes.map(escapeHtml).join(', ')}</div>
        <div class="risk-badges">${badgesHtml}</div>
      </div>
      <div class="risk-score-badge">
        <span>${r.score.toFixed(1)}</span>
        <small>risk puanı</small>
      </div>
    </div>`;
  }).join('');
  listEl.innerHTML = html;
}

function setRiskLevel(level) {
  let el = getEl('riskLevelFilter');
  if(!el) return;
  // Boş string = tümünü göster; aynı seviyeye tıklamak toggle yapar
  if(level === '') { el.value = ''; }
  else { el.value = (el.value === level) ? '' : level; }
  renderRiskPanel();
  if(typeof applyExamColorToFilters === 'function') applyExamColorToFilters();
}

function calcBoxPlot(values) {
  // null/undefined önce filtrele, sonra sayıya çevir (Number(null)=0 tuzağından kaçın)
  let arr = (values||[]).filter(v => v !== null && v !== undefined).map(Number).filter(v => !isNaN(v)).sort((a,b) => a-b);
  if(arr.length === 0) return null;
  let n = arr.length;
  // Lineer interpolasyonlu quartile (numpy 'linear' yöntemi ile uyumlu)
  function quantile(sorted, p) {
    let idx = p * (sorted.length - 1);
    let lo = Math.floor(idx), hi = Math.ceil(idx), frac = idx - lo;
    if(lo === hi) return sorted[lo];
    return sorted[lo] * (1 - frac) + sorted[hi] * frac;
  }
  let q1 = quantile(arr, 0.25);
  let median = quantile(arr, 0.5);
  let q3 = quantile(arr, 0.75);
  let iqr = q3 - q1;
  let whiskerLo = Math.max(arr[0], q1 - 1.5 * iqr);
  let whiskerHi = Math.min(arr[n-1], q3 + 1.5 * iqr);
  let outliers = arr.filter(v => v < whiskerLo || v > whiskerHi);
  let mean = arr.reduce((a,b)=>a+b,0)/n;
  return { min: arr[0], max: arr[n-1], q1, median, q3, mean, whiskerLo, whiskerHi, outliers, n };
}

function mkBoxPlotSVG(groups, studentVal, options) {
  options = options || {};
  // Her grafikte benzersiz filtre kimliği (sayfada birden çok SVG olduğunda yinelenen id oluşmasın)
  const _glowId = 'stuGlow' + (window._bpUidSeq = (window._bpUidSeq || 0) + 1);
  let W = options.width || 520, H = options.height || 210;
  let marginLeft = 44, marginRight = 14, marginTop = 32, marginBottom = 44;
  let plotW = W - marginLeft - marginRight, plotH = H - marginTop - marginBottom;

  let stats = groups.map(g => ({ ...g, bp: calcBoxPlot(g.values) })).filter(g => g.bp);
  if(stats.length === 0) return '<div class="text-muted small text-center py-2">Kutu grafiği için yeterli veri yok.</div>';

  let allVals = stats.flatMap(g => g.bp ?[g.bp.min, g.bp.max, ...(g.bp.outliers||[])] :[]);
  if(studentVal !== null && studentVal !== undefined) allVals.push(studentVal);
  let yMin = Math.min(...allVals), yMax = Math.max(...allVals);
  let pad = (yMax - yMin) * 0.15 || 3;
  yMin = yMin - pad; yMax = yMax + pad;

  let toY = v => marginTop + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  // Arka plan bantları
  let bgBands = '';
  for(let i = 0; i < 5; i++) {
    let y1 = marginTop + (plotH / 5) * i;
    if(i % 2 === 1) bgBands += `<rect x="${marginLeft}" y="${y1.toFixed(1)}" width="${plotW}" height="${(plotH/5).toFixed(1)}" fill="rgba(0,0,0,0.018)"/>`;
  }

  // Grid + Y ekseni etiketleri
  let gridLines = '', gridLabels = '';
  let tickCount = 5;
  for(let i = 0; i <= tickCount; i++) {
    let v = yMin + (yMax - yMin) * (i / tickCount);
    let y = toY(v);
    gridLines += `<line x1="${marginLeft}" y1="${y.toFixed(1)}" x2="${W - marginRight}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>`;
    gridLabels += `<text x="${(marginLeft - 5).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="9" fill="#8898aa">${v.toFixed(1)}</text>`;
  }

  // Kutular
  let boxWidth = Math.min(56, plotW / (stats.length * 2.0));
  let spacing = plotW / (stats.length + 1);
  let boxes = '';

  stats.forEach((g, i) => {
    let bp = g.bp;
    let cx = marginLeft + spacing * (i + 1);
    let color = g.color || '#0d6efd';
    let yQ1 = toY(bp.q1), yQ3 = toY(bp.q3), yMed = toY(bp.median);
    let yWLo = toY(bp.whiskerLo), yWHi = toY(bp.whiskerHi), yMean = toY(bp.mean);
    let bx = cx - boxWidth / 2;
    let boxH = Math.abs(yQ1 - yQ3);

    // Bıyık gövdesi
    boxes += `<line x1="${cx.toFixed(1)}" y1="${yQ3.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${yWHi.toFixed(1)}" stroke="${color}" stroke-width="1.5" stroke-dasharray="4,2" opacity="0.7"/>`;
    boxes += `<line x1="${cx.toFixed(1)}" y1="${yQ1.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${yWLo.toFixed(1)}" stroke="${color}" stroke-width="1.5" stroke-dasharray="4,2" opacity="0.7"/>`;
    // Bıyık uçları
    let capW = boxWidth * 0.35;
    boxes += `<line x1="${(cx-capW).toFixed(1)}" y1="${yWHi.toFixed(1)}" x2="${(cx+capW).toFixed(1)}" y2="${yWHi.toFixed(1)}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
    boxes += `<line x1="${(cx-capW).toFixed(1)}" y1="${yWLo.toFixed(1)}" x2="${(cx+capW).toFixed(1)}" y2="${yWLo.toFixed(1)}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;

    // IQR kutusu — dolgu + dışarı kenarlık
    boxes += `<rect x="${bx.toFixed(1)}" y="${Math.min(yQ1,yQ3).toFixed(1)}" width="${boxWidth.toFixed(1)}" height="${Math.max(boxH,2).toFixed(1)}" rx="3" fill="${color}" fill-opacity="0.14" stroke="${color}" stroke-width="2"/>`;

    // Medyan çizgisi
    boxes += `<line x1="${bx.toFixed(1)}" y1="${yMed.toFixed(1)}" x2="${(bx+boxWidth).toFixed(1)}" y2="${yMed.toFixed(1)}" stroke="#dc3545" stroke-width="2.5" stroke-linecap="round"/>`;

    // Ortalama nokta
    boxes += `<circle cx="${cx.toFixed(1)}" cy="${yMean.toFixed(1)}" r="4.5" fill="#fd7e14" stroke="#fff" stroke-width="1.5"/>`;

    // Aykırı değerler
    (bp.outliers||[]).forEach(ov => {
      boxes += `<circle cx="${cx.toFixed(1)}" cy="${toY(ov).toFixed(1)}" r="3" fill="none" stroke="#6f42c1" stroke-width="1.5"/>`;
    });

    // Öğrenci nokta (vurgulu)
    if(studentVal !== null && studentVal !== undefined && !isNaN(studentVal)) {
      let sy = toY(studentVal);
      boxes += `<circle cx="${cx.toFixed(1)}" cy="${sy.toFixed(1)}" r="7" fill="#dc3545" stroke="#fff" stroke-width="2" filter="url(#${_glowId})"/>`;
    }

    // X ekseni etiketi
    boxes += `<text x="${cx.toFixed(1)}" y="${(H - marginBottom + 15).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="600" fill="#343a40">${escapeHtml(g.label)}</text>`;
    // Medyan değeri
    boxes += `<text x="${cx.toFixed(1)}" y="${(H - marginBottom + 27).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="#6c757d">Md:${bp.median.toFixed(1)}</text>`;
  });

  // Legend
  let lx = W - marginRight - 6;
  let hasStudent = studentVal !== null && studentVal !== undefined && !isNaN(studentVal);

  // Legend - sağdan sola yerleştir
  let legendParts = '';
  let lxCur = lx;
  // Ort.
  legendParts += `<circle cx="${(lxCur - 5).toFixed(1)}" cy="${(marginTop - 10).toFixed(1)}" r="4" fill="#fd7e14" stroke="#fff" stroke-width="1.5"/>`;
  legendParts += `<text x="${(lxCur + 1).toFixed(1)}" y="${(marginTop - 6).toFixed(1)}" font-size="9" fill="#6c757d">Ort.</text>`;
  lxCur -= 46;
  // Medyan
  legendParts += `<line x1="${(lxCur - 10).toFixed(1)}" y1="${(marginTop - 10).toFixed(1)}" x2="${(lxCur - 2).toFixed(1)}" y2="${(marginTop - 10).toFixed(1)}" stroke="#dc3545" stroke-width="2.5" stroke-linecap="round"/>`;
  legendParts += `<text x="${(lxCur + 1).toFixed(1)}" y="${(marginTop - 6).toFixed(1)}" font-size="9" fill="#6c757d">Medyan</text>`;
  lxCur -= 62;
  if(hasStudent) {
    legendParts += `<circle cx="${(lxCur - 5).toFixed(1)}" cy="${(marginTop - 10).toFixed(1)}" r="5" fill="#dc3545" stroke="#fff" stroke-width="1.5"/>`;
    legendParts += `<text x="${(lxCur + 2).toFixed(1)}" y="${(marginTop - 6).toFixed(1)}" font-size="9" fill="#6c757d">Öğrenci</text>`;
  }

  let titleText = options.title ? `<text x="${marginLeft}" y="${marginTop - 10}" font-size="10" font-weight="700" fill="#3a5a9a">${escapeHtml(options.title)}</text>` : '';

  return `<div class="boxplot-wrap"><svg class="boxplot-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(options.title || 'Kutu grafiği')}"><title>${escapeHtml(options.title || 'Kutu grafiği')}</title>
    <defs>
      <filter id="${_glowId}" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect x="${marginLeft}" y="${marginTop}" width="${plotW}" height="${plotH}" fill="#fafbff" rx="2"/>
    ${bgBands}
    ${titleText}${legendParts}
    <line x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${(marginTop+plotH).toFixed(1)}" stroke="#ced4da" stroke-width="1.5"/>
    <line x1="${marginLeft}" y1="${(marginTop+plotH).toFixed(1)}" x2="${(W-marginRight).toFixed(1)}" y2="${(marginTop+plotH).toFixed(1)}" stroke="#ced4da" stroke-width="1.5"/>
    ${gridLines}${gridLabels}${boxes}
  </svg></div>`;
}

function mkMultiClassBoxPlot(classDataMap, highlightClass, options, allVals) {
  options = options || {};
  let entries = Object.entries(classDataMap).sort((a,b)=>a[0].localeCompare(b[0],'tr'));
  if(entries.length === 0) return '';
  // Sınıf renkleri çubuk grafikteki cols ile ayn (sıralı eşleşme)
  let groups = entries.map(([cls, vals], i) => ({
    label: cls,
    values: vals,
    color: highlightClass && cls === highlightClass ? '#dc3545' : cols[i % cols.length]
  }));
  // "Tümü" grubu: tüm bireylerin değerleri birleştirilir
  if(allVals && allVals.length >= 3) {
    groups.unshift({ label: 'Tümü', values: allVals, color: '#6c757d' });
  }
  let W = Math.max(560, groups.length * 90 + 80);
  return mkBoxPlotSVG(groups, null, { ...options, width: W });
}

// sb parametresi opsiyoneldir; belirtilmezse veya 'totalNet' ise net bazlı hesap yapılır.
// 'score' → puan, 's_matematik' gibi → o dersin neti kullanılır.
function calcKarneSummaryCards(stuNo, examType, grade, examsData, sb) {
  sb = sb || 'totalNet';
  let attended = examsData.filter(e => !e.abs);
  if(!attended.length) return null;

  // sb'ye göre değer çekici
  let _subjKey = sb.startsWith('s_') ? toTitleCase(sb.replace('s_','')) : null;
  let _getVal = (e) => {
    if(sb === 'score') return (e.score !== undefined && e.score !== null) ? e.score : null;
    if(_subjKey) { let sn = e.subs ? (e.subs[_subjKey] || e.subs[sb.replace('s_','')]) : null; return sn ? sn.net : null; }
    return e.totalNet; // totalNet (varsayılan)
  };

  let stuVals = attended.map(_getVal).filter(v => v !== null);
  if(!stuVals.length) return null;
  let stuAvg = stuVals.reduce((a,b)=>a+b,0) / stuVals.length;

  let allSameGrade = DB.e.filter(x => x.examType===examType && !x.abs && getGrade(x.studentClass)===grade);
  // Kurum ortalaması öğrencinin KATILDIĞI sınavlarla eşleştirilir (girmediği sınavlar hariç); aksi halde öğrenci ortalaması ile
  // kurum ortalaması farklı sınav kümelerinden hesaplanır ve zorluk farkı karşılaştırmayı bozar.
  let _attKeys = new Set(attended.map(e => e.date + '||' + (e.publisher || '')));
  let genVals = allSameGrade.filter(e => _attKeys.has(e.date + '||' + (e.publisher || ''))).map(_getVal).filter(v => v !== null);
  let genAvg = genVals.length ? genVals.reduce((a,b)=>a+b,0)/genVals.length : null;

  let stuMap_local = {};
  allSameGrade.forEach(e => {
    let v = _getVal(e); if(v === null) return;
    if(!stuMap_local[e.studentNo]) stuMap_local[e.studentNo] = {sum:0,cnt:0};
    stuMap_local[e.studentNo].sum += v;
    stuMap_local[e.studentNo].cnt++;
  });
  let rankings = Object.entries(stuMap_local).map(([no,v])=>({no,avg:v.sum/v.cnt})).sort((a,b)=>b.avg-a.avg);
  let rank = rankings.findIndex(x=>x.no===stuNo)+1;
  let totalStudents = rankings.length;

  // Sınıf Derecesi
  let stuClass = (getStuMap().get(stuNo)||{}).class || '';
  let allSameClass = DB.e.filter(x => x.examType===examType && !x.abs && x.studentClass===stuClass);
  let clsMap_local = {};
  allSameClass.forEach(e => {
    let v = _getVal(e); if(v === null) return;
    if(!clsMap_local[e.studentNo]) clsMap_local[e.studentNo] = {sum:0,cnt:0};
    clsMap_local[e.studentNo].sum += v;
    clsMap_local[e.studentNo].cnt++;
  });
  let clsRankings = Object.entries(clsMap_local).map(([no,v])=>({no,avg:v.sum/v.cnt})).sort((a,b)=>b.avg-a.avg);
  let classRank = clsRankings.findIndex(x=>x.no===stuNo)+1;
  let classTotalStudents = clsRankings.length;

  // Katılım: öğrencinin sınıf seviyesinde o sınav türüne ait tüm unique sınavlar baz alınır
  let gradeExamKeys = new Set();
  DB.e.forEach(x => { if(x.examType===examType && getGrade(x.studentClass)===grade) gradeExamKeys.add(x.date+'||'+( x.publisher||'')); });
  let attendedKeys = new Set();
  DB.e.forEach(x => { if(x.studentNo===stuNo && x.examType===examType && !x.abs) attendedKeys.add(x.date+'||'+( x.publisher||'')); });
  let totalExamCount = gradeExamKeys.size;
  let attendedCount  = attendedKeys.size;
  let partRate = totalExamCount > 0 ? Math.max(0, Math.min(100, Math.round(attendedCount / totalExamCount * 100))) : 0;

  // Trend + Kişisel Tutarlılık — sb'ye göre seçilen metrik üzerinden
  let metricVals = attended.map(_getVal).filter(v => v !== null);
  let trend = null;
  let consistency = null;
  if(metricVals.length >= _TREND_MIN_N){
    // Yön etiketi yalnızca eğim istatistiksel olarak anlamlıysa (t-testi) verilir; aksi halde "belirgin trend yok"
    let fit = _trendFit(metricVals);
    let slope = fit.slope, r2 = fit.r2;
    let ewmaVal = ewma(metricVals, 3, 0.5);
    let totalChange = slope * (metricVals.length - 1);
    let trendClass, trendIcon, trendText;
    if(!fit.significant) {
      trendClass = 'trend-stable'; trendIcon = 'fa-question-circle';
      trendText = fit.n < _TREND_SIG_MIN_N ? 'Veri yetersiz' : 'Belirgin trend yok';
    } else if(slope > 0) {
      trendClass = 'trend-up'; trendIcon = 'fa-arrow-up'; trendText = 'Yükseliş';
    } else {
      trendClass = 'trend-down'; trendIcon = 'fa-arrow-down'; trendText = 'Düşüş';
    }
    trend = { totalChange, slope, r2, p: fit.p, significant: fit.significant, ewmaVal, count: metricVals.length, trendClass, trendIcon, trendText };

    let surpriseRMSE = linRegRMSE(metricVals);
    if(surpriseRMSE !== null){
      consistency = { sd: surpriseRMSE, label: _surpriseLabel(surpriseRMSE, _pooledWithinExamSd(allSameGrade, _getVal)), n: metricVals.length };
    }
  }

  return {stuAvg, genAvg, rank, totalStudents, classRank, classTotalStudents, partRate, attendedCount, totalExamCount, trend, consistency};
}

function buildRiskInfoCards(stuNo, examType, stuClass) {
  let risks = (_riskCache && _riskCache.results) ? _riskCache.results : calcRiskScores();
  let stuRisk = risks.find(r => r.no === stuNo && r.examTypes.includes(examType));
  if(!stuRisk) return '';

  const levelLabel = { high:'Yüksek Risk', med:'Orta Risk', low:'Düşük Risk' };
  const typeIcon   = { trend:'fa-chart-line', rank:'fa-sort-amount-up', subj:'fa-book', abs:'fa-calendar-times' };
  const typeLabel  = { trend:'Düşüş Trendi', rank:'Sıra Gerileme', subj:'Ders Düşüşü', abs:'Devamsızlık' };

  // Bu sınav türüne ait flagler
  let examFlags = stuRisk.flags.filter(f => f.examType === examType);
  if(!examFlags.length) return '';

  let badgesHtml = examFlags.map(f => {
    let safeTitle = escapeHtml(f.detail);
    let typeKey = (typeLabel[f.type] && typeIcon[f.type]) ? f.type : 'trend';
    return `<button type="button" class="risk-badge rb-${escapeHtml(typeKey)}" title="${safeTitle}" onclick="showToast(${jsArg(f.detail)}, 'warning', 4000)">
       <i class="fas ${typeIcon[typeKey]} risk-badge-icon"></i>${escapeHtml(typeLabel[typeKey])}
     </button>`;
  }).join('');

  let cardInner = `<div class="risk-info-card risk-${stuRisk.level}">
    <div class="risk-info-head">
      <div>
        <span class="risk-info-label">
          <i class="fas fa-exclamation-triangle me-1"></i>${levelLabel[stuRisk.level]}
        </span>
        <span class="risk-info-score">Risk Puanı: <strong>${stuRisk.score.toFixed(1)}</strong></span>
      </div>
      <div class="risk-info-badges">${badgesHtml}</div>
    </div>
  </div>`;

  return `<div class="row mb-2 no-print print-hide-risk-analysis risk-info-section">
    <div class="col-12 mb-2">
      <div class="risk-info-title"><i class="fas fa-shield-alt me-1"></i>Risk Analizi</div>
      ${cardInner}
    </div>
  </div>`;
}

// 4 üst kart (Ortalama Net, Katılım, Sınıf Derece, Kurum Derece) + (n≥3 ise) trend bloğu.
// Trend bloğu: Genel Yön (R² chip), Toplam İlerleme, Sınav Başına Değişim, Performans Tutarlılığı (σ), Son Dönem Ortalaması.
// metricLabel: görünen etiket (ör. 'Net', 'Puan', 'Matematik Neti') — belirtilmezse 'Net'
function buildKarneExamCards(summary, examType, metricLabel) {
  if(!summary) return '';
  metricLabel = metricLabel || 'Net';
  let isScore = (metricLabel === 'Puan');
  let {stuAvg, genAvg, rank, totalStudents, classRank, classTotalStudents, partRate, attendedCount, totalExamCount, trend, consistency} = summary;

  // Katılım kartı + trend bloğu oluştur
  // ÖNEMLİ: Trend bloğu yalnızca n≥3 sınavda gösterilir. Tek sınav türünde 1-2 sınav varsa
  //         bilimsel olarak regresyon/eğim anlamsızdır (bkz. Konuşma — kart matrisi).
  let trendHtml = '';
  if(trend) {
    let trendTone = trend.trendClass==='trend-up' ? 'trend-tone-up' : (trend.trendClass==='trend-down' ? 'trend-tone-down' : 'trend-tone-stable');
    let tSign  = trend.totalChange > 0 ? '+' : '';
    let sSign  = trend.slope > 0 ? '+' : '';

    // R²: Trendin ne kadar tutarlı/güvenilir olduğunu gösterir (0-1; 1 mükemmel uyum)
    let r2Pct  = trend.r2 !== undefined ? Math.round(trend.r2 * 100) : null;
    let r2Tooltip = trend.significant
      ? 'Eğim istatistiksel olarak anlamlı (t-testi, p≤0.10): sınav sonuçlarında tutarlı bir yön var.'
      : (trend.count < _TREND_SIG_MIN_N
          ? `Trendin anlamlılığı için en az ${_TREND_SIG_MIN_N} sınav gerekir; şu an yön iddia edilmiyor.`
          : 'Sonuçlar dalgalı; istatistiksel olarak anlamlı bir trend yok (yön yorumu yapılmamalı).');

    // EWMA: Son sınavlara daha fazla ağırlık verilen ortalama (kısa-vadeli momentum)
    let ewmaVal = trend.ewmaVal !== null && trend.ewmaVal !== undefined ? trend.ewmaVal.toFixed(1) : null;
    let conf = _sampleConfidence(trend.count || 0);

    // Sürpriz Payı — regresyon doğrusundan kalıntıların RMSE'si (Standart Hata).
    let consHtml = '';
    if(consistency){
      consHtml = `<div class="col mb-1 trend-metric" title="Sınav sonuçlarının trend doğrusundan ortalama sapması (Standart Hata / RMSE). Düşük değer = trend güvenilir, sürpriz az.">
        <div class="trend-value trend-tone-purple">±${consistency.sd.toFixed(2)}</div>
        <div class="small text-muted trend-label">Sürpriz Payı (RMSE)</div>
        <div class="x-small text-muted">${consistency.label}</div>
        <div class="x-small text-muted">(Standart Hata / RMSE)</div>
      </div>`;
    }

    trendHtml = `<div class="student-profile-part student-profile-stats-part"><div class="trend-card mt-2 mb-1"><div class="row align-items-center text-center trend-row">
      <div class="col mb-1 trend-metric" title="${r2Tooltip}">
        <span class="trend-indicator trend-indicator-sm ${trend.trendClass}"><i class="fas ${trend.trendIcon} me-1"></i>${trend.trendText}</span>
        <div class="small text-muted mt-1 trend-label"><strong>Genel Yön (Trend)</strong></div>
        ${r2Pct !== null ? `<div class="x-small mt-1 ${trendTone}">Açıklanan varyans: <strong>%${r2Pct}</strong> (R²: ${(r2Pct/100).toFixed(2)}${trend.p !== null && trend.p !== undefined ? ', ' + _fmtP(trend.p) : ''})</div>` : ''}
      </div>
      <div class="col mb-1 trend-metric" title="İlk sınavdan son sınava kadar regresyon doğrusunun toplam değişimi">
        <div class="trend-value ${trendTone}">${tSign}${trend.totalChange.toFixed(1)}</div>
        <div class="small text-muted trend-label"><strong>Toplam Değişim</strong></div>
        <div class="x-small text-muted">Süreç Boyunca</div>
      </div>
      <div class="col mb-1 trend-metric" title="Her yeni sınavda beklenen ortalama değişim (regresyon eğimi)">
        <div class="trend-value ${trendTone}">${sSign}${trend.slope.toFixed(2)}</div>
        <div class="small text-muted trend-label"><strong>Sınav Başına Değişim</strong></div>
        <div class="x-small text-muted">(Regresyon Analizi)</div>
      </div>
      ${consHtml}
      <div class="col mb-1 trend-metric" title="Son sınavlara daha fazla ağırlık verilerek hesaplanan ortalama (EWMA, α=0.5)">
        <div class="trend-value trend-tone-primary">${ewmaVal !== null ? ewmaVal : '—'}</div>
        <div class="small text-muted trend-label"><strong>Güncel Performans (EWMA)</strong></div>
        <div class="x-small text-muted">(Ağırlıklı / EWMA)</div>
      </div>
      <div class="col mb-1 trend-metric" title="Bu sınav türünde katıldığı sınav sayısı">
        <div class="trend-value">${trend.count}</div>
        <div class="small text-muted trend-label"><strong>Katıldığı Sınav</strong></div>
        <div class="confidence-chip ${conf.cls}" title="${escapeHtml(conf.note)}"><i class="fas fa-shield-alt"></i>${escapeHtml(conf.label)}</div>
      </div>
    </div></div></div>`;
  }

  let avgLabel = isScore ? 'Ortalama Puan' : `Ortalama ${metricLabel}`;
  let avgLabelSafe = escapeHtml(avgLabel);
  let genOrtLabel = isScore ? 'Genel Puan Ortalaması' : 'Genel Ortalama';

  let cardsHtml = `<div class="student-profile-part student-profile-info-part"><div class="row g-2 sec-cards-row analysis-info-cards student-profile-info-cards mb-2">
    <div class="col-12 col-md-3 mb-2">
      <div class="sec-card">
        <div class="sec-icon"><i class="fas fa-chart-bar"></i></div>
        <div class="sec-body">
          <div class="sec-label">${avgLabelSafe}</div>
          <div class="sec-value">${stuAvg.toFixed(2)}</div>
          <div class="sec-sub">${genOrtLabel}: ${genAvg!==null?genAvg.toFixed(2):'—'}</div>
        </div>
      </div>
    </div>
    <div class="col-12 col-md-3 mb-2">
      <div class="sec-card">
        <div class="sec-icon"><i class="fas fa-percentage"></i></div>
        <div class="sec-body">
          <div class="sec-label">Katılım</div>
          <div class="sec-value">${partRate}%</div>
          <div class="sec-sub">${attendedCount}/${totalExamCount} Sınav</div>
        </div>
      </div>
    </div>
    <div class="col-12 col-md-3 mb-2">
      <div class="sec-card">
        <div class="sec-icon"><i class="fas fa-users"></i></div>
        <div class="sec-body">
          <div class="sec-label">Sınıf Derece</div>
          <div class="sec-value">${classRank>0?classRank:'—'}</div>
          <div class="sec-sub">Toplam: ${classTotalStudents} Öğrenci</div>
        </div>
      </div>
    </div>
    <div class="col-12 col-md-3 mb-2">
      <div class="sec-card">
        <div class="sec-icon"><i class="fas fa-trophy"></i></div>
        <div class="sec-body">
          <div class="sec-label">Kurum Derece</div>
          <div class="sec-value">${rank>0?rank:'—'}</div>
          <div class="sec-sub">Toplam: ${totalStudents} Öğrenci</div>
        </div>
      </div>
    </div>
  </div></div>${trendHtml}`;
  return cardsHtml;
}

function rH(){
  let s=getStuMap().get(aNo); if(!s)return; let r=getEl('homeArea');
  let combined=DB.e.filter(x=>x.studentNo===aNo).sort((a,b)=>srt(a.date,b.date));
  if(!combined.length){r.innerHTML='<div class="alert alert-default-info">Bu öğrenciye ait sınav verisi yok.</div>';return;}

  let grp={}; combined.forEach(e=>{(grp[e.examType]=grp[e.examType]||[]).push(e);});
  let typs=Object.keys(grp).sort(); function abbrevSub(name, shorten){ return shorten?name.substring(0,3):toTitleCase(name); }
  let stGrade = getGrade(s.class);
  let stuNameSafe = escapeHtml(s.name);
  let stuClassSafe = escapeHtml(s.class);
  let stuReportName = safeFileName(`${s.name}_Karne`);

  let h=`<div class="d-flex justify-content-end mb-2 no-print student-report-actions"><button class="btn btn-success btn-sm me-2" onclick="xXLMul('kCont',${jsArg(stuReportName)})"><i class='fas fa-file-excel me-1'></i>Excel</button><button class="btn-print no-print" onclick="xPR('kCont',${jsArg(stuReportName)},this)"><i class='fas fa-print me-1'></i>Yazdır</button></div>
  <div id="kCont" class="card shadow-sm report-card">
    <div class="report-header">
      <span class="report-title-main"><i class="fas fa-user-graduate me-2"></i><strong>${stuNameSafe}</strong> — Karne Özeti</span>
      <span class="report-title-sub">Sınıf: ${stuClassSafe} | ${new Date().toLocaleDateString('tr-TR')}</span>
    </div>
    <div class="card-body report-card-body">`;

  let typsIdx = 0;
  typs.forEach(t=>{
    let el=grp[t].sort((a,b)=>srt(a.date,b.date));
    // --- Sanal "Katılmadı" satırları: sınıf seviyesinde var olup öğrenci için kaydı bulunmayan sınavlar ---
    {
      let attendedKeys = new Set();
      el.forEach(e => { attendedKeys.add(e.date+'||'+(e.publisher||'')); });
      let seenGradeKey = new Set();
      DB.e.forEach(x => {
        if(x.examType !== t) return;
        if(getGrade(x.studentClass) !== stGrade) return;
        let k = x.date+'||'+(x.publisher||'');
        if(seenGradeKey.has(k)) return;
        seenGradeKey.add(k);
        if(!attendedKeys.has(k)) {
          el.push({ studentNo: aNo, studentClass: s.class, examType: t, date: x.date, publisher: x.publisher||'', subs: {}, totalNet: 0, score: 0, cR:'—', cP:'—', iR:'—', iP:'—', abs: true });
        }
      });
      el.sort((a,b)=>srt(a.date,b.date));
    }
    let sb=Array.from(new Set(el.filter(e=>!e.abs).flatMap(e=>Object.keys(e.subs)))).sort();
    let totalCols=sb.length+5, shorten=totalCols>10;
    
    let summary = calcKarneSummaryCards(aNo, t, stGrade, el);
    let cardsHtml = buildKarneExamCards(summary, t);
    let riskCardsHtml = buildRiskInfoCards(aNo, t, s.class);
    let isFirstType = (typsIdx === 0); typsIdx++;
    let canvasId='cKarne_'+t.replace(/[^a-zA-Z0-9]/g,'_');
    let bpKarneId='bpKarne_'+t.replace(/[^a-zA-Z0-9]/g,'_');
    
    let _examCount = el.filter(e=>!e.abs).length;
    let _examColorIdx = (typeof examColorIdx === 'function') ? examColorIdx(t) : 0;
    let _examLabel = (typeof toExamLabel === 'function') ? toExamLabel(t) : t;
    h+=`<div class="karne-bolum exam-type-block exam-color-${_examColorIdx}${isFirstType?' exam-type-first':''}" data-stu-name="${stuNameSafe}" data-stu-class="${stuClassSafe}"><h5 class="mt-3 mb-2 text-primary border-bottom pb-2"><span>${escapeHtml(_examLabel)} Sınavları</span><span class="etb-count no-print">${_examCount} Sınav</span></h5>${cardsHtml}${riskCardsHtml}<div id="${bpKarneId}" class="student-profile-part student-profile-boxplot-part"></div><div class="student-profile-part student-profile-table-part"><div class="scroll-hint"><i class="fas fa-arrows-alt-h me-1"></i>Tabloyu kaydırın</div><div class="scroll"><table class="table table-sm table-bordered table-striped" data-sh="${escapeHtml(t)}"><thead><tr><th>#</th><th>Tarih</th><th>Yayınevi</th>${sb.map(x=>`<th title="${escapeHtml(toTitleCase(x))}">${escapeHtml(abbrevSub(x,shorten))}</th>`).join('')}<th>Top. Net</th><th>Puan</th><th>Snf(S/K)</th><th>Kurum(S/K)</th></tr></thead><tbody>`;
    
    let kIdx = 1;
    el.forEach(e=>{
      let pub = e.publisher || '—', sNo = e.abs ? '—' : kIdx++;
      if(e.abs) h+=`<tr class="absent-row"><td>${sNo}</td><td>${escapeHtml(e.date)}</td><td>${escapeHtml(toTitleCase(pub))}</td><td colspan="${sb.length+4}" class="text-center fw-bold">Katılmadı</td></tr>`;
      else h+=`<tr><td>${sNo}</td><td>${escapeHtml(e.date)}</td><td>${escapeHtml(toTitleCase(pub))}</td>${sb.map(x=>`<td>${e.subs[x]!==undefined?e.subs[x].net.toFixed(2):'—'}</td>`).join('')}<td><strong>${e.totalNet.toFixed(2)}</strong></td><td>${e.score.toFixed(2)}</td><td>${escapeHtml(e.cR||'—')}/${escapeHtml(e.cP||'—')}</td><td>${escapeHtml(e.iR||'—')}/${escapeHtml(e.iP||'—')}</td></tr>`;
    });
    
    let attended = el.filter(e => !e.abs);
    if(attended.length > 0){
      // Sınıf/Kurum ortalaması öğrencinin KATILDIĞI sınavlarla eşleştirilir (girmediği sınavlar hariç)
      let _attK = new Set(attended.map(e => e.date + '||' + (e.publisher || '')));
      let allGradeExams = DB.e.filter(x => x.examType === t && !x.abs && getGrade(x.studentClass) === stGrade && _attK.has(x.date + '||' + (x.publisher || '')));
      let allClassExams = DB.e.filter(x => x.examType === t && !x.abs && x.studentClass === s.class && _attK.has(x.date + '||' + (x.publisher || '')));
      let genAvgSubs = sb.map(x => { let v = allGradeExams.filter(e => e.subs[x] !== undefined).map(e => e.subs[x].net); return v.length ? (v.reduce((a,b)=>a+b,0)/v.length).toFixed(2) : '—'; });
      let genAvgNet = allGradeExams.length > 0 ? (allGradeExams.reduce((a,e)=>a+e.totalNet,0)/allGradeExams.length).toFixed(2) : '—';
      let genAvgScore = allGradeExams.length > 0 ? (allGradeExams.reduce((a,e)=>a+e.score,0)/allGradeExams.length).toFixed(2) : '—';
      let clsAvgSubs = sb.map(x => { let v = allClassExams.filter(e => e.subs[x] !== undefined).map(e => e.subs[x].net); return v.length ? (v.reduce((a,b)=>a+b,0)/v.length).toFixed(2) : '—'; });
      let clsAvgNet = allClassExams.length > 0 ? (allClassExams.reduce((a,e)=>a+e.totalNet,0)/allClassExams.length).toFixed(2) : '—';
      let clsAvgScore = allClassExams.length > 0 ? (allClassExams.reduce((a,e)=>a+e.score,0)/allClassExams.length).toFixed(2) : '—';
      let avgSubs = sb.map(x => { let v = attended.filter(e => e.subs[x] !== undefined).map(e => e.subs[x].net); return v.length ? (v.reduce((a,b)=>a+b,0)/v.length).toFixed(2) : '—'; });
      let avgNet = (attended.reduce((a,e)=>a+e.totalNet,0)/attended.length).toFixed(2), avgScore = (attended.reduce((a,e)=>a+e.score,0)/attended.length).toFixed(2);
      
      h += `<tr class="avg-row"><td colspan="3" class="avg-label">Öğrenci Ortalama</td>${avgSubs.map(v=>`<td>${v}</td>`).join('')}<td>${avgNet}</td><td>${avgScore}</td><td colspan="2">—</td></tr>`;
      h += `<tr class="avg-row"><td colspan="3" class="avg-label">Sınıf Ortalama (${stuClassSafe})</td>${clsAvgSubs.map(v=>`<td>${v}</td>`).join('')}<td>${clsAvgNet}</td><td>${clsAvgScore}</td><td colspan="2">—</td></tr>`;
      h += `<tr class="avg-row"><td colspan="3" class="avg-label">Kurum Ortalama (${escapeHtml(stGrade)}. Sınıflar)</td>${genAvgSubs.map(v=>`<td>${v}</td>`).join('')}<td>${genAvgNet}</td><td>${genAvgScore}</td><td colspan="2">—</td></tr>`;
    }

    h+=`</tbody></table></div></div><div class="student-profile-part student-profile-chart-part"><div class="chart-box chart-box-sm chart-box-tight avoid-break"><div class="chart-title">${escapeHtml(t)} — Toplam Net Gelişimi</div><canvas id="${canvasId}"></canvas></div></div></div>`;
  });

  h+=`</div></div>`;
  if(c.h){ c.h.destroy(); c.h=null; } if(window._karneCharts){window._karneCharts.forEach(ch=>{try{ch.destroy();}catch(e){}});} window._karneCharts=[];
  r.innerHTML=h; 
  
  setTimeout(()=>{
    typs.forEach(t=>{
      let canvasId='cKarne_'+t.replace(/[^a-zA-Z0-9]/g,'_'); let cv=getEl(canvasId); if(!cv)return;
      let exT=DB.e.filter(x=>x.studentNo===aNo&&x.examType===t).sort((a,b)=>srt(a.date,b.date));
      let chartLabels = exT.map(e => e.publisher ? `${e.date} (${toTitleCase(e.publisher)})` : e.date);
      let stuD=exT.map(e=>e.abs?null:e.totalNet);
      let clsD=exT.map(e=>{if(e.abs)return null;let v=DB.e.filter(x=>x.date===e.date&&x.examType===t&&x.studentClass===s.class&&!x.abs).map(x=>x.totalNet);return v.length?(v.reduce((a,b)=>a+b,0)/v.length):null;});
      let insD=exT.map(e=>{if(e.abs)return null;let v=DB.e.filter(x=>x.date===e.date&&x.examType===t&&!x.abs&&getGrade(x.studentClass)===stGrade).map(x=>x.totalNet);return v.length?(v.reduce((a,b)=>a+b,0)/v.length):null;});
      let ch=mkChart(canvasId,chartLabels,[{label:'Toplam Net',data:stuD,backgroundColor:cols[0]+'cc',borderColor:cols[0],borderWidth:1.5},{label:'Sınıf Ort.',data:clsD,backgroundColor:cols[2]+'99',borderColor:cols[2],borderWidth:1.5},{label:'Kurum Ort.',data:insD,backgroundColor:cols[3]+'99',borderColor:cols[3],borderWidth:1.5}]);
      window._karneCharts.push(ch);
      // Kutu grafiği — her sınav türü için ayrı ayrı
      let bpKarneId='bpKarne_'+t.replace(/[^a-zA-Z0-9]/g,'_');
      let bpKarneEl=getEl(bpKarneId);
      if(bpKarneEl){
        let bpHtml=buildStuBoxPlots(aNo, t, s.class, stGrade, 'totalNet');
        if(bpHtml) bpKarneEl.innerHTML=bpHtml;
      }
    });
  },150);
}

// _buildSingleMetricSparkline ve buildSubjectSparklines kaldırıldı (ölü kod — hiçbir yerden çağrılmıyor).

// ---- buildSingleExamCards: Tek sınav modu için genel bilgi kartları ----
// (1) Puan & Sıra  (2) Önceki Sınava Fark  (3) En Başarılı Ders  (4) En Zayıf Ders  (5) Genel Katılım
// Karşılaştırma: ders bazında öğrenci neti hem Sınıf hem Kurum ortalamasıyla kıyaslanır.
function buildSingleExamCards(stu, examType, curExam, prevExam, stGrade){
  let cardCol = 'col-12 col-md-6 col-lg';
  // Card 1: Puan & Sıra
  let scoreTxt = (curExam.score!==undefined && curExam.score!==null) ? curExam.score.toFixed(2) : '—';
  let netTxt   = (curExam.totalNet!==undefined && curExam.totalNet!==null) ? curExam.totalNet.toFixed(2) : '—';
  let rankBits =[];
  if(curExam.cR) rankBits.push(`Sınıf ${escapeHtml(curExam.cR)}/${escapeHtml(curExam.cP||'—')}`);
  if(curExam.iR) rankBits.push(`Kurum ${escapeHtml(curExam.iR)}/${escapeHtml(curExam.iP||'—')}`);
  let card1 = `<div class="${cardCol}"><div class="sec-card">
    <div class="sec-icon"><i class="fas fa-star"></i></div>
    <div class="sec-body">
      <div class="sec-label">Puan ve Sıra</div>
      <div class="sec-value">${scoreTxt}</div>
      <div class="sec-sub">Net: ${netTxt}${rankBits.length?' · '+rankBits.join(' · '):''}</div>
    </div></div></div>`;

  // Bilgi kartı: Önceki sınava göre fark
  let prevCard;
  if(prevExam){
    let dN = curExam.totalNet - prevExam.totalNet;
    let dS = (curExam.score||0) - (prevExam.score||0);
    let cls = dN > 0 ? 'sec-pos' : (dN < 0 ? 'sec-neg' : 'sec-neutral');
    let icon = dN > 0 ? 'fa-arrow-up' : (dN < 0 ? 'fa-arrow-down' : 'fa-minus');
    let sign = dN > 0 ? '+' : '';
    let signS = dS > 0 ? '+' : '';
    let _pubP = prevExam.publisher ? ` (${toTitleCase(prevExam.publisher)})` : '';
    let prevExamLabel = `${escapeHtml(prevExam.date)}${escapeHtml(_pubP)}`;
    prevCard = `<div class="${cardCol}"><div class="sec-card ${cls}">
      <div class="sec-icon"><i class="fas ${icon}"></i></div>
      <div class="sec-body">
        <div class="sec-label">Önceki Sınava Fark</div>
        <div class="sec-value">${sign}${dN.toFixed(2)} <small class="sec-unit">net</small></div>
        <div class="sec-sub">Puan: ${signS}${dS.toFixed(2)} · ${prevExamLabel}</div>
      </div></div></div>`;
  } else {
    prevCard = `<div class="${cardCol}"><div class="sec-card sec-neutral">
      <div class="sec-icon"><i class="fas fa-chart-line"></i></div>
      <div class="sec-body">
        <div class="sec-label">Önceki Sınava Fark</div>
        <div class="sec-value">—</div>
        <div class="sec-sub">Önceki sınav verisi yok</div>
      </div></div></div>`;
  }

  // Cards 3 & 4: En Başarılı / En Zayıf Ders
  let subjects = Object.keys(curExam.subs || {});
  let perSubj = subjects.map(s => {
    let sn = curExam.subs[s];
    if(!sn || sn.net === null || sn.net === undefined) return null;
    let net = sn.net;
    let cv = DB.e.filter(x => x.date===curExam.date && (x.publisher||'')===(curExam.publisher||'') && x.examType===examType && x.studentClass===stu.class && !x.abs && x.subs[s]!==undefined).map(x => x.subs[s].net);
    let iv = DB.e.filter(x => x.date===curExam.date && (x.publisher||'')===(curExam.publisher||'') && x.examType===examType && getGrade(x.studentClass)===stGrade && !x.abs && x.subs[s]!==undefined).map(x => x.subs[s].net);
    let clsA = cv.length ? cv.reduce((a,b)=>a+b,0)/cv.length : null;
    let insA = iv.length ? iv.reduce((a,b)=>a+b,0)/iv.length : null;
    let dC = clsA!==null ? net - clsA : null;
    let dI = insA!==null ? net - insA : null;
    let combined = (dC!==null && dI!==null) ? (dC+dI)/2 : (dC!==null ? dC : dI);
    // Dersler arası kıyas için ham net farkı yerine standartlaştırılmış fark: soru sayısı/yayılımı büyük dersler (ham farkları doğal olarak
    // büyüktür) sistematik olarak "en başarılı/en zayıf" seçilmesin. Ölçek: aynı sınavdaki öğrenciler arası standart sapma.
    let _scaleSd = iv.length >= 5 ? _statStd(iv) : (cv.length >= 5 ? _statStd(cv) : null);
    let zc = (combined !== null && _scaleSd && _scaleSd > 0) ? combined / _scaleSd : null;
    return combined === null ? null : { name: s, net, clsA, insA, dC, dI, combined, zc };
  }).filter(x => x);

  let card3, card4;
  if(perSubj.length){
    let _useZ = perSubj.every(x => x.zc !== null); // tüm derslerde ölçek hesaplanabiliyorsa standartlaştırılmış fark, değilse ham fark
    let sorted =[...perSubj].sort((a,b)=> _useZ ? (b.zc - a.zc) : (b.combined - a.combined));
    let best = sorted[0], worst = sorted[sorted.length-1];
    let mkSubCard = (it, isBest) => {
      let cls = isBest ? 'sec-pos' : 'sec-neg';
      let icon = isBest ? 'fa-trophy' : 'fa-exclamation-triangle';
      let label = isBest ? 'En Başarılı Ders' : 'En Zayıf Ders';
      let dCstr = it.dC===null ? '—' : (it.dC>0?'+':'')+it.dC.toFixed(2);
      let dIstr = it.dI===null ? '—' : (it.dI>0?'+':'')+it.dI.toFixed(2);
      return `<div class="${cardCol}"><div class="sec-card ${cls}">
        <div class="sec-icon"><i class="fas ${icon}"></i></div>
        <div class="sec-body">
          <div class="sec-label">${label}</div>
          <div class="sec-value">${escapeHtml(toTitleCase(it.name))}</div>
          <div class="sec-sub">Net: ${it.net.toFixed(2)} · Sınıf ${dCstr} · Kurum ${dIstr}</div>
        </div></div></div>`;
    };
    card3 = mkSubCard(best, true);
    card4 = (worst === best) ? '' : mkSubCard(worst, false);
  } else {
    let neutral = (lbl,icon) => `<div class="${cardCol}"><div class="sec-card sec-neutral">
      <div class="sec-icon"><i class="fas ${icon}"></i></div>
      <div class="sec-body">
        <div class="sec-label">${lbl}</div>
        <div class="sec-value">—</div>
        <div class="sec-sub">Karşılaştırma verisi yok</div>
      </div></div></div>`;
    card3 = neutral('En Başarılı Ders','fa-trophy');
    card4 = neutral('En Zayıf Ders','fa-exclamation-triangle');
  }

  // Bilgi kartı: Bu sınav türünde öğrencinin genel katılımı
  let _allTypeDates = new Set();
  DB.e.forEach(x => { if(x.examType===examType && getGrade(x.studentClass)===stGrade) _allTypeDates.add(x.date+'||'+(x.publisher||'')); });
  let _attTypeDates = new Set();
  DB.e.forEach(x => { if(x.studentNo===curExam.studentNo && x.examType===examType && !x.abs) _attTypeDates.add(x.date+'||'+(x.publisher||'')); });
  let _seTot = _allTypeDates.size, _seAtt = _attTypeDates.size;
  let _seRate = _seTot > 0 ? Math.round(_seAtt/_seTot*100) : 0;
  let _seRateCls = _seRate >= 80 ? 'sec-pos' : (_seRate >= 50 ? 'sec-neutral' : 'sec-neg');
  let participationCard = `<div class="${cardCol}"><div class="sec-card ${_seRateCls}">
    <div class="sec-icon"><i class="fas fa-calendar-check"></i></div>
    <div class="sec-body">
      <div class="sec-label">Genel Katılım</div>
      <div class="sec-value">${_seRate}%</div>
      <div class="sec-sub">${_seAtt} / ${_seTot} Sınav</div>
    </div></div></div>`;

  return `<div class="row g-2 sec-cards-row analysis-info-cards single-exam-info-cards">${card1}${prevCard}${card3}${card4}${participationCard}</div>`;
}

function buildStuBoxPlots(stuNo, examType, stuClass, stuGrade, sb) {
  // 1. SİSTEMDE O SINAV TÜRÜNDEN TOPLAM KAÇ TANE YAPILDIĞINI BUL
  let totalExamsOfType = new Set(Object.values(EXAM_META).filter(m => m.examType === examType).map(m => m.date)).size;
  
  // 2. 10'dan az sınavda dağılım grafiği gösterilir gibi yapılmaz; kullanıcıya sınır açıkça söylenir.
  if(totalExamsOfType < 10) {
    return `<div class="stat-limitation no-print"><i class="fas fa-circle-info me-1"></i>Dağılım/kutu grafiği için bu sınav türünde en az 10 sınav gerekir. Şu an ${totalExamsOfType} sınav var.</div>`;
  }

  // Öğrencinin kendi değeri (tüm sınavlardaki net ortalaması)
  let getVal = (e) => {
    if(e.abs) return null;
    if(sb === 'score') return e.score;
    if(sb === 'totalNet' || !sb) return e.totalNet;
    let _sn = e.subs[toTitleCase(sb.replace('s_',''))];
    return (_sn !== undefined && _sn !== null) ? _sn.net : null;
  };

  let stuExams = DB.e.filter(x => x.studentNo === stuNo && x.examType === examType && !x.abs);
  let stuVals = stuExams.map(getVal).filter(v => v !== null);
  let stuAvg = stuVals.reduce((a,b)=>a+b,0) / stuVals.length;

  // Sınıf içindeki tüm öğrencilerin ortalamaları
  let clsStudentAvgs = {};
  DB.e.filter(x => x.examType === examType && !x.abs && x.studentClass === stuClass).forEach(e => {
    let v = getVal(e); if(v === null) return;
    if(!clsStudentAvgs[e.studentNo]) clsStudentAvgs[e.studentNo] =[];
    clsStudentAvgs[e.studentNo].push(v);
  });
  let clsAvgArr = Object.values(clsStudentAvgs).map(arr => arr.reduce((a,b)=>a+b,0)/arr.length);

  // Okul (aynı sınıf seviyesi) içindeki tüm öğrencilerin ortalamaları
  let insStudentAvgs = {};
  DB.e.filter(x => x.examType === examType && !x.abs && getGrade(x.studentClass) === stuGrade).forEach(e => {
    let v = getVal(e); if(v === null) return;
    if(!insStudentAvgs[e.studentNo]) insStudentAvgs[e.studentNo] =[];
    insStudentAvgs[e.studentNo].push(v);
  });
  let insAvgArr = Object.values(insStudentAvgs).map(arr => arr.reduce((a,b)=>a+b,0)/arr.length);

  if(clsAvgArr.length < 3 && insAvgArr.length < 3) return '';

  let label = sb === 'score' ? 'Puan' : (sb === 'totalNet' || !sb ? 'Toplam Net' : toTitleCase(sb.replace('s_','')) + ' Neti');

  let clsBP = clsAvgArr.length >= 3 ? mkBoxPlotSVG([{label: stuClass, values: clsAvgArr, color:'#28a745'}], stuAvg, {title: `Sınıf İçi Dağılım — ${label}`, height: 195}) : '';
  let insBP = insAvgArr.length >= 3 ? mkBoxPlotSVG([{label: stuGrade+'. Sınıf', values: insAvgArr, color:'#0d6efd'}], stuAvg, {title: `Kurum İçi Dağılım — ${label}`, height: 195}) : '';

  if(!clsBP && !insBP) return '';

  let cols2 = (clsBP && insBP) ? 'col-md-6' : 'col-12';
  return `<div class="row mt-2 avoid-break avoid-break-row">
    ${clsBP ? `<div class="${cols2}"><div class="boxplot-card"><div class="boxplot-title"><i class="fas fa-chart-bar me-1 boxplot-icon-class"></i>Sınıf İçi Dağılım <span class="boxplot-note">— kırmızı = bu öğrenci</span></div>${clsBP}</div></div>` : ''}
    ${insBP ? `<div class="${cols2}"><div class="boxplot-card"><div class="boxplot-title"><i class="fas fa-chart-bar me-1 boxplot-icon-school"></i>Kurum İçi Dağılım <span class="boxplot-note">— kırmızı = bu öğrenci</span></div>${insBP}</div></div>` : ''}
  </div>`;
}

// ============================================================
// DERS ANALİZİ › "Tüm Dersler": satırlarda dersler, sütunlarda sınıflar
//  • Hücre = sınıfın o dersteki ortalama neti (seçili sınav / "Tüm Sınavlar" kayıtları üzerinden;
//    "Sınıf Ortalamaları" tablosuyla aynı hesap, parantez içi kayıt sayısı).
//  • Hücre rengi + istatistikler = sınıfın aynı dersteki DİĞER sınıflardan standart farkı (Hedges g,
//    öğrenci bazlı ortalama netler; sınıfta ve karşılaştırma grubunda en az 10 öğrenci — Ders Analizi'ndeki eşikle aynı).
//  • Dersler arası soru sayısı farklı olabileceğinden ham net yalnızca aynı satırdaki sınıflar arasında
//    karşılaştırılır; dersler arası kıyas standart fark (g) üzerinden yapılır.
// ============================================================
const _SUBJ_ALL_MIN_N = 10;

function _subjAllFmtD(d){
  let s = d.toFixed(2);
  if(s === '-0.00') s = '0.00';
  return (d > 0 && s !== '0.00' ? '+' : '') + s;
}

function _subjAllHeat(d){
  if(d === null || d === undefined || !isFinite(d)) return '';
  let a = Math.abs(d);
  if(a < 0.2) return '';
  let alpha = a >= 0.8 ? 0.32 : (a >= 0.5 ? 0.2 : 0.1);
  return d > 0 ? `background:rgba(25,135,84,${alpha});` : `background:rgba(220,53,69,${alpha});`;
}

function rAllSubjects(r, eT, lvl, br, dateFilterS){
  let ex = DB.e.filter(x => x.examType === eT && !x.abs && x.subs && (!dateFilterS || x.date === dateFilterS));
  if(lvl) ex = ex.filter(x => getGrade(x.studentClass) === lvl);
  if(br) ex = ex.filter(x => getClassParts(x.studentClass).branch === br);

  // ---- Toplama: ders → sınıf → {toplam, kayıt, öğrenci bazlı toplamlar}
  let newGrp = () => ({ sum:0, n:0, stu:{} });
  let addTo = (g, no, net) => {
    g.sum += net; g.n++;
    let s = g.stu[no] || (g.stu[no] = { sum:0, n:0 });
    s.sum += net; s.n++;
  };
  let subjMap = {}, usedRecords = 0, usedDates = new Set();
  ex.forEach(e => {
    let any = false;
    Object.keys(e.subs).forEach(k => {
      let v = e.subs[k];
      let net = v ? parseNumberStrict(v.net) : null;
      if(net === null) return;
      let sk = k.toLocaleLowerCase('tr-TR');
      let sm = subjMap[sk] || (subjMap[sk] = { all:newGrp(), byCls:{} });
      let cg = sm.byCls[e.studentClass] || (sm.byCls[e.studentClass] = newGrp());
      addTo(sm.all, e.studentNo, net);
      addTo(cg, e.studentNo, net);
      any = true;
    });
    if(any){ usedRecords++; usedDates.add(e.date); }
  });
  let subjKeys = Object.keys(subjMap).sort((a,b) => a.localeCompare(b,'tr'));
  if(!subjKeys.length){ r.innerHTML = '<div class="alert alert-default-warning">Bu filtreler için ders verisi bulunamadı.</div>'; return; }
  let clsSet = new Set();
  subjKeys.forEach(sk => Object.keys(subjMap[sk].byCls).forEach(c => clsSet.add(c)));
  let clsList = [...clsSet].sort((a,b) => a.localeCompare(b,'tr',{numeric:true}));
  let multi = clsList.length > 1;
  let stuAvgs = g => Object.keys(g.stu).map(no => g.stu[no].sum / g.stu[no].n);

  // ---- Standart fark (Hedges g): sınıf vs aynı dersteki diğer sınıflar
  let dMat = {}, cellList = [], spreadList = [], clsComp = {};
  subjKeys.forEach(sk => {
    let sm = subjMap[sk]; dMat[sk] = {};
    clsList.forEach(c => {
      dMat[sk][c] = null;
      let g = sm.byCls[c];
      if(!g || !multi) return;
      let own = stuAvgs(g), rest = [];
      clsList.forEach(o => { if(o !== c && sm.byCls[o]) rest = rest.concat(stuAvgs(sm.byCls[o])); });
      if(own.length < _SUBJ_ALL_MIN_N || rest.length < _SUBJ_ALL_MIN_N) return;
      let d = _statCohenD(own, rest);
      if(d === null || !isFinite(d)) return;
      dMat[sk][c] = d;
      cellList.push({ sk, c, d });
      let cc = clsComp[c] || (clsComp[c] = { sum:0, n:0 });
      cc.sum += d; cc.n++;
    });
    let ds = clsList.map(c => dMat[sk][c]).filter(v => v !== null);
    if(ds.length >= 2) spreadList.push({ sk, v: Math.max(...ds) - Math.min(...ds) });
  });
  let compList = clsList.filter(c => clsComp[c] && clsComp[c].n >= 2).map(c => ({ c, v: clsComp[c].sum / clsComp[c].n, n: clsComp[c].n })).sort((a,b) => b.v - a.v);

  // ---- Katılım oranı (Ders Analizi ile aynı mantık; ders şartı olmadan sınav bazında)
  let { baseCount, attendedCount, rate: partRate } = _calcParticipation({ examType: eT, lvl, br, date: dateFilterS });

  let lvlStr = (lvl ? `${lvl}. Sınıflar` : 'Tüm Sınıflar') + (br ? ` / ${br} Şubesi` : '');
  let dateCount = usedDates.size;

  // ---- Bilgi kartları
  let row1Html = `<div class="row g-2 sec-cards-row analysis-info-cards subject-info-cards mb-2">
      <div class="col-12 col-md-4 col-lg flex-fill mb-2"><div class="sec-card h-100"><div class="sec-icon"><i class="fas fa-users"></i></div><div class="sec-body"><div class="sec-label">Toplam Kayıt</div><div class="sec-value">${usedRecords} Sonuç</div></div></div></div>
      <div class="col-12 col-md-4 col-lg flex-fill mb-2"><div class="sec-card sec-neutral h-100"><div class="sec-icon"><i class="fas fa-chart-pie"></i></div><div class="sec-body"><div class="sec-label">Katılım Oranı</div><div class="sec-value">%${partRate}</div><div class="sec-sub">${attendedCount} / ${baseCount} Katılım</div></div></div></div>
      <div class="col-12 col-md-4 col-lg flex-fill mb-2"><div class="sec-card h-100"><div class="sec-icon"><i class="fas fa-table-cells"></i></div><div class="sec-body"><div class="sec-label">Kapsam</div><div class="sec-value">${subjKeys.length} Ders × ${clsList.length} Sınıf</div></div></div></div>
    </div>`;
  let row2Html = '';
  if(!br && compList.length >= 2){
    let best = compList[0], worst = compList[compList.length - 1];
    row2Html = `<div class="row g-2 sec-cards-row analysis-info-cards subject-info-cards mb-2">
      <div class="col-12 col-md-6 col-lg flex-fill mb-2"><div class="sec-card sec-pos h-100"><div class="sec-icon"><i class="fas fa-school"></i></div><div class="sec-body"><div class="sec-label">En Güçlü Sınıf (Bileşik)</div><div class="sec-value">${escapeHtml(best.c)}</div><div class="sec-sub">Bileşik g: ${_subjAllFmtD(best.v)} (${best.n} ders)</div></div></div></div>
      <div class="col-12 col-md-6 col-lg flex-fill mb-2"><div class="sec-card sec-neg h-100"><div class="sec-icon"><i class="fas fa-exclamation-circle"></i></div><div class="sec-body"><div class="sec-label">En Zayıf Sınıf (Bileşik)</div><div class="sec-value">${escapeHtml(worst.c)}</div><div class="sec-sub">Bileşik g: ${_subjAllFmtD(worst.v)} (${worst.n} ders)</div></div></div></div>
    </div>`;
  }

  // ---- İstatistik bloğu (yalnızca d hesaplanabildiyse)
  let statsHtml = '';
  if(cellList.length){
    let items = [];
    let hi = cellList.reduce((m,x) => x.d > m.d ? x : m, cellList[0]);
    let lo = cellList.reduce((m,x) => x.d < m.d ? x : m, cellList[0]);
    if(hi.d > 0) items.push(_trendStatItem(
      'Etki Büyüklüğü (En Yüksek)',
      `<span style="color:#198754;">g = ${_subjAllFmtD(hi.d)}</span>`,
      `${escapeHtml(hi.c)} · ${escapeHtml(toTitleCase(hi.sk))} — ${escapeHtml(_cohenLabel(hi.d))}`,
      "Bir sınıfın bir dersteki ortalamasının, aynı dersteki diğer sınıflardan en yüksek standart farkı (Hedges g).", ''));
    if(lo.d < 0) items.push(_trendStatItem(
      'Etki Büyüklüğü (En Düşük)',
      `<span style="color:#dc3545;">g = ${_subjAllFmtD(lo.d)}</span>`,
      `${escapeHtml(lo.c)} · ${escapeHtml(toTitleCase(lo.sk))} — ${escapeHtml(_cohenLabel(lo.d))}`,
      "Bir sınıfın bir dersteki ortalamasının, aynı dersteki diğer sınıflardan en düşük standart farkı (Hedges g).", ''));
    if(spreadList.length >= 2){
      let sMax = spreadList.reduce((m,x) => x.v > m.v ? x : m, spreadList[0]);
      let sMin = spreadList.reduce((m,x) => x.v < m.v ? x : m, spreadList[0]);
      items.push(_trendStatItem(
        'Sınıflar Arası Ayrışma (En Yüksek)',
        `<span class="text-warning">Δg = ${sMax.v.toFixed(2)}</span>`,
        escapeHtml(toTitleCase(sMax.sk)),
        "Dersin sınıflar arası en yüksek ve en düşük standart farkı arasındaki aralık. Büyükse sınıflar bu derste birbirinden belirgin ayrışır.", ''));
      items.push(_trendStatItem(
        'Sınıflar Arası Ayrışma (En Düşük)',
        `<span class="text-success">Δg = ${sMin.v.toFixed(2)}</span>`,
        escapeHtml(toTitleCase(sMin.sk)),
        "Sınıflar arası standart fark aralığının en dar olduğu ders; sınıflar bu derste birbirine en yakındır.", ''));
    }
    statsHtml = _trendStatBlock(items);
  }

  // ---- Matris tablosu
  let fmtN = v => v.toFixed(2);
  let nSub = n => `<div class="text-muted" style="font-size:.7em;line-height:1.1;">(${n})</div>`;
  let headCells = clsList.map(c => `<th class="text-center">${escapeHtml(c)}</th>`).join('') + (multi ? '<th class="text-center">Genel</th>' : '');
  let bodyRows = subjKeys.map(sk => {
    let sm = subjMap[sk];
    let tds = clsList.map(c => {
      let g = sm.byCls[c];
      if(!g || !g.n) return '<td class="text-center text-muted">—</td>';
      let heat = _subjAllHeat(dMat[sk][c]);
      return `<td class="text-center"${heat ? ` style="${heat}"` : ''}><strong>${fmtN(g.sum / g.n)}</strong>${nSub(g.n)}</td>`;
    }).join('');
    let gen = multi ? `<td class="text-center"><strong>${fmtN(sm.all.sum / sm.all.n)}</strong>${nSub(sm.all.n)}</td>` : '';
    return `<tr><td><strong>${escapeHtml(toTitleCase(sk))}</strong></td>${tds}${gen}</tr>`;
  }).join('');
  let compRow = '';
  if(compList.length){
    let cells = clsList.map(c => {
      let cc = clsComp[c];
      return (cc && cc.n >= 2) ? `<td class="text-center">${_subjAllFmtD(cc.sum / cc.n)}</td>` : '<td class="text-center">—</td>';
    }).join('');
    compRow = `<tr class="avg-row"><td>Bileşik Fark (ort. g)</td>${cells}${multi ? '<td class="text-center">—</td>' : ''}</tr>`;
  }
  let noteHtml = `<div class="text-muted small mt-2">Hücre değeri sınıfın o dersteki ortalama netidir; parantez içi kayıt sayısıdır. ${multi ? `Hücre rengi, sınıfın aynı dersteki diğer sınıflardan standart farkını gösterir (Hedges g; yeşil = yüksek, kırmızı = düşük; |d| ≥ 0.2 küçük, ≥ 0.5 orta, ≥ 0.8 büyük fark; renk ve g için sınıfta ve diğer sınıflarda en az ${_SUBJ_ALL_MIN_N} öğrenci gerekir). Bileşik fark, sınıfın derslerdeki g değerlerinin ortalamasıdır. ` : ''}Derslerin soru sayıları farklı olabileceğinden ham netler satırlar arasında değil, aynı satırdaki sınıflar arasında karşılaştırılmalıdır.</div>`;

  let reportName = safeFileName(`Tum_Dersler_Analizi`);
  r.innerHTML = `
    <div class="d-flex justify-content-end mb-2 no-print"><button class="btn-print no-print" onclick="xPR('pSubjAll',${jsArg(reportName)},this)"><i class='fas fa-print me-1'></i>Yazdır</button></div>
    <div id="pSubjAll" class="card shadow-sm report-card sa-report-primary sa-report-soft">
      <div class="report-header">
        <span class="report-title-main"><i class="fas fa-book-open me-2"></i><strong>Tüm Dersler</strong> — Ders Analizi</span>
        <span class="report-title-sub">${escapeHtml(eT)} | ${escapeHtml(lvlStr)} | Toplam ${dateCount} Sınav</span>
      </div>
      <div class="card-body report-card-body">
        ${row1Html}
        ${row2Html}
        ${statsHtml}
        <div class="table-responsive">
          <table class="table table-sm m-0 table-compact">
            <thead><tr><th>Ders</th>${headCells}</tr></thead>
            <tbody>${bodyRows}${compRow}</tbody>
          </table>
        </div>
        ${noteHtml}
        <div class="single-exam-chart-title chart-section-title"><i class="fas fa-chart-line"></i>Tüm Dersler — Sınıf Ortalamaları Grafiği</div>
        <div class="chart-box chart-box-lg mt-3 avoid-break"><canvas id="cA"></canvas></div>
      </div>
    </div>`;

  chartTimer = setTimeout(() => {
    let labels = subjKeys.map(sk => toTitleCase(sk));
    let datasets = clsList.map((cl, i) => ({
      label: cl,
      backgroundColor: cols[i % cols.length] + 'cc',
      borderColor: cols[i % cols.length],
      borderWidth: 1.5,
      data: subjKeys.map(sk => { let g = subjMap[sk].byCls[cl]; return (g && g.n) ? g.sum / g.n : null; })
    }));
    c.a = mkChart('cA', labels, datasets);
  }, 100);
}

function rAnl(){
  let aT=getEl('aType').value,eT=getEl('aEx').value, sb=getEl('aSub')?getEl('aSub').value:'', r=getEl('anlRes');
  if(aT === 'risk') return; // Risk analizi renderRiskPanel tarafından yönetilir
  if(c.a){ c.a.destroy(); c.a=null; } clearTimeout(chartTimer); 
  if(!eT){
    let missing = [];
    if((aT === 'class' || aT === 'subject' || aT === 'examdetail') && getEl('aLvl') && !getEl('aLvl').value) missing.push('sınıf seviyesini');
    if(aT === 'student' && !aNo) missing.push('öğrenciyi');
    missing.push('sınav türünü');
    r.innerHTML=`<div class="alert alert-default-info"><i class="fas fa-info-circle me-2"></i>Lütfen ${missing.join(' ve ')} seçiniz.</div>`;
    return;
  }
  // (placeholder kept; user must explicitly choose data type)
  if(aT==='examdetail' && !sb) { return; }

  if(aT==='student'){
    let no=aNo;if(!no){r.innerHTML='<div class="alert alert-default-info"><i class="fas fa-hand-point-up me-2"></i>Lütfen bir öğrenci seçin.</div>';return;}
    let ex=DB.e.filter(x=>x.studentNo===no&&x.examType===eT&&!x.abs).sort((a,b)=>srt(a.date,b.date)), st=getStuMap().get(no); if(!st){r.innerHTML='<div class="alert alert-default-warning"><i class="fas fa-exclamation-circle me-2"></i>Öğrenci verisi bulunamadı.</div>';return;}
    let stGrade=getGrade(st.class);
    let stNameSafe = escapeHtml(st.name);
    let stClassSafe = escapeHtml(st.class);
    let eTSafe = escapeHtml(eT);

    // === TEK SINAV MODU ===
    let _aExDateRaw = typeof getStudentExamDateValue === 'function' ? getStudentExamDateValue() : ((getEl('aExDate')||{}).value || '');
    if(_aExDateRaw){
      let[_seDate, _sePub=''] = _aExDateRaw.split('||');
      let curExam = ex.find(e => e.date === _seDate && (e.publisher||'') === _sePub);
      if(!curExam){
        r.innerHTML = `<div class="alert alert-warning"><i class="fas fa-info-circle me-2"></i>Seçilen sınav için bu öğrencinin verisi bulunamadı.</div>`;
        return;
      }
      let curIdx = ex.indexOf(curExam);
      let prevExam = curIdx > 0 ? ex[curIdx-1] : null;
      let subjects = Object.keys(curExam.subs || {}).sort();
      let _pubLbl  = curExam.publisher ? ` (${toTitleCase(curExam.publisher)})` : '';
      let _exLabel = (typeof toExamLabel==='function') ? toExamLabel(eT) : eT;
      let _pubLblSafe = escapeHtml(_pubLbl);
      let _exLabelSafe = escapeHtml(_exLabel);
      let curExamDateSafe = escapeHtml(curExam.date);

      // ==================== SINAV ÖZETİ (summary) ====================
      if(sb === 'summary' || sb === ''){
        let cardsHtml = buildSingleExamCards(st, eT, curExam, prevExam, stGrade);
        let riskHtml  = buildRiskInfoCards(no, eT, st.class);
        // Ders bazlı çubuk grafik verisi + Toplam Net
        let barSubjects = [...subjects];
        let stuVals = subjects.map(s => (curExam.subs[s] && curExam.subs[s].net !== undefined) ? curExam.subs[s].net : null);
        let clsVals = subjects.map(s => {
          let v = DB.e.filter(x => x.date===_seDate && (x.publisher||'')===_sePub && x.examType===eT && x.studentClass===st.class && !x.abs && x.subs[s]!==undefined).map(x => x.subs[s].net);
          return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null;
        });
        let insVals = subjects.map(s => {
          let v = DB.e.filter(x => x.date===_seDate && (x.publisher||'')===_sePub && x.examType===eT && getGrade(x.studentClass)===stGrade && !x.abs && x.subs[s]!==undefined).map(x => x.subs[s].net);
          return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null;
        });
        // Toplam Net ekleme
        barSubjects.push('Toplam Net');
        stuVals.push(curExam.totalNet !== undefined ? curExam.totalNet : null);
        let clsTN = DB.e.filter(x => x.date===_seDate && (x.publisher||'')===_sePub && x.examType===eT && x.studentClass===st.class && !x.abs).map(x => x.totalNet);
        clsVals.push(clsTN.length ? clsTN.reduce((a,b)=>a+b,0)/clsTN.length : null);
        let insTN = DB.e.filter(x => x.date===_seDate && (x.publisher||'')===_sePub && x.examType===eT && getGrade(x.studentClass)===stGrade && !x.abs).map(x => x.totalNet);
        insVals.push(insTN.length ? insTN.reduce((a,b)=>a+b,0)/insTN.length : null);

        // 1-A: Özet modunda Toplam Net için Z-skoru + yüzdelik dilim + katılım kartı
        let seExtraCardsHtml = '';
        {
          let _tnVal = curExam.totalNet;
          // Z-skoru ve yüzdelik dilim (sınıf)
          let _clsTNStd = _statStd(clsTN);
          let _clsTNMean = clsTN.length ? clsTN.reduce((a,b)=>a+b,0)/clsTN.length : null;
          let _clsTNZ = (_tnVal!==null && _clsTNMean!==null && _clsTNStd && _clsTNStd>0) ? ((_tnVal-_clsTNMean)/_clsTNStd) : null;
          let _clsTNF = (_tnVal!==null && _tnVal!==undefined && _clsTNMean!==null) ? (_tnVal - _clsTNMean) : null;
          let _clsTNPerc = (_tnVal!==null && clsTN.length >= 3) ? Math.round(clsTN.filter(v=>v<=_tnVal).length/clsTN.length*100) : null;
          // Z-skoru ve yüzdelik dilim (kurum)
          let _insTNStd = _statStd(insTN);
          let _insTNMean = insTN.length ? insTN.reduce((a,b)=>a+b,0)/insTN.length : null;
          let _insTNZ = (_tnVal!==null && _insTNMean!==null && _insTNStd && _insTNStd>0) ? ((_tnVal-_insTNMean)/_insTNStd) : null;
          let _insTNF = (_tnVal!==null && _tnVal!==undefined && _insTNMean!==null) ? (_tnVal - _insTNMean) : null;
          let _insTNPerc = (_tnVal!==null && insTN.length >= 3) ? Math.round(insTN.filter(v=>v<=_tnVal).length/insTN.length*100) : null;

          if(clsTN.length >= 3 || insTN.length >= 3) {
            let _clsZCls = _clsTNZ===null?'sec-neutral':(_clsTNZ>0?'sec-pos':(_clsTNZ<0?'sec-neg':'sec-neutral'));
            let _insZCls = _insTNZ===null?'sec-neutral':(_insTNZ>0?'sec-pos':(_insTNZ<0?'sec-neg':'sec-neutral'));
            let seStatsItems = [];
            if(clsTN.length >= 3) {
              seStatsItems.push(_statItem(
                'Sınıf İçi Konum',
                `${_clsTNZ!==null?_clsTNZ.toFixed(2)+'σ':'—'}`,
                `${_clsTNMean!==null?'Ort: '+_clsTNMean.toFixed(2):''}${_clsTNF!==null?' · Fark: '+(_clsTNF>0?'+':'')+_clsTNF.toFixed(2):''}${_clsTNPerc!==null?' · Top %'+(100-_clsTNPerc):''}`,
                'Z=0 ortalama; + değer ortalamanın üstünü, - değer altını gösterir.',
                _statTone(_clsZCls)
              ));
            }
            if(insTN.length >= 3) {
              seStatsItems.push(_statItem(
                'Kurum İçi Konum',
                `${_insTNZ!==null?_insTNZ.toFixed(2)+'σ':'—'}`,
                `${_insTNMean!==null?'Ort: '+_insTNMean.toFixed(2):''}${_insTNF!==null?' · Fark: '+(_insTNF>0?'+':'')+_insTNF.toFixed(2):''}${_insTNPerc!==null?' · Top %'+(100-_insTNPerc):''}`,
                'Z=0 ortalama; + değer ortalamanın üstünü, - değer altını gösterir.',
                _statTone(_insZCls)
              ));
            }
            seExtraCardsHtml += _statsBlock('', seStatsItems, 'fa-chart-bar');
          }
        }

        // Detay tablosu
        let rowsSE = subjects.map((s,i) => {
          let sn = curExam.subs[s];
          let net = sn ? sn.net : null;
          let dog = sn && sn.dogru !== undefined ? sn.dogru : '—';
          let yan = sn && sn.yanlis !== undefined ? sn.yanlis : '—';
          let clsA = clsVals[i], insA = insVals[i];
          let dCls = (net !== null && clsA !== null) ? (net - clsA) : null;
          let dIns = (net !== null && insA !== null) ? (net - insA) : null;
          let fmt = v => v === null ? '—' : (v>0?'+':'') + v.toFixed(2);
          let cls = v => v === null ? '' : (v > 0 ? 'text-success' : (v < 0 ? 'text-danger' : ''));
          return `<tr><td>${i+1}</td><td>${escapeHtml(toTitleCase(s))}</td><td>${escapeHtml(dog)}</td><td>${escapeHtml(yan)}</td><td><strong>${net===null?'—':net.toFixed(2)}</strong></td><td>${clsA===null?'—':clsA.toFixed(2)}</td><td class="${cls(dCls)} fw-bold">${fmt(dCls)}</td><td>${insA===null?'—':insA.toFixed(2)}</td><td class="${cls(dIns)} fw-bold">${fmt(dIns)}</td></tr>`;
        }).join('');
        // Toplam Net satırı (vurgulu)
        let _tnStu = curExam.totalNet, _tnCls = clsVals[clsVals.length-1], _tnIns = insVals[insVals.length-1];
        let _dTC = (_tnStu!==null&&_tnCls!==null)?(_tnStu-_tnCls):null, _dTI = (_tnStu!==null&&_tnIns!==null)?(_tnStu-_tnIns):null;
        let _fmtT = v => v===null?'—':(v>0?'+':'')+v.toFixed(2);
        let _clsT = v => v===null?'':(v>0?'text-success':(v<0?'text-danger':''));
        rowsSE += `<tr class="avg-row avg-row-strong"><td><strong>Σ</strong></td><td>Toplam Net</td><td>—</td><td>—</td><td><strong>${_tnStu!==null&&_tnStu!==undefined?_tnStu.toFixed(2):'—'}</strong></td><td>${_tnCls!==null?_tnCls.toFixed(2):'—'}</td><td class="${_clsT(_dTC)} fw-bold">${_fmtT(_dTC)}</td><td>${_tnIns!==null?_tnIns.toFixed(2):'—'}</td><td class="${_clsT(_dTI)} fw-bold">${_fmtT(_dTI)}</td></tr>`;

        let h = `<div class="d-flex justify-content-end mb-2 no-print"><button class="btn-print no-print" onclick="xPR('pS','Ogrenci_Tek_Sinav',this)"><i class='fas fa-print me-1'></i>Yazdır</button></div>
        <div id="pS" class="card shadow-sm">
          <div class="report-header">
            <span class="report-title-main"><i class="fas fa-file-alt me-2"></i><strong>${stNameSafe}</strong> — ${_exLabelSafe} (${curExamDateSafe}${_pubLblSafe})</span>
            <span class="report-title-sub">Sınıf: ${stClassSafe}</span>
          </div>
          <div class="card-body report-card-body-spacious">
            <div class="single-exam-cards">${cardsHtml}</div>
            ${seExtraCardsHtml}
            ${riskHtml}
            <div class="single-exam-table-part">
              <div class="scroll-hint"><i class="fas fa-arrows-alt-h me-1"></i>Tabloyu kaydırın</div>
              <div class="table-responsive"><table class="table table-sm table-hover table-bordered" id="tS"><thead><tr><th>#</th><th>Ders</th><th>D</th><th>Y</th><th>Net</th><th>Sınıf Ort.</th><th>Sınıf Fark</th><th>Kurum Ort.</th><th>Kurum Fark</th></tr></thead><tbody>${rowsSE}</tbody></table></div>
            </div>
            <div class="single-exam-chart-part">
              <div class="single-exam-chart-title chart-section-title"><i class="fas fa-chart-bar"></i>Ders Bazlı Net Karşılaştırması</div>
              <div class="chart-box chart-box-xl avoid-break"><canvas id="cA"></canvas></div>
            </div>
          </div>
        </div>`;
        r.innerHTML = h;
        chartTimer = setTimeout(() => {
          c.a = mkChart('cA', barSubjects.map(toTitleCase),[
            {label:'Öğrenci',    data: stuVals, backgroundColor: cols[0]+'cc', borderColor: cols[0], borderWidth: 1.5},
            {label:'Sınıf Ort.', data: clsVals, backgroundColor: cols[2]+'99', borderColor: cols[2], borderWidth: 1.5},
            {label:'Kurum Ort.', data: insVals, backgroundColor: cols[3]+'99', borderColor: cols[3], borderWidth: 1.5}
          ], false);
        }, 100);
        return;

      // ==================== TEK DERS MODU (s_matematik vb.) ====================
      } else if(sb.startsWith('s_')){
        let subjKey = toTitleCase(sb.replace('s_',''));
        let subjLower = sb.replace('s_','');
        let sn = curExam.subs ? curExam.subs[subjLower] || curExam.subs[subjKey] : null;
        let net = sn ? sn.net : null;
        let dog = sn && sn.dogru !== undefined ? sn.dogru : null;
        let yan = sn && sn.yanlis !== undefined ? sn.yanlis : null;
        let bos = (dog !== null && yan !== null && sn.total) ? (sn.total - dog - yan) : null;

        // Sınıf & Kurum ortalamaları
        let _sKey = subjLower;
        let _findSub = (e) => e.subs[_sKey] || e.subs[subjKey] || null;
        let cvNets = DB.e.filter(x => x.date===_seDate && (x.publisher||'')===_sePub && x.examType===eT && x.studentClass===st.class && !x.abs && _findSub(x)).map(x => _findSub(x).net);
        let ivNets = DB.e.filter(x => x.date===_seDate && (x.publisher||'')===_sePub && x.examType===eT && getGrade(x.studentClass)===stGrade && !x.abs && _findSub(x)).map(x => _findSub(x).net);
        let clsA = cvNets.length ? cvNets.reduce((a,b)=>a+b,0)/cvNets.length : null;
        let insA = ivNets.length ? ivNets.reduce((a,b)=>a+b,0)/ivNets.length : null;

        // Z-skoru
        let _std = (arr) => { if(arr.length<2) return null; let m=arr.reduce((a,b)=>a+b,0)/arr.length; let v=arr.reduce((a,b)=>a+(b-m)*(b-m),0)/(arr.length-1); return Math.sqrt(v); };
        let clsStd = _std(cvNets), insStd = _std(ivNets);
        let clsZ = (net!==null && clsA!==null && clsStd && clsStd>0) ? ((net-clsA)/clsStd) : null;
        let insZ = (net!==null && insA!==null && insStd && insStd>0) ? ((net-insA)/insStd) : null;

        // Yüzdelik dilim
        let clsPerc = (net!==null && cvNets.length>1) ? Math.round(cvNets.filter(v=>v<=net).length/cvNets.length*100) : null;
        let insPerc = (net!==null && ivNets.length>1) ? Math.round(ivNets.filter(v=>v<=net).length/ivNets.length*100) : null;

        // Önceki sınavdan fark
        let prevNet = null;
        if(prevExam){
          let _ps = prevExam.subs ? (prevExam.subs[_sKey] || prevExam.subs[subjKey]) : null;
          prevNet = _ps ? _ps.net : null;
        }
        let delta = (net!==null && prevNet!==null) ? (net-prevNet) : null;
        let dSign = delta!==null ? (delta>0?'+':'') : '';
        let dCls = delta===null?'sec-neutral':(delta>0?'sec-pos':(delta<0?'sec-neg':'sec-neutral'));
        let dIcon = delta===null?'fa-minus':(delta>0?'fa-arrow-up':(delta<0?'fa-arrow-down':'fa-minus'));

        // Kartlar
        let card1 = `<div class="col-12 col-md-3"><div class="sec-card">
          <div class="sec-icon"><i class="fas fa-book"></i></div>
          <div class="sec-body"><div class="sec-label">${escapeHtml(subjKey)} Neti</div>
          <div class="sec-value">${net!==null?net.toFixed(2):'—'}</div>
          <div class="sec-sub">${dog!==null?'D:'+dog+' Y:'+yan+(bos!==null?' B:'+bos:''):'Detay yok'}</div>
          </div></div></div>`;

        let subjectDeltaItem = _statItem(
          'Önceki Sınava Fark',
          `${delta!==null?dSign+delta.toFixed(2):'—'} <small class="sec-unit">net</small>`,
          `${prevNet!==null?'Önceki: '+prevNet.toFixed(2):'Önceki veri yok'}`,
          'Seçili derste önceki sınava göre net değişimi.',
          _statTone(dCls)
        );

        let _fC = (net!==null&&clsA!==null)?(net-clsA):null;
        let _fI = (net!==null&&insA!==null)?(net-insA):null;
        let _fCs = _fC===null?'sec-neutral':(_fC>0?'sec-pos':(_fC<0?'sec-neg':'sec-neutral'));
        let _fIs = _fI===null?'sec-neutral':(_fI>0?'sec-pos':(_fI<0?'sec-neg':'sec-neutral'));
        let subjectStatsHtml = _statsBlock('', [
          subjectDeltaItem,
          _statItem(
            'Sınıf İçi Konum',
            `${clsZ!==null?clsZ.toFixed(2)+'σ':'—'}`,
            `${clsA!==null?'Ort: '+clsA.toFixed(2):''}${_fC!==null?' · Fark: '+(_fC>0?'+':'')+_fC.toFixed(2):''}${clsPerc!==null?' · Top %'+(100-clsPerc):''}`,
            'Z=0 ortalama; + değer ortalamanın üstünü, - değer altını gösterir.',
            _statTone(_fCs)
          ),
          _statItem(
            'Kurum İçi Konum',
            `${insZ!==null?insZ.toFixed(2)+'σ':'—'}`,
            `${insA!==null?'Ort: '+insA.toFixed(2):''}${_fI!==null?' · Fark: '+(_fI>0?'+':'')+_fI.toFixed(2):''}${insPerc!==null?' · Top %'+(100-insPerc):''}`,
            'Z=0 ortalama; + değer ortalamanın üstünü, - değer altını gösterir.',
            _statTone(_fIs)
          )
        ], 'fa-chart-bar');

        // D/Y/B dağılım barı
        let dybBar = '';
        if(dog!==null && yan!==null && sn.total){
          let pD=Math.round(dog/sn.total*100), pY=Math.round(yan/sn.total*100), pB=100-pD-pY;
          dybBar = `<div class="single-exam-chart-title chart-section-title dyb-title-offset"><i class="fas fa-tasks"></i>Doğru / Yanlış / Boş Dağılımı</div>
          <div class="dyb-bar">
            <div class="dyb-segment correct" style="--dyb-width:${pD}%;">${dog} D (${pD}%)</div>
            <div class="dyb-segment wrong" style="--dyb-width:${pY}%;">${yan} Y (${pY}%)</div>
            <div class="dyb-segment blank" style="--dyb-width:${pB}%;">${bos!==null?bos:'?'} B (${pB}%)</div>
          </div>`;
        }


        // Tek ders çubuk grafik (öğrenci vs sınıf vs kurum — sadece bu ders)
        let singleBarHtml = `<div class="single-exam-chart-title chart-section-title"><i class="fas fa-chart-bar"></i>${escapeHtml(subjKey)} — Karşılaştırma</div>
          <div class="chart-box chart-box-md avoid-break"><canvas id="cA"></canvas></div>`;

        let h = `<div class="d-flex justify-content-end mb-2 no-print"><button class="btn-print no-print" onclick="xPR('pS','Ogrenci_Ders',this)"><i class='fas fa-print me-1'></i>Yazdır</button></div>
        <div id="pS" class="card shadow-sm">
          <div class="report-header">
            <span class="report-title-main"><i class="fas fa-book-open me-2"></i><strong>${stNameSafe}</strong> — ${escapeHtml(subjKey)} (${curExamDateSafe}${_pubLblSafe})</span>
            <span class="report-title-sub">Sınıf: ${stClassSafe} | ${_exLabelSafe}</span>
          </div>
          <div class="card-body report-card-body-spacious">
            <div class="row g-2 sec-cards-row analysis-info-cards single-exam-info-cards">${card1}</div>
            ${subjectStatsHtml}
            ${dybBar}
            ${singleBarHtml}
          </div>
        </div>`;
        r.innerHTML = h;

        // Trend grafik: bu dersin tüm sınavlardaki neti
        chartTimer = setTimeout(() => {
          let trendExams = ex.filter(e => { let _s = e.subs ? (e.subs[_sKey]||e.subs[subjKey]) : null; return _s && _s.net !== null && _s.net !== undefined; });
          let tLabels = trendExams.map(e => e.publisher ? `${e.date} (${toTitleCase(e.publisher)})` : e.date);
          let tStuData = trendExams.map(e => { let _s = e.subs[_sKey]||e.subs[subjKey]; return _s.net; });
          let tClsData = trendExams.map(e => {
            let cv = DB.e.filter(x => x.date===e.date && (x.publisher||'')===(e.publisher||'') && x.examType===eT && x.studentClass===st.class && !x.abs && _findSub(x)).map(x=>_findSub(x).net);
            return cv.length ? cv.reduce((a,b)=>a+b,0)/cv.length : null;
          });
          let tInsData = trendExams.map(e => {
            let iv = DB.e.filter(x => x.date===e.date && (x.publisher||'')===(e.publisher||'') && x.examType===eT && getGrade(x.studentClass)===stGrade && !x.abs && _findSub(x)).map(x=>_findSub(x).net);
            return iv.length ? iv.reduce((a,b)=>a+b,0)/iv.length : null;
          });
          c.a = mkChart('cA', tLabels,[
            {label:'Öğrenci', data:tStuData, backgroundColor:cols[0]+'cc', borderColor:cols[0], borderWidth:1.5},
            {label:'Sınıf Ort.', data:tClsData, backgroundColor:cols[2]+'99', borderColor:cols[2], borderWidth:1.5},
            {label:'Kurum Ort.', data:tInsData, backgroundColor:cols[3]+'99', borderColor:cols[3], borderWidth:1.5}
          ], false);
        }, 100);
        return;

      // ==================== TOPLAM NET / PUAN / SIRALAMA MODU ====================
      } else {
        let isRank = sb.startsWith('rank_');
        let ls = sb === 'score' ? 'Puan' : (sb === 'rank_c' ? 'Sınıf Sırası' : (sb === 'rank_i' ? 'Kurum Sırası' : (sb === 'rank_g' ? 'Genel Sıra' : 'Toplam Net')));
        let getValSE = (e) => { if(e.abs) return null; if(sb==='score') return e.score; if(sb==='rank_c') return pN(e.cR); if(sb==='rank_i') return pN(e.iR); if(sb==='rank_g') return pN(e.gR); return e.totalNet; };
        let curVal = getValSE(curExam);
        let prevVal = prevExam ? getValSE(prevExam) : null;
        let delta = (curVal!==null && prevVal!==null) ? (isRank ? (prevVal-curVal) : (curVal-prevVal)) : null;
        let dSign = delta!==null ? (delta>0?'+':'') : '';
        let dCls = delta===null?'sec-neutral':(delta>0?'sec-pos':(delta<0?'sec-neg':'sec-neutral'));
        let dIcon = delta===null?'fa-minus':(delta>0?'fa-arrow-up':(delta<0?'fa-arrow-down':'fa-minus'));

        // Sınıf & Kurum ortalamaları
        let cvAll = DB.e.filter(x => x.date===_seDate && (x.publisher||'')===_sePub && x.examType===eT && x.studentClass===st.class && !x.abs).map(getValSE).filter(v=>v!==null);
        let ivAll = DB.e.filter(x => x.date===_seDate && (x.publisher||'')===_sePub && x.examType===eT && getGrade(x.studentClass)===stGrade && !x.abs).map(getValSE).filter(v=>v!==null);
        let _clsRaw = cvAll.length ? cvAll.reduce((a,b)=>a+b,0)/cvAll.length : null;
        let _insRaw = ivAll.length ? ivAll.reduce((a,b)=>a+b,0)/ivAll.length : null;
        let clsA = (isRank && _clsRaw!==null) ? Math.round(_clsRaw) : _clsRaw;
        let insA = (isRank && _insRaw!==null) ? Math.round(_insRaw) : _insRaw;

        let _std = (arr) => { if(arr.length<2) return null; let m=arr.reduce((a,b)=>a+b,0)/arr.length; let v=arr.reduce((a,b)=>a+(b-m)*(b-m),0)/(arr.length-1); return Math.sqrt(v); };
        let clsZ = null, insZ = null;
        if(!isRank && curVal!==null){
          let cs = _std(cvAll), is2 = _std(ivAll);
          clsZ = (_clsRaw!==null&&cs&&cs>0)?((curVal-_clsRaw)/cs):null;
          insZ = (_insRaw!==null&&is2&&is2>0)?((curVal-_insRaw)/is2):null;
        }
        let clsPerc = (!isRank && curVal!==null && cvAll.length>1) ? Math.round(cvAll.filter(v=> (isRank?(v>=curVal):(v<=curVal)) ).length/cvAll.length*100) : null;
        let insPerc = (!isRank && curVal!==null && ivAll.length>1) ? Math.round(ivAll.filter(v=> (isRank?(v>=curVal):(v<=curVal)) ).length/ivAll.length*100) : null;

        let fmtV = v => v===null?'—':(isRank?String(Math.round(v)):v.toFixed(2));

        let card1 = `<div class="col-12 col-md-3"><div class="sec-card">
          <div class="sec-icon"><i class="fas fa-star"></i></div>
          <div class="sec-body"><div class="sec-label">${escapeHtml(ls)}</div>
          <div class="sec-value">${fmtV(curVal)}</div>
          <div class="sec-sub">${curExamDateSafe}${_pubLblSafe}</div>
          </div></div></div>`;

        let metricDeltaItem = _statItem(
          'Önceki Sınava Fark',
          `${delta!==null?dSign+(isRank?delta:delta.toFixed(2)):'—'}`,
          `${prevVal!==null?'Önceki: '+fmtV(prevVal):'Önceki veri yok'}`,
          'Seçili ölçütte önceki sınava göre değişim. Sıra ölçütlerinde pozitif değer iyileşmeyi gösterir.',
          _statTone(dCls)
        );

        let _fC = (!isRank&&curVal!==null&&clsA!==null)?(curVal-clsA):null;
        let _fI = (!isRank&&curVal!==null&&insA!==null)?(curVal-insA):null;
        let _fCs2 = _fC===null?'sec-neutral':(_fC>0?'sec-pos':(_fC<0?'sec-neg':'sec-neutral'));
        let _fIs2 = _fI===null?'sec-neutral':(_fI>0?'sec-pos':(_fI<0?'sec-neg':'sec-neutral'));

        let metricStatsHtml = _statsBlock('', [
          metricDeltaItem,
          _statItem(
            isRank ? 'Sınıf Ortalama Sıra' : 'Sınıf İçi Konum',
            isRank ? `${clsA!==null?fmtV(clsA):'—'} <small class="sec-unit-muted">ort</small>` : `${clsZ!==null?clsZ.toFixed(2)+'σ':'—'}`,
            isRank ? `${cvAll.length} öğrenci · düşük sıra daha iyi` : `${clsA!==null?'Ort: '+fmtV(clsA):''}${_fC!==null?' · Fark: '+(_fC>0?'+':'')+_fC.toFixed(2):''}${clsPerc!==null?' · Top %'+(100-clsPerc):''}`,
            isRank ? 'Z-skoru değildir; sınıftaki sıra değerlerinin ortalamasıdır.' : 'Z=0 ortalama; + değer ortalamanın üstünü, - değer altını gösterir.',
            _statTone(_fCs2)
          ),
          _statItem(
            isRank ? 'Kurum Ortalama Sıra' : 'Kurum İçi Konum',
            isRank ? `${insA!==null?fmtV(insA):'—'} <small class="sec-unit-muted">ort</small>` : `${insZ!==null?insZ.toFixed(2)+'σ':'—'}`,
            isRank ? `${ivAll.length} öğrenci · düşük sıra daha iyi` : `${insA!==null?'Ort: '+fmtV(insA):''}${_fI!==null?' · Fark: '+(_fI>0?'+':'')+_fI.toFixed(2):''}${insPerc!==null?' · Top %'+(100-insPerc):''}`,
            isRank ? 'Z-skoru değildir; kurumdaki sıra değerlerinin ortalamasıdır.' : 'Z=0 ortalama; + değer ortalamanın üstünü, - değer altını gösterir.',
            _statTone(_fIs2)
          )
        ], 'fa-chart-bar');

        let h = `<div class="d-flex justify-content-end mb-2 no-print"><button class="btn-print no-print" onclick="xPR('pS','Ogrenci_Veri',this)"><i class='fas fa-print me-1'></i>Yazdır</button></div>
        <div id="pS" class="card shadow-sm">
          <div class="report-header">
            <span class="report-title-main"><i class="fas fa-chart-line me-2"></i><strong>${stNameSafe}</strong> — ${escapeHtml(ls)} (${curExamDateSafe}${_pubLblSafe})</span>
            <span class="report-title-sub">Sınıf: ${stClassSafe} | ${_exLabelSafe}</span>
          </div>
          <div class="card-body report-card-body-spacious">
            <div class="row g-2 sec-cards-row analysis-info-cards single-exam-info-cards">${card1}</div>
            ${metricStatsHtml}
            <div class="single-exam-chart-title chart-section-title"><i class="fas fa-chart-line"></i>${escapeHtml(ls)} — Sınav Trend</div>
            <div class="chart-box chart-box-xl avoid-break"><canvas id="cA"></canvas></div>
          </div>
        </div>`;
        r.innerHTML = h;

        chartTimer = setTimeout(() => {
          let tLabels = ex.map(e => e.publisher ? `${e.date} (${toTitleCase(e.publisher)})` : e.date);
          let tData = ex.map(getValSE);
          let datasets =[{label:ls, data:tData, backgroundColor:cols[0]+'cc', borderColor:cols[0], borderWidth:1.5}];
          if(!isRank){
            let tCls = ex.map(e => { let cv=DB.e.filter(x=>x.date===e.date&&(x.publisher||'')===(e.publisher||'')&&x.examType===eT&&x.studentClass===st.class&&!x.abs).map(getValSE).filter(v=>v!==null); return cv.length?cv.reduce((a,b)=>a+b,0)/cv.length:null; });
            let tIns = ex.map(e => { let iv=DB.e.filter(x=>x.date===e.date&&(x.publisher||'')===(e.publisher||'')&&x.examType===eT&&getGrade(x.studentClass)===stGrade&&!x.abs).map(getValSE).filter(v=>v!==null); return iv.length?iv.reduce((a,b)=>a+b,0)/iv.length:null; });
            datasets.push({label:'Sınıf Ort.', data:tCls, backgroundColor:cols[2]+'99', borderColor:cols[2], borderWidth:1.5});
            datasets.push({label:'Kurum Ort.', data:tIns, backgroundColor:cols[3]+'99', borderColor:cols[3], borderWidth:1.5});
          }
          c.a = mkChart('cA', tLabels, datasets, isRank);
        }, 100);
        return;
      }
    }
    // === TÜM SINAVLAR MODU ===
    let dD=[],clsArr=[],instArr=[],rows='';
    
    let isRank = sb.startsWith('rank_');
    let ls = sb === 'score' ? 'Puan' : (sb === 'rank_c' ? 'Sınıf Sırası' : (sb === 'rank_i' ? 'Kurum Sırası' : (sb === 'rank_g' ? 'Genel Sıra' : (sb === 'totalNet' || !sb ? 'Toplam Net' : toTitleCase(sb.replace('s_','')) + ' Neti'))));
    let valHeader = isRank ? 'Sıra' : (sb === 'score' ? 'Puan' : 'Net');
    let getVal = (e) => { if (e.abs) return null; if (sb === 'score') return e.score; if (sb === 'rank_c') return pN(e.cR); if (sb === 'rank_i') return pN(e.iR); if (sb === 'rank_g') return pN(e.gR); if (sb === 'totalNet' || !sb) return e.totalNet; let _sn = e.subs[toTitleCase(sb.replace('s_',''))]; return (_sn !== undefined && _sn !== null) ? _sn.net : null; };

    ex.forEach((e,i)=>{
      let n=getVal(e), pn=i>0 ? getVal(ex[i-1]) : n; let dfStr = '', cl = '';
      if(i > 0) {
        if(n === null || pn === null) { dfStr = '—'; }
        else if(isRank) { let df = pn - n; cl = df > 0 ? 'text-success' : (df < 0 ? 'text-danger' : ''); dfStr = df > 0 ? '+' + df : df; }
        else { let df = (n - pn).toFixed(2); cl = parseFloat(df) > 0 ? 'text-success' : (parseFloat(df) < 0 ? 'text-danger' : ''); dfStr = parseFloat(df) > 0 ? '+' + df : df; }
      } else { dfStr = '-'; }
      let pub = e.publisher || '—';
      let nDisplay = n === null ? '—' : (isRank ? n : n.toFixed(2));
      rows+=`<tr><td>${i+1}</td><td>${escapeHtml(e.date)}</td><td>${escapeHtml(toTitleCase(pub))}</td><td>${escapeHtml(nDisplay)}</td><td class="${cl} fw-bold">${escapeHtml(dfStr)}</td></tr>`; dD.push(n);
      if(!isRank){
        let cn=DB.e.filter(x=>x.date===e.date&&x.examType===eT&&x.studentClass===st.class&&!x.abs).map(getVal).filter(v=>v!==null);
        clsArr.push(cn.length?(cn.reduce((a,b)=>a+b,0)/cn.length):null);
        let iv=DB.e.filter(x=>x.date===e.date&&x.examType===eT&&!x.abs&&getGrade(x.studentClass)===stGrade).map(getVal).filter(v=>v!==null);
        instArr.push(iv.length?(iv.reduce((a,b)=>a+b,0)/iv.length):null);
      }
    });

    let dDValid = dD.filter(v => v !== null && !isNaN(v));

    let avgRowHtml = '';
    if(dDValid.length > 0){ 
      let stuAvg = dDValid.reduce((a,b)=>a+b,0) / dDValid.length;
      let clsAvg = clsArr.filter(x=>x!==null).length > 0 ? clsArr.filter(x=>x!==null).reduce((a,b)=>a+b,0) / clsArr.filter(x=>x!==null).length : null;
      let genAvg = instArr.filter(x=>x!==null).length > 0 ? instArr.filter(x=>x!==null).reduce((a,b)=>a+b,0) / instArr.filter(x=>x!==null).length : null;
      let displayStu = isRank ? Math.round(stuAvg) : stuAvg.toFixed(2);
      let displayCls = clsAvg !== null ? (isRank ? Math.round(clsAvg) : clsAvg.toFixed(2)) : '—';
      let displayGen = genAvg !== null ? (isRank ? Math.round(genAvg) : genAvg.toFixed(2)) : '—';
      avgRowHtml = `<tr class="avg-row"><td colspan="3" class="avg-label">Öğrenci Ortalama</td><td>${displayStu}</td><td>—</td></tr><tr class="avg-row"><td colspan="3" class="avg-label">Sınıf Ortalama (${stClassSafe})</td><td>${displayCls}</td><td>—</td></tr><tr class="avg-row"><td colspan="3" class="avg-label">Kurum Ortalama (${escapeHtml(stGrade)}. Sınıflar)</td><td>${displayGen}</td><td>—</td></tr>`;
    }

    // sb'ye göre görünen metrik etiketi — istatistik kartlarında ve trend bloğunda kullanılır
    let _metricLabel = sb === 'score' ? 'Puan'
                     : sb.startsWith('s_') ? toTitleCase(sb.replace('s_','')) + ' Neti'
                     : 'Net'; // totalNet ve boş için

    let karneCardsHtml = '';
    let stuRiskHtml = '';
    if(!isRank) {
      try {
        // calcKarneSummaryCards artık sb parametresi alıyor; seçilen metriği kullanır
        let _summary = calcKarneSummaryCards(no, eT, stGrade, ex, sb);
        if(_summary) {
          karneCardsHtml = buildKarneExamCards(_summary, eT, _metricLabel);
        }
      } catch(e){ console.error('[rAnl karneCards]', e); }
      try { stuRiskHtml = buildRiskInfoCards(no, eT, st.class) || ''; } catch(e){ stuRiskHtml = ''; }
    }

    let perfHtml = '';
    if(isRank && dDValid.length > 0) {
      // Sıralama modunda En İyi / En Kötü / Ortalama Sıra kartları (karneCardsHtml boş olduğu için bunlar gösterilir)
      let bestRank = Math.min(...dDValid);
      let worstRank = Math.max(...dDValid);
      let avgRank = Math.round(dDValid.reduce((a,b)=>a+b,0)/dDValid.length);
      let gradeExamKeys2 = new Set();
      DB.e.forEach(x => { if(x.examType===eT && getGrade(x.studentClass)===stGrade) gradeExamKeys2.add(x.date+'||'+(x.publisher||'')); });
      let totalGradeExams2 = gradeExamKeys2.size;
      let attendedKeys2 = new Set();
      DB.e.forEach(x => { if(x.studentNo===no && x.examType===eT && !x.abs) attendedKeys2.add(x.date+'||'+(x.publisher||'')); });
      let attendedCnt2 = attendedKeys2.size;
      let partRate2 = totalGradeExams2 > 0 ? Math.max(0, Math.min(100, Math.round(attendedCnt2 / totalGradeExams2 * 100))) : 0;
      perfHtml = `<div class="row g-2 sec-cards-row analysis-info-cards single-exam-info-cards mt-3 mb-2">
        <div class="col-12 col-md-3"><div class="sec-card sec-pos"><div class="sec-icon"><i class="fas fa-trophy"></i></div><div class="sec-body"><div class="sec-label">En İyi Sıra</div><div class="sec-value">${bestRank}</div><div class="sec-sub">Düşük = daha iyi</div></div></div></div>
        <div class="col-12 col-md-3"><div class="sec-card sec-neg"><div class="sec-icon"><i class="fas fa-arrow-down"></i></div><div class="sec-body"><div class="sec-label">En Kötü Sıra</div><div class="sec-value">${worstRank}</div></div></div></div>
        <div class="col-12 col-md-3"><div class="sec-card"><div class="sec-icon"><i class="fas fa-balance-scale"></i></div><div class="sec-body"><div class="sec-label">Ortalama Sıra</div><div class="sec-value">${avgRank}</div></div></div></div>
        <div class="col-12 col-md-3"><div class="sec-card"><div class="sec-icon"><i class="fas fa-percentage"></i></div><div class="sec-body"><div class="sec-label">Katılım</div><div class="sec-value">${partRate2}%</div><div class="sec-sub">${attendedCnt2}/${totalGradeExams2} Sınav</div></div></div></div>
      </div>`;
    }

    let h=`<div class="d-flex justify-content-end mb-2 no-print"><button class="btn-print no-print" onclick="xPR('pS','Ogrenci_Analizi',this)"><i class='fas fa-print me-1'></i>Yazdır</button></div>
    <div id="pS" class="card shadow-sm report-card sa-report-info">
      <div class="report-header">
        <span class="report-title-main"><i class="fas fa-chart-line me-2"></i><strong>${stNameSafe}</strong> — Analiz (${escapeHtml(ls)})</span>
        <span class="report-title-sub">Sınıf: ${stClassSafe} | ${eTSafe}</span>
      </div>
      <div class="card-body report-card-body">
        ${karneCardsHtml}${stuRiskHtml}${perfHtml}
        <div id="stuBoxPlotArea"></div>
        <div class="single-exam-table-part analysis-table-part">
          <div class="scroll-hint"><i class="fas fa-arrows-alt-h me-1"></i>Tabloyu kaydırın</div>
          <div class="table-responsive"><table class="table table-sm table-hover table-bordered" id="tS"><thead><tr><th>#</th><th>Tarih</th><th>Yayınevi</th><th>${valHeader}</th><th>Değişim</th></tr></thead><tbody>${rows}${avgRowHtml}</tbody></table></div>
        </div>
        <div class="single-exam-chart-title chart-section-title"><i class="fas fa-chart-line"></i>${escapeHtml(ls)} — Gelişim Grafiği</div>
        <div class="chart-box chart-box-top avoid-break"><canvas id="cA"></canvas></div>
      </div>
    </div>`;
    r.innerHTML=h;
    
    chartTimer=setTimeout(()=>{ 
      let chartLabels = ex.map(e => e.publisher ? `${e.date} (${toTitleCase(e.publisher)})` : e.date);
      let datasets =[{label:`Öğrenci ${ls}`,data:dD,backgroundColor:cols[0]+'cc',borderColor:cols[0],borderWidth:1.5}];
      if(!isRank){ datasets.push({label:'Sınıf Ort.',data:clsArr,backgroundColor:cols[2]+'99',borderColor:cols[2],borderWidth:1.5}); datasets.push({label:'Kurum Ort. ('+stGrade+'.Sınıf)',data:instArr,backgroundColor:cols[3]+'99',borderColor:cols[3],borderWidth:1.5}); }
      c.a=mkChart('cA',chartLabels,datasets,isRank);
      if(!isRank && dDValid.length >= 10) {
        let bpArea = getEl('stuBoxPlotArea');
        if(bpArea) bpArea.innerHTML = buildStuBoxPlots(no, eT, st.class, stGrade, sb);
      }
    },100);

  }else if(aT==='class'){
    let l=getEl('aLvl').value, b=getBrVal(), dateFilter = typeof getAnalysisDateValue === 'function' ? getAnalysisDateValue() : (getEl('aDate') ? getEl('aDate').value : '');
    let ex=DB.e.filter(x=>{
      if(x.examType!==eT||x.abs) return false;
      let parts = getClassParts(x.studentClass); if(!parts.grade || !parts.branch) return false;
      if(l&&l!==parts.grade) return false;
      if(b&&b!==parts.branch) return false;
      if(!_hasMetric(x, sb)) return false; // dersi içermeyen kayıt 0 net sayılmaz
      return true;
    }), d={};
    ex.forEach(e=>{ 
      if(dateFilter && e.date!==dateFilter) return;
      (d[e.date]=d[e.date]||[]).push(e); 
    });
    // Tek sınav seçiliyse ortalamalar ve karşılaştırmalar yalnızca o sınavın kayıtlarından hesaplanır
    // (ex tüm tarihleri içerir; yalnızca d tarihe göre süzülüyordu → "Ortalama" satırları tüm sınavların ortalamasını gösteriyordu).
    let exSel = dateFilter ? ex.filter(x => x.date === dateFilter) : ex;
    let sd=Object.keys(d).sort(srt),cs=new Set(),tr=[], ls = sb === 'score' ? 'Puan' : (sb === 'totalNet' || !sb ? 'Toplam Net' : toTitleCase(sb.replace('s_','')) + ' Neti');

    let cIdx = 1;
    sd.forEach(dt=>{ 
      let cl={}; d[dt].forEach(e=>(cl[e.studentClass]=cl[e.studentClass]||[]).push(e)); 
      Object.keys(cl).sort().forEach(cc=>{ 
        cs.add(cc); 
        let n=cl[cc].map(x=>{ if(sb === 'score') return x.score; if(sb === 'totalNet' || !sb) return x.totalNet; return x.subs[toTitleCase(sb.replace('s_',''))]?.net || 0; }); 
        let pub = cl[cc][0]?.publisher || '—'; tr.push(`<tr><td>${cIdx++}</td><td>${escapeHtml(cc)}</td><td>${escapeHtml(dt)}</td><td>${escapeHtml(toTitleCase(pub))}</td><td>${n.length?(n.reduce((x,y)=>x+y,0)/n.length).toFixed(2):0}</td></tr>`); 
      }); 
    });

    let lvlForAvg = l || (exSel.length > 0 ? getGrade(exSel[0].studentClass) : ''), exForAvg = lvlForAvg ? exSel.filter(x => getGrade(x.studentClass) === lvlForAvg) : exSel;
    let allVals = exForAvg.map(x=>{ if(sb==='score')return x.score; if(sb==='totalNet'||!sb)return x.totalNet; return x.subs[toTitleCase(sb.replace('s_',''))]?.net||0; });
    let classAvgRows = '', sortedClasses = [...cs].sort();
    sortedClasses.forEach(clsName => {
      let clsExams = exSel.filter(x => x.studentClass === clsName), clsVals = clsExams.map(x => { if(sb==='score')return x.score; if(sb==='totalNet'||!sb)return x.totalNet; return x.subs[toTitleCase(sb.replace('s_',''))]?.net||0; });
      if(clsVals.length > 0) { let clsAvg = (clsVals.reduce((a,b)=>a+b,0)/clsVals.length).toFixed(2); classAvgRows += `<tr class="avg-row"><td colspan="4" class="avg-label">${escapeHtml(clsName)} Ortalama</td><td>${clsAvg}</td></tr>`; }
    });
    
    let clsAvgRow = classAvgRows, lvlLabel = lvlForAvg ? `${lvlForAvg}. Sınıflar` : 'Tüm Sınıflar';
    if (allVals.length > 0) { let genAvg = (allVals.reduce((a,b)=>a+b,0)/allVals.length).toFixed(2); clsAvgRow += `<tr class="avg-row"><td colspan="4" class="avg-label">Kurum Ortalama (${escapeHtml(lvlLabel)})</td><td>${genAvg}</td></tr>`; }
    let clsLabel=''; {let lv=getEl('aLvl').value,br=getBrVal(); if(lv&&br)clsLabel=lv+br; else if(lv)clsLabel=lv+'. Sınıflar'; else if(br)clsLabel=br; else clsLabel='Hepsi';}
    
    let clsPerfHtml = '';
    let cohenHtml = '';
    let showCompCards = false;
    if(sortedClasses.length > 0 && allVals.length > 0) {
      let topCls = sortedClasses.map(clsName => { let cv = exSel.filter(x=>x.studentClass===clsName).map(x=>{ if(sb==='score')return x.score; if(sb==='totalNet'||!sb)return x.totalNet; return x.subs[toTitleCase(sb.replace('s_',''))]?.net||0; }); return {cls: clsName, avg: cv.length?(cv.reduce((a,b)=>a+b,0)/cv.length):0, count: cv.length}; }).sort((a,b)=>b.avg-a.avg);
      let best = topCls[0], worst = topCls[topCls.length-1], genAvgPerf = allVals.reduce((a,b)=>a+b,0)/allVals.length, aboveAvg = topCls.filter(x=>x.avg >= genAvgPerf).length;
      showCompCards = topCls.length > 1;
      
      let { baseCount, attendedCount, rate: partRate } = _calcParticipation({ examType: eT, lvl: l, br: b, date: dateFilter });

      // Cohen's d — en iyi şube vs en düşük şube (yalnızca >=2 şube + ≥2 sınav modunda).
      // Ham kayıt yerine öğrenci başına ortalama kullanılır:
      //   Ham kayıtlar her sınavı ayrı gözlem sayar → büyük n/küçük n şubeler
      //   arasında yapay varyans farkı oluşur (sınav sayısı Cohen's d'yi etkiler).
      //   Öğrenci başına ortalama, ölçeği eşitler ve gerçek grup farkını yansıtır.
      // Minimum n≥10 öğrenci: küçük örneklemlerde Cohen's d güvenilir değildir
      //   (standart hata büyür, etki büyüklüğü kolayca aşırı oynar).
      if(showCompCards && sd.length >= 2) {
        // Her şube için öğrenci başına ortalama
        let _stuAvgsForCls = (cls) => {
          let map = {};
          exSel.filter(x=>x.studentClass===cls).forEach(x=>{
            let v; if(sb==='score') v=x.score; else if(sb==='totalNet'||!sb) v=x.totalNet; else v=x.subs[toTitleCase(sb.replace('s_',''))]?.net||0;
            if(!map[x.studentNo]) map[x.studentNo]=[];
            map[x.studentNo].push(v);
          });
          return Object.values(map).map(arr=>arr.reduce((a,b)=>a+b,0)/arr.length);
        };
        let bestVals = _stuAvgsForCls(best.cls);
        // n≥10 koşulu: az öğrencili şubede Cohen's d güvenilir değil
        if(bestVals.length >= 10) {
          // En iyi şube ile diğer tüm şubelerin karşılaştırması
          let otherCls = topCls.filter(c => c.cls !== best.cls);
          let compLines = otherCls.map(c => {
            let cVals = _stuAvgsForCls(c.cls);
            if(cVals.length < 10) return null;
            let dC = _statCohenD(bestVals, cVals);
            if(dC === null || !isFinite(dC)) return null;
            let lC = _cohenLabel(dC);
            let colC = Math.abs(dC) >= 0.8 ? '#dc3545' : (Math.abs(dC) >= 0.5 ? '#fd7e14' : (Math.abs(dC) >= 0.2 ? '#ffc107' : '#28a745'));
            return `<div class="sec-sub sec-sub-comparison" style="--metric-color:${colC};">${escapeHtml(lC)} fark — ${escapeHtml(best.cls)} vs ${escapeHtml(c.cls)}</div>`;
          }).filter(Boolean);

          // Ana değer: en iyi vs en düşük
          let worstVals = _stuAvgsForCls(worst.cls);
          let dMain = worstVals.length >= 10 ? _statCohenD(bestVals, worstVals) : null;
          if(dMain !== null && isFinite(dMain)) {
            let labMain = _cohenLabel(dMain);
            let dColorMain = Math.abs(dMain) >= 0.8 ? '#dc3545' : (Math.abs(dMain) >= 0.5 ? '#fd7e14' : (Math.abs(dMain) >= 0.2 ? '#ffc107' : '#28a745'));
            let compHtml = compLines.length > 0
              ? `<div class="comparison-list">${compLines.join('')}</div>`
              : `<div class="sec-sub">${labMain} fark — ${escapeHtml(best.cls)} vs ${escapeHtml(worst.cls)}</div>`;
            cohenHtml = _trendStatItem(
              "Etki Büyüklüğü (Hedges g)",
              `<span style="color:${dColorMain};">g = ${dMain.toFixed(2)}</span>`,
              `${escapeHtml(labMain)} · ${escapeHtml(best.cls)} vs ${escapeHtml(worst.cls)}`,
              "Hedges g: en güçlü şube ile karşılaştırılan şubeler arasındaki standartlaştırılmış ortalama farkı (küçük örneklem düzeltmeli Cohen d). En yüksek ortalamalı şube veriden seçildiği için fark olduğundan büyük görünebilir.",
              ''
            );
          }
        }
      }

      // 1-E: Tek sınav + tek şube — bağlam kartları (şube ort., kurum ort., fark)
      let singleExamSingleBranchHtml = '';
      if(dateFilter && !showCompCards && sortedClasses.length === 1) {
        let _brAvg = topCls[0].avg;
        let _instValsForDate = (lvlForAvg ? DB.e.filter(x=>x.examType===eT&&!x.abs&&x.date===dateFilter&&getGrade(x.studentClass)===lvlForAvg&&_hasMetric(x, sb)) : DB.e.filter(x=>x.examType===eT&&!x.abs&&x.date===dateFilter&&_hasMetric(x, sb)))
          .map(x=>{ if(sb==='score')return x.score; if(sb==='totalNet'||!sb)return x.totalNet; return x.subs[toTitleCase(sb.replace('s_',''))]?.net||0; });
        let _instAvg = _instValsForDate.length ? _instValsForDate.reduce((a,b)=>a+b,0)/_instValsForDate.length : null;
        let _delta = (_instAvg!==null) ? (_brAvg - _instAvg) : null;
        let _dCls = _delta===null?'sec-neutral':(_delta>0?'sec-pos':(_delta<0?'sec-neg':'sec-neutral'));
        let _dSign = _delta!==null?(_delta>0?'+':''):'';
        singleExamSingleBranchHtml = `<div class="row g-2 sec-cards-row class-info-cards class-context-cards mb-3">
          <div class="col-12 col-md-4 class-info-col"><div class="sec-card h-100"><div class="sec-icon"><i class="fas fa-school"></i></div><div class="sec-body"><div class="sec-label">Şube Ortalaması</div><div class="sec-value">${_brAvg.toFixed(2)}</div><div class="sec-sub">${escapeHtml(sortedClasses[0])} · ${escapeHtml(ls)}</div></div></div></div>
          ${_instAvg!==null?`<div class="col-12 col-md-4 class-info-col"><div class="sec-card h-100"><div class="sec-icon"><i class="fas fa-building"></i></div><div class="sec-body"><div class="sec-label">Kurum Ortalaması</div><div class="sec-value">${_instAvg.toFixed(2)}</div><div class="sec-sub">${lvlForAvg?lvlForAvg+'. Sınıflar':''} · ${_instValsForDate.length} kayıt</div></div></div></div>`:''}
          ${_delta!==null?`<div class="col-12 col-md-4 class-info-col"><div class="sec-card ${_dCls} h-100"><div class="sec-icon"><i class="fas fa-exchange-alt"></i></div><div class="sec-body"><div class="sec-label">Şube - Kurum Farkı</div><div class="sec-value">${_dSign}${_delta.toFixed(2)}</div><div class="sec-sub">${_delta>0?'Kurum üstünde':'Kurum altında'}</div></div></div></div>`:''}
        </div>`;
      }

      if(singleExamSingleBranchHtml) {
        clsPerfHtml = singleExamSingleBranchHtml;
      } else if(showCompCards) {
        // Şube = Tümü, birden fazla sınıf var: bağlam kartları aynı görsel grupta kalsın.
        clsPerfHtml = `
          <div class="row g-2 sec-cards-row class-info-cards class-summary-cards mb-2">
            <div class="col-12 col-md-4 class-info-col"><div class="sec-card sec-neutral h-100"><div class="sec-icon"><i class="fas fa-users"></i></div><div class="sec-body"><div class="sec-label">Katılım Oranı</div><div class="sec-value">%${partRate}</div><div class="sec-sub">${attendedCount} / ${baseCount} Katılım</div></div></div></div>
            <div class="col-12 col-md-4 class-info-col"><div class="sec-card h-100"><div class="sec-icon"><i class="fas fa-calculator"></i></div><div class="sec-body"><div class="sec-label">Kurum Ort. (${lvlLabel})</div><div class="sec-value">${genAvgPerf.toFixed(2)}</div></div></div></div>
            <div class="col-12 col-md-4 class-info-col"><div class="sec-card h-100"><div class="sec-icon"><i class="fas fa-star"></i></div><div class="sec-body"><div class="sec-label">Ort. Üstü Sınıf</div><div class="sec-value">${aboveAvg} / ${topCls.length}</div></div></div></div>
          </div>
          <div class="row g-2 sec-cards-row class-info-cards class-compare-cards mb-3">
            <div class="col-12 col-md-6 class-info-col"><div class="sec-card sec-pos h-100"><div class="sec-icon"><i class="fas fa-trophy"></i></div><div class="sec-body"><div class="sec-label">En İyi Sınıf</div><div class="sec-value">${escapeHtml(best.cls)}</div><div class="sec-sub">Ort: ${best.avg.toFixed(2)}</div></div></div></div>
            <div class="col-12 col-md-6 class-info-col"><div class="sec-card sec-neg h-100"><div class="sec-icon"><i class="fas fa-exclamation-circle"></i></div><div class="sec-body"><div class="sec-label">En Düşük Sınıf</div><div class="sec-value">${escapeHtml(worst.cls)}</div><div class="sec-sub">Ort: ${worst.avg.toFixed(2)}</div></div></div></div>
          </div>`;
      } else {
        // Tek şube seçili ama singleExam değil
        clsPerfHtml = `<div class="row g-2 sec-cards-row class-info-cards class-context-cards mb-3">
          <div class="col-12 col-md-6 class-info-col"><div class="sec-card sec-neutral h-100"><div class="sec-icon"><i class="fas fa-users"></i></div><div class="sec-body"><div class="sec-label">Katılım Oranı</div><div class="sec-value">%${partRate}</div><div class="sec-sub">${attendedCount} / ${baseCount} Katılım</div></div></div></div>
          <div class="col-12 col-md-6 class-info-col"><div class="sec-card h-100"><div class="sec-icon"><i class="fas fa-calculator"></i></div><div class="sec-body"><div class="sec-label">Kurum Ort. (${lvlLabel})</div><div class="sec-value">${genAvgPerf.toFixed(2)}</div></div></div></div>
        </div>`;
      }
    }
    
    let stuRankMap = {};
    ex.forEach(e => {
      // BUG DÜZELTMESİ: tek sınav seçildiğinde (dateFilter) En İyi/Düşük 5
      // yalnızca o sınavın verilerini yansıtmalı; aksi hâlde tüm sınavların
      // ortalamasına göre sıralama yapılır ve seçilen sınavla tutarsız sonuç çıkar.
      if(dateFilter && e.date !== dateFilter) return;
      let stu = getStuMap().get(e.studentNo);
      if(!stu) return; 
      let m = stu.class.match(/^(\d+)([a-zA-ZğüşıöçĞÜŞİÖÇ]+)$/);
      if(!m) return;
      if((l && l !== m[1]) || (b && b !== m[2].toLocaleUpperCase('tr-TR'))) return;
      let val;
      if(sb === 'score') val = e.score;
      else if(sb === 'totalNet' || !sb) val = e.totalNet;
      else { let subKey = toTitleCase(sb.replace('s_','')); val = (e.subs && e.subs[subKey] !== undefined) ? e.subs[subKey].net : null; }
      if(val === null || val === undefined) return;
      if(!stuRankMap[e.studentNo]) stuRankMap[e.studentNo] = { no: e.studentNo, name: stu.name, cls: stu.class, sum: 0, cnt: 0, scoreSum: 0, scoreCnt: 0 };
      stuRankMap[e.studentNo].sum += val; stuRankMap[e.studentNo].cnt++;
      stuRankMap[e.studentNo].scoreSum += (e.score||0); stuRankMap[e.studentNo].scoreCnt++;
    });
    let stuRankArr = Object.values(stuRankMap).map(s => ({
      ...s,
      avg: s.sum / s.cnt,
      avgScore: s.scoreCnt ? s.scoreSum / s.scoreCnt : 0
    })).sort((a,b) => {
      let dp = (b.avgScore||0) - (a.avgScore||0); if(dp !== 0) return dp;
      let dn = (b.avg||0) - (a.avg||0); if(dn !== 0) return dn;
      return String(a.name||'').localeCompare(String(b.name||''),'tr',{sensitivity:'base'});
    });
    // Çok sınav seçiliyse sıralamaya yalnızca sınavların en az yarısına giren öğrenciler dahil edilir (tek sınava girenin şanslı sonucu
    // çok sınava girenin ortalamasıyla aynı kefeye konmaz); hiç uygun öğrenci yoksa tümü kullanılır.
    let _rankMinCnt = sd.length >= 2 ? Math.ceil(sd.length / 2) : 1;
    let _rankPool = stuRankArr.filter(s => s.cnt >= _rankMinCnt);
    if(!_rankPool.length) _rankPool = stuRankArr;
    let top5Stu = _rankPool.slice(0, 5), bottom5Stu = _rankPool.slice(-5).reverse();
    let stuTop5Html = top5Stu.length ? top5Stu.map((s,i) => `<tr><td>${i+1}</td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.cls)}</td><td><strong>${s.avg.toFixed(2)}</strong></td></tr>`).join('') : '<tr><td colspan="4" class="text-center text-muted">Veri yok</td></tr>';
    let stuBottom5Html = bottom5Stu.length ? bottom5Stu.map((s,i) => `<tr><td>${i + 1}</td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.cls)}</td><td><strong>${s.avg.toFixed(2)}</strong></td></tr>`).join('') : '<tr><td colspan="4" class="text-center text-muted">Veri yok</td></tr>';
    
    let top5Bottom5Html = stuRankArr.length > 0 ? `<div class="row g-2 class-rank-tables mt-3">
      <div class="col-lg-6"><div class="card shadow-sm avoid-break"><div class="card-header sa-list-header sa-list-success"><h3 class="card-title m-0"><i class="fas fa-trophy me-1"></i> En İyi 5 Öğrenci</h3></div><div class="card-body p-0 table-responsive"><table class="table table-sm table-striped m-0 table-compact"><thead><tr><th>#</th><th>Ad Soyad</th><th>Sınıf</th><th>Ort. (${escapeHtml(ls)})</th></tr></thead><tbody>${stuTop5Html}</tbody></table></div></div></div>
      <div class="col-lg-6"><div class="card shadow-sm avoid-break"><div class="card-header sa-list-header sa-list-danger"><h3 class="card-title m-0"><i class="fas fa-exclamation-circle me-1"></i> En Düşük 5 Öğrenci</h3></div><div class="card-body p-0 table-responsive"><table class="table table-sm table-striped m-0 table-compact"><thead><tr><th>#</th><th>Ad Soyad</th><th>Sınıf</th><th>Ort. (${escapeHtml(ls)})</th></tr></thead><tbody>${stuBottom5Html}</tbody></table></div></div></div>
    </div>${_rankMinCnt > 1 ? `<div class="text-muted small mt-1">Sıralamaya, seçili sınavların en az yarısına (en az ${_rankMinCnt} sınav) giren öğrenciler dahildir.</div>` : ''}` : '';

    // 1-D: Tek şube - ilerleme/gerileme kartları (showCompCards=false olsa bile gösterilir)
    let progressRegressionHtml = '';
    if(!showCompCards && sd.length >= 2) {
      // Her öğrencinin sınav serisi üzerinden regresyon eğimi hesapla.
      // Değerler sınav içi standartlaştırılır (z): sınavlar arası zorluk/ölçek farkı eğimi bozmasın; seçim en az 4 sınavlık
      // serilerle sınırlıdır (2-3 noktalı eğimler çok gürültülüdür, binlerce gürültülü eğimin uç değeri seçim yanlılığı yaratır).
      let _getV = e => {
        if(sb==='score') return e.score;
        if(sb==='totalNet'||!sb) return e.totalNet;
        let _sk=toTitleCase(sb.replace('s_',''));
        return (e.subs&&e.subs[_sk]!==undefined)?e.subs[_sk].net:null;
      };
      let _dateStat = {};
      sd.forEach(dt => {
        let vs = (d[dt]||[]).map(_getV).filter(v => v!==null && v!==undefined && isFinite(v));
        let sdv = _statStd(vs);
        _dateStat[dt] = (vs.length >= 5 && sdv > 0) ? { m: vs.reduce((a,b)=>a+b,0)/vs.length, sd: sdv } : null;
      });
      let _stuSeriesMap = {};
      sd.forEach(dt => {
        (d[dt]||[]).forEach(e => {
          let _stu = getStuMap().get(e.studentNo); if(!_stu) return;
          if(!_stuSeriesMap[e.studentNo]) _stuSeriesMap[e.studentNo] = { name: _stu.name, cls: _stu.class, scores: [], bad: false };
          let _v = _getV(e), _st = _dateStat[dt];
          if(_v===null || _v===undefined) return;
          if(!_st){ _stuSeriesMap[e.studentNo].bad = true; return; }
          _stuSeriesMap[e.studentNo].scores.push((_v - _st.m) / _st.sd);
        });
      });
      let _slopeArr = Object.entries(_stuSeriesMap)
        .filter(([,s]) => !s.bad && s.scores.length >= _PROGRESS_MIN_N)
        .map(([no2,s]) => ({ no: no2, name: s.name, cls: s.cls, slope: linRegSlope(s.scores), cnt: s.scores.length }));
      _slopeArr.sort((a,b) => b.slope - a.slope);
      let _bestProg  = _slopeArr.length > 0 && _slopeArr[0].slope > 0 ? _slopeArr[0] : null;
      let _worstProg = _slopeArr.length > 0 && _slopeArr[_slopeArr.length-1].slope < 0 ? _slopeArr[_slopeArr.length-1] : null;
      if(_bestProg || _worstProg) {
        progressRegressionHtml = `<div class="row g-2 sec-cards-row class-info-cards class-progress-cards mb-3">
          ${_bestProg ? `<div class="col-12 col-md-6 class-info-col"><div class="sec-card sec-pos h-100"><div class="sec-icon"><i class="fas fa-rocket"></i></div><div class="sec-body"><div class="sec-label">En Fazla İlerleme</div><div class="sec-value sec-value-compact">${escapeHtml(_bestProg.name)} <small>(${escapeHtml(_bestProg.cls)})</small></div><div class="sec-sub">Sınav başına +${_bestProg.slope.toFixed(2)} SS · ${_bestProg.cnt} sınav</div></div></div></div>` : ''}
          ${_worstProg ? `<div class="col-12 col-md-6 class-info-col"><div class="sec-card sec-neg h-100"><div class="sec-icon"><i class="fas fa-level-down-alt"></i></div><div class="sec-body"><div class="sec-label">En Fazla Gerileme</div><div class="sec-value sec-value-compact">${escapeHtml(_worstProg.name)} <small>(${escapeHtml(_worstProg.cls)})</small></div><div class="sec-sub">Sınav başına ${_worstProg.slope.toFixed(2)} SS · ${_worstProg.cnt} sınav</div></div></div></div>` : ''}
        </div>`;
      }
    }

    let clsTrendHtml = '';
    if(sd.length >= 2) {
      let dateAvgSeries = sd.map(dt => {
        let vals = (d[dt]||[]).map(x => { if(sb==='score') return x.score; if(sb==='totalNet'||!sb) return x.totalNet; return x.subs[toTitleCase(sb.replace('s_',''))]?.net||0; });
        return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
      }).filter(v => v !== null);

      if(dateAvgSeries.length >= 2) {
        let clsTSlope    = linRegSlope(dateAvgSeries);
        let clsTTotal    = clsTSlope * (dateAvgSeries.length - 1);
        let clsFit = _trendFit(dateAvgSeries); // eğimin anlamlılığı (t-testi); anlamlı değilse yön iddia edilmez
        let clsTImproving = clsFit.significant && clsTSlope > 0, clsTWorsening = clsFit.significant && clsTSlope < 0;
        let clsTClass   = clsTImproving ? 'trend-up' : (clsTWorsening ? 'trend-down' : 'trend-stable');
        let clsTIcon    = clsTImproving ? 'fa-arrow-up' : (clsTWorsening ? 'fa-arrow-down' : 'fa-question-circle');
        let clsTText    = clsTImproving ? 'Yükseliş' : (clsTWorsening ? 'Düşüş' : (clsFit.n < _TREND_SIG_MIN_N ? 'Veri yetersiz' : 'Belirgin trend yok'));
        let clsTColor   = clsTImproving ? '#28a745' : (clsTWorsening ? '#dc3545' : '#6c757d');
        let clsTSign    = clsTTotal > 0 ? '+' : '';
        let clsSSign    = clsTSlope > 0 ? '+' : '';

        // Dağılım: öğrenci başına ortalama değerler üzerinden (tüm sınavların ham kayıtlarını tek havuzda almak, sınavlar arası
        // zorluk farkını da "heterojenlik" sayıyordu). Tek sınavda bu, kayıtların kendisidir.
        let ssRawVals = _perStudentMeans(sd.flatMap(dt => d[dt]||[]), x => { if(sb==='score') return x.score; if(sb==='totalNet'||!sb) return x.totalNet; return x.subs[toTitleCase(sb.replace('s_',''))]?.net||0; });
        // Örneklem standart sapması (n-1 paydası) — grup heterojenliği için doğru ölçü.
        // Popülasyon σ (n paydası) örneklem varyansını sistematik olarak küçümser.
        let ssMean = ssRawVals.length ? ssRawVals.reduce((a,b)=>a+b,0)/ssRawVals.length : 0;
        let ssVal  = _statStd(ssRawVals) || 0;
        let _clsAvgsForMM = sortedClasses.map(clsName => {
          let vals = sd.flatMap(dt => (d[dt]||[]).filter(x=>x.studentClass===clsName).map(x=>{ if(sb==='score')return x.score; if(sb==='totalNet'||!sb)return x.totalNet; return x.subs[toTitleCase(sb.replace('s_',''))]?.net||0; }));
          return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
        }).filter(v=>v!==null);
        let mmDiff = _clsAvgsForMM.length > 1 ? Math.max(..._clsAvgsForMM) - Math.min(..._clsAvgsForMM) : null;

        let _consistencyLabelC = (function(){ let cv = ssMean!==0 ? Math.abs(ssVal/ssMean)*100 : 0; return cv<10?'Çok homojen':(cv<20?'Homojen':(cv<35?'Heterojen':'Çok heterojen')); })();
        // R² ve anlamlılık — sınıf trend güvenilirliği (eğim t-testi)
        let clsTR2    = clsFit.r2;
        let clsTR2Lab = !clsFit.significant ? (clsFit.n < _TREND_SIG_MIN_N ? 'Veri yetersiz' : 'Anlamlı değil') : (clsTR2 >= 0.65 ? 'Güçlü trend' : 'Anlamlı trend');
        let clsTR2Col = !clsFit.significant ? '#dc3545' : (clsTR2 >= 0.65 ? '#28a745' : '#fd7e14');

        clsTrendHtml = _trendStatBlock([
          _trendStatItem(
            'Genel Yön (Trend)',
            `<span class="trend-indicator ${clsTClass}"><i class="fas ${clsTIcon} me-1"></i>${clsTText}</span>`,
            'Sınıf ortalamasının yönü',
            'Sınıf ortalamasının zaman içindeki yönü',
            ''
          ),
          _trendStatItem(
            'Toplam Değişim',
            `<span style="--metric-color:${clsTColor}; color:var(--metric-color);">${clsTSign}${clsTTotal.toFixed(2)}</span>`,
            'Süreç boyunca',
            'İlk sınavdan son sınava ortalamadaki net değişim (regresyon)',
            ''
          ),
          _trendStatItem(
            'Sınav Başına Değişim',
            `<span style="--metric-color:${clsTColor}; color:var(--metric-color);">${clsSSign}${clsTSlope.toFixed(2)}</span>`,
            'Regresyon analizi',
            'Her yeni sınavda beklenen ortalama değişim',
            ''
          ),
          _trendStatItem(
            'Sınav Sayısı',
            `${dateAvgSeries.length}`,
            'Trend hesabına dahil',
            'Analize dahil edilen toplam sınav sayısı',
            ''
          ),
          _trendStatItem(
            'Dağılım / Homojenlik',
            `<span class="trend-tone-purple">±${ssVal.toFixed(2)}</span>`,
            _consistencyLabelC,
            'Öğrenci başına ortalamaların örneklem standart sapması (n-1). Düşük = homojen sınıf. Çok sınav seçiliyse her öğrenci tek gözlem sayılır.',
            ''
          ),
          mmDiff !== null ? _trendStatItem(
            'Şubeler Arası Fark',
            `<span class="text-warning">${mmDiff.toFixed(2)}</span>`,
            'En iyi - en düşük şube',
            'En yüksek ortalamalı sınıf ile en düşük arasındaki fark',
            ''
          ) : '',
          _trendStatItem(
            'Trend Güvenilirliği (R²)',
            `<span style="--metric-color:${clsTR2Col}; color:var(--metric-color);">${clsTR2.toFixed(2)}</span>`,
            clsTR2Lab,
            `R² = trendin açıkladığı varyans oranı (1'e yakın = iyi uyum). Anlamlılık eğimin t-testiyle belirlenir (en az ${_TREND_SIG_MIN_N} sınav ve p≤0.10 gerekir; bu seride ${_fmtP(clsFit.p) || 'p hesaplanamadı'}). Not: sınıf ortalaması her sınavda farklı öğrenci kümesine ve sınav zorluğuna bağlıdır.`,
            ''
          ),
          cohenHtml
        ]);
      }
    }

    let h=`<div class="d-flex justify-content-end mb-2 no-print"><button class="btn-print no-print" onclick="xPR('pC','Sinif_Analizi',this)"><i class='fas fa-print me-1'></i>Yazdır</button></div>
    <div id="pC" class="card shadow-sm report-card sa-report-success">
      <div class="report-header">
        <span class="report-title-main"><i class="fas fa-users me-2"></i>Sınıf Analizi — ${escapeHtml(eT)} (${escapeHtml(ls)})</span>
        <span class="report-title-sub">${escapeHtml(clsLabel)}</span>
      </div>
      <div class="card-body report-card-body">
        ${clsPerfHtml}
        ${progressRegressionHtml}
        ${clsTrendHtml}
        <div id="clsBoxPlotArea"></div>
        ${top5Bottom5Html}
        <div class="single-exam-table-part analysis-table-part">
          <div class="scroll-hint"><i class="fas fa-arrows-alt-h me-1"></i>Tabloyu kaydırın</div>
          <div class="table-responsive"><table class="table table-sm table-hover table-bordered" id="tC"><thead><tr><th>#</th><th>Sınıf</th><th>Tarih</th><th>Yayınevi</th><th>Ortalama</th></tr></thead><tbody>${tr.join('')}${clsAvgRow}</tbody></table></div>
        </div>
        <div class="single-exam-chart-title chart-section-title"><i class="fas fa-chart-line"></i>${escapeHtml(ls)} — Sınıf Ortalamaları Grafiği</div>
        <div class="chart-box chart-box-top avoid-break"><canvas id="cA"></canvas></div>
      </div>
    </div>`;
    r.innerHTML=h;
    
    chartTimer=setTimeout(()=>{ 
      let datePublisherMap = {}; Object.values(EXAM_META).forEach(m => { if(m.examType===eT && m.publisher) datePublisherMap[m.date]=m.publisher; });
      let sdLabels = sd.map(dt => datePublisherMap[dt] ? `${dt} (${toTitleCase(datePublisherMap[dt])})` : dt);
      let ds=[...cs].sort().map((cl,i)=>({
        label:cl, backgroundColor:cols[i%cols.length]+'cc', borderColor:cols[i%cols.length], borderWidth:1.5,
        data:sd.map(dt=>{ let o=(d[dt]||[]).filter(x=>x.studentClass===cl); let n=o.map(x=>{ if(sb === 'score') return x.score; if(sb === 'totalNet' || !sb) return x.totalNet; return x.subs[toTitleCase(sb.replace('s_',''))]?.net || 0; }); return n.length?n.reduce((x,y)=>x+y,0)/n.length:null; })
      })); 
      c.a=mkChart('cA',sdLabels,ds);
      let clsBPArea = getEl('clsBoxPlotArea');
      let totalExamsOfType = new Set(Object.values(EXAM_META).filter(m => m.examType === eT).map(m => m.date)).size;
      if(clsBPArea && totalExamsOfType >= 10) {
        let classDataMap = {};
        let lvlForBP = l || (exSel.length > 0 ? getGrade(exSel[0].studentClass) : '');
        let allGradeEx = DB.e.filter(x => x.examType===eT && !x.abs && (lvlForBP ? getGrade(x.studentClass)===lvlForBP : true) && (!dateFilter || x.date === dateFilter));
        let allGradeValsForBP = allGradeEx.map(x => {
          if(sb==='score') return x.score;
          if(sb==='totalNet'||!sb) return x.totalNet;
          return x.subs[toTitleCase(sb.replace('s_',''))]?.net ?? null;
        }).filter(v => v !== null);
        [...cs].sort().forEach(clsName => {
          let vals = exSel.filter(x => x.studentClass === clsName).map(x => {
            if(sb==='score') return x.score;
            if(sb==='totalNet'||!sb) return x.totalNet;
            return x.subs[toTitleCase(sb.replace('s_',''))]?.net ?? null;
          }).filter(v => v !== null);
          if(vals.length >= 3) { classDataMap[clsName] = vals; }
        });
        if(Object.keys(classDataMap).length >= 1) {
          let lbl = sb === 'score' ? 'Puan' : (sb === 'totalNet' || !sb ? 'Toplam Net' : toTitleCase(sb.replace('s_','')) + ' Neti');
          clsBPArea.innerHTML = `<div class="boxplot-card mb-3"><div class="boxplot-title"><i class="fas fa-box-open me-1 text-success"></i>Sınıflar Arası Dağılım — ${escapeHtml(lbl)} (Bireysel Sonuçlar)</div>${mkMultiClassBoxPlot(classDataMap, null, {height:220, title:''}, allGradeValsForBP.length>=3?allGradeValsForBP:null)}</div>`;
        }
      }
    },100);

  }else if(aT==='subject'){
    let subj = sb; if(!subj){r.innerHTML='<div class="alert alert-default-info">Lütfen bir ders seçin.</div>';return;}
    let lvl = getEl('aLvl').value, br = getBrVal(), dateFilterS = typeof getAnalysisDateValue === 'function' ? getAnalysisDateValue() : (getEl('aDate') ? getEl('aDate').value : '');
    if(subj === SUBJ_ALL_VALUE){ rAllSubjects(r, eT, lvl, br, dateFilterS); return; }
    let ex = DB.e.filter(x => x.examType === eT && !x.abs && x.subs[toTitleCase(subj)] && (!dateFilterS || x.date === dateFilterS));
    if(lvl) ex = ex.filter(x => getGrade(x.studentClass) === lvl);
    if(br) ex = ex.filter(x => getClassParts(x.studentClass).branch === br);
    
    if(!ex.length){r.innerHTML='<div class="alert alert-default-warning">Bu ders için veri bulunamadı.</div>';return;}
    
    let dateGroups = {}; ex.forEach(e => { if(!dateGroups[e.date]) dateGroups[e.date] = []; dateGroups[e.date].push(e); });
    let dates = Object.keys(dateGroups).sort(srt), classStats = {}, allStudentStats = {};
    
    ex.forEach(e => {
      let cls = e.studentClass;
      if(!classStats[cls]) classStats[cls] = { totalNet: 0, count: 0, exams: [] };
      classStats[cls].totalNet += e.subs[toTitleCase(subj)].net; classStats[cls].count++; classStats[cls].exams.push(e);
      if(!allStudentStats[e.studentNo]) { let stuName = getStuMap().get(e.studentNo)?.name || '—'; allStudentStats[e.studentNo] = { no: e.studentNo, name: stuName, cls: cls, totalNet: 0, count: 0, nets: [] }; }
      allStudentStats[e.studentNo].totalNet += e.subs[toTitleCase(subj)].net; allStudentStats[e.studentNo].count++; allStudentStats[e.studentNo].nets.push(e.subs[toTitleCase(subj)].net);
    });
    
    let _validNosSubj = new Set(DB.s.map(s=>s.no));
    let stuArr = Object.values(allStudentStats).filter(s=>_validNosSubj.has(s.no)).map(s => ({ ...s, avg: s.totalNet / s.count })).sort((a,b) => {
      let dn = (b.avg||0) - (a.avg||0); if(dn !== 0) return dn;
      return String(a.name||'').localeCompare(String(b.name||''),'tr',{sensitivity:'base'});
    });
    // Çok sınav seçiliyse sıralamaya yalnızca sınavların en az yarısına giren öğrenciler dahil edilir; uygun öğrenci yoksa tümü kullanılır
    let _sjDateCnt = new Set(ex.map(e => e.date)).size;
    let _sjMinCnt = _sjDateCnt >= 2 ? Math.ceil(_sjDateCnt / 2) : 1;
    let _sjPool = stuArr.filter(s => s.count >= _sjMinCnt);
    if(!_sjPool.length) _sjPool = stuArr;
    let top5 = _sjPool.slice(0, 5), bottom5 = _sjPool.slice(-5).reverse();
    let clsArr = Object.entries(classStats).map(([cls, data]) => ({ cls, avg: data.totalNet / data.count, count: data.count })).sort((a,b) => b.avg - a.avg);
    
    let bestStudent = _sjPool.length > 0 ? _sjPool[0] : null;
    let worstStudent = _sjPool.length > 0 ? _sjPool[_sjPool.length - 1] : null;
    let genAvg = ex.reduce((a,e) => a + e.subs[toTitleCase(subj)].net, 0) / ex.length, lvlStr = (lvl ? `${lvl}. Sınıflar` : 'Tüm Sınıflar') + (br ? ` / ${br} Şubesi` : '');
    
    let { baseCount: baseCountS, attendedCount: attendedCountS, rate: partRateS } = _calcParticipation({ examType: eT, lvl, br, date: dateFilterS, subject: subj });

    let subjTrendHtml = '';
    if(dates.length >= _TREND_MIN_N) {
      let subjDateAvgSeries = dates.map(dt => {
        let vals = dateGroups[dt].map(e => e.subs[toTitleCase(subj)].net);
        return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
      }).filter(v => v !== null);

      if(subjDateAvgSeries.length >= _TREND_MIN_N) {
        let subjSlope    = linRegSlope(subjDateAvgSeries);
        let subjTotal    = subjSlope * (subjDateAvgSeries.length - 1);
        let subjFit = _trendFit(subjDateAvgSeries); // eğimin anlamlılığı (t-testi); anlamlı değilse yön iddia edilmez
        let subjImproving = subjFit.significant && subjSlope > 0, subjWorsening = subjFit.significant && subjSlope < 0;
        let subjTClass  = subjImproving ? 'trend-up' : (subjWorsening ? 'trend-down' : 'trend-stable');
        let subjTIcon   = subjImproving ? 'fa-arrow-up' : (subjWorsening ? 'fa-arrow-down' : 'fa-question-circle');
        let subjTText   = subjImproving ? 'Yükseliş' : (subjWorsening ? 'Düşüş' : (subjFit.n < _TREND_SIG_MIN_N ? 'Veri yetersiz' : 'Belirgin trend yok'));
        let subjTColor  = subjImproving ? '#28a745' : (subjWorsening ? '#dc3545' : '#6c757d');
        let subjTSign   = subjTotal > 0 ? '+' : '';
        let subjSSign   = subjSlope > 0 ? '+' : '';

        // Dağılım: öğrenci başına ortalama netler üzerinden (ham kayıtlar tek havuzda alınırsa sınavlar arası zorluk farkı da
        // "heterojenlik" sayılır). Tek sınavda bu, kayıtların kendisidir.
        let subjAllNets = _perStudentMeans(ex, e => e.subs[toTitleCase(subj)].net);
        let subjMean    = subjAllNets.reduce((a,b)=>a+b,0)/subjAllNets.length;
        // Örneklem standart sapması (n-1 paydası) — öğrenci heterojenliği için doğru ölçü.
        let subjSS      = _statStd(subjAllNets) || 0;
        let subjClsAvgs = clsArr.map(c=>c.avg);
        let subjMMDiff  = subjClsAvgs.length > 1 ? Math.max(...subjClsAvgs) - Math.min(...subjClsAvgs) : null;

        let _consistencyLabelS = (function(){ let cv = subjMean!==0 ? Math.abs(subjSS/subjMean)*100 : 0; return cv<10?'Çok homojen':(cv<20?'Homojen':(cv<35?'Heterojen':'Çok heterojen')); })();
        // R² ve anlamlılık — ders trend güvenilirliği (eğim t-testi)
        let subjR2    = subjFit.r2;
        let subjR2Lab = !subjFit.significant ? (subjFit.n < _TREND_SIG_MIN_N ? 'Veri yetersiz' : 'Anlamlı değil') : (subjR2 >= 0.65 ? 'Güçlü trend' : 'Anlamlı trend');
        let subjR2Col = !subjFit.significant ? '#dc3545' : (subjR2 >= 0.65 ? '#28a745' : '#fd7e14');

        subjTrendHtml = _trendStatBlock([
          _trendStatItem(
            'Genel Yön (Trend)',
            `<span class="trend-indicator ${subjTClass}"><i class="fas ${subjTIcon} me-1"></i>${subjTText}</span>`,
            'Ders ortalamasının yönü',
            'Bu dersin ortalamasının zaman içindeki yönü',
            ''
          ),
          _trendStatItem(
            'Toplam Değişim',
            `<span style="--metric-color:${subjTColor}; color:var(--metric-color);">${subjTSign}${subjTotal.toFixed(2)}</span>`,
            'Süreç boyunca',
            'İlk sınavdan son sınava ders ortalamasındaki değişim (regresyon)',
            ''
          ),
          _trendStatItem(
            'Sınav Başına Değişim',
            `<span style="--metric-color:${subjTColor}; color:var(--metric-color);">${subjSSign}${subjSlope.toFixed(2)}</span>`,
            'Regresyon analizi',
            'Her yeni sınavda derste beklenen değişim',
            ''
          ),
          _trendStatItem(
            'Sınav Sayısı',
            `${subjDateAvgSeries.length}`,
            'Bu dersi içeren sınavlar',
            'Trend hesabına dahil edilen toplam sınav sayısı',
            ''
          ),
          _trendStatItem(
            'Dağılım / Homojenlik',
            `<span class="trend-tone-purple">±${subjSS.toFixed(2)}</span>`,
            _consistencyLabelS,
            'Öğrenci başına ortalama netlerin örneklem standart sapması (n-1). Çok sınav seçiliyse her öğrenci tek gözlem sayılır.',
            ''
          ),
          subjMMDiff !== null ? _trendStatItem(
            'Sınıflar Arası Fark',
            `<span class="text-warning">${subjMMDiff.toFixed(2)}</span>`,
            'En iyi - en düşük sınıf',
            'Bu derste en yüksek ve en düşük sınıf ortalaması arasındaki fark',
            ''
          ) : '',
          _trendStatItem(
            'Trend Güvenilirliği (R²)',
            `<span style="--metric-color:${subjR2Col}; color:var(--metric-color);">${subjR2.toFixed(2)}</span>`,
            subjR2Lab,
            `R² = trendin açıkladığı varyans oranı (1'e yakın = iyi uyum). Anlamlılık eğimin t-testiyle belirlenir (en az ${_TREND_SIG_MIN_N} sınav ve p≤0.10 gerekir; bu seride ${_fmtP(subjFit.p) || 'p hesaplanamadı'}). Not: ders ortalaması her sınavda farklı öğrenci kümesine ve sınav zorluğuna bağlıdır.`,
            ''
          )
        ]);
      }
    }

    // Ders Analizi — Şube "Tümü" iken En İyi / En Zayıf Sınıf + Cohen's d istatistik bloğu
    let subjBestClsObj  = clsArr.length > 0 ? clsArr[0] : null;
    let subjWorstClsObj = clsArr.length > 1 ? clsArr[clsArr.length - 1] : null;

    let subjStatsHtml = '';
    if(!br && clsArr.length >= 2) {
      let subjBestClsN  = clsArr[0].cls;
      let _subjStuAvgs2 = (cls) => {
        let map = {};
        ex.filter(e => e.studentClass === cls).forEach(e => {
          if(!map[e.studentNo]) map[e.studentNo] = [];
          map[e.studentNo].push(e.subs[toTitleCase(subj)].net);
        });
        return Object.values(map).map(arr => arr.reduce((a,b)=>a+b,0)/arr.length);
      };
      let subjBVals2 = _subjStuAvgs2(subjBestClsN);
      if(subjBVals2.length >= 10) {
        // En iyi şube vs diğer tüm şubeler
        let subjOtherCls = clsArr.filter(c => c.cls !== subjBestClsN);
        let subjCompLines = subjOtherCls.map(c => {
          let cVals = _subjStuAvgs2(c.cls);
          if(cVals.length < 10) return null;
          let dC = _statCohenD(subjBVals2, cVals);
          if(dC === null || !isFinite(dC)) return null;
          let lC = _cohenLabel(dC);
          let colC = Math.abs(dC) >= 0.8 ? '#dc3545' : (Math.abs(dC) >= 0.5 ? '#fd7e14' : (Math.abs(dC) >= 0.2 ? '#ffc107' : '#28a745'));
          return `<div class="sec-sub sec-sub-comparison" style="--metric-color:${colC};">${escapeHtml(lC)} fark — ${escapeHtml(subjBestClsN)} vs ${escapeHtml(c.cls)}</div>`;
        }).filter(Boolean);

        // Ana değer: en iyi vs en zayıf
        let subjWorstClsN2 = clsArr[clsArr.length - 1].cls;
        let subjWVals2 = _subjStuAvgs2(subjWorstClsN2);
        let subjD2 = subjWVals2.length >= 10 ? _statCohenD(subjBVals2, subjWVals2) : null;
        if(subjD2 !== null && isFinite(subjD2)) {
          let subjDLab2 = _cohenLabel(subjD2);
          let subjDCol2 = Math.abs(subjD2) >= 0.8 ? '#dc3545' : (Math.abs(subjD2) >= 0.5 ? '#fd7e14' : (Math.abs(subjD2) >= 0.2 ? '#ffc107' : '#28a745'));
          let subjCompHtml = subjCompLines.length > 0
            ? `<div class="comparison-list">${subjCompLines.join('')}</div>`
            : `<div class="sec-sub">${subjDLab2} fark — ${escapeHtml(subjBestClsN)} vs ${escapeHtml(subjWorstClsN2)}</div>`;
          subjStatsHtml = _trendStatItem(
            "Etki Büyüklüğü (Hedges g)",
            `<span style="color:${subjDCol2};">g = ${subjD2.toFixed(2)}</span>`,
            `${escapeHtml(subjDLab2)} · ${escapeHtml(subjBestClsN)} vs ${escapeHtml(subjWorstClsN2)}`,
            "Hedges g: en güçlü sınıf ile karşılaştırılan sınıflar arasındaki standartlaştırılmış ortalama farkı (küçük örneklem düzeltmeli Cohen d). En yüksek ortalamalı sınıf veriden seçildiği için fark olduğundan büyük görünebilir.",
            ''
          );
        }
      }
    }
    subjTrendHtml = _appendStatsToTrend(subjTrendHtml, [subjStatsHtml]);

    // Satır 1: Toplam Kayıt | Katılım Oranı | Genel Ortalama
    let subjRow1Html = `<div class="row g-2 sec-cards-row analysis-info-cards subject-info-cards mb-2">
      <div class="col-12 col-md-4 col-lg flex-fill mb-2"><div class="sec-card h-100"><div class="sec-icon"><i class="fas fa-users"></i></div><div class="sec-body"><div class="sec-label">Toplam Kayıt</div><div class="sec-value">${ex.length} Sonuç</div></div></div></div>
      <div class="col-12 col-md-4 col-lg flex-fill mb-2"><div class="sec-card sec-neutral h-100"><div class="sec-icon"><i class="fas fa-chart-pie"></i></div><div class="sec-body"><div class="sec-label">Katılım Oranı</div><div class="sec-value">%${partRateS}</div><div class="sec-sub">${attendedCountS} / ${baseCountS} Katılım</div></div></div></div>
      <div class="col-12 col-md-4 col-lg flex-fill mb-2"><div class="sec-card h-100"><div class="sec-icon"><i class="fas fa-calculator"></i></div><div class="sec-body"><div class="sec-label">Genel Ortalama</div><div class="sec-value">${genAvg.toFixed(2)} Net</div></div></div></div>
    </div>`;

    // Satır 2 (yalnızca Şube=Tümü ve birden fazla sınıf varsa):
    // En İyi Sınıf | En Zayıf Sınıf
    let subjRow2Html = '';
    if(!br && clsArr.length > 1) {
      subjRow2Html = `<div class="row g-2 sec-cards-row analysis-info-cards subject-info-cards mb-2">
        <div class="col-12 col-md-4 col-lg flex-fill mb-2"><div class="sec-card sec-pos h-100"><div class="sec-icon"><i class="fas fa-school"></i></div><div class="sec-body"><div class="sec-label">En İyi Sınıf</div><div class="sec-value">${escapeHtml(subjBestClsObj.cls)}</div><div class="sec-sub">Ort: ${subjBestClsObj.avg.toFixed(2)} Net</div></div></div></div>
        <div class="col-12 col-md-4 col-lg flex-fill mb-2"><div class="sec-card sec-neg h-100"><div class="sec-icon"><i class="fas fa-exclamation-circle"></i></div><div class="sec-body"><div class="sec-label">En Zayıf Sınıf</div><div class="sec-value">${escapeHtml(subjWorstClsObj.cls)}</div><div class="sec-sub">Ort: ${subjWorstClsObj.avg.toFixed(2)} Net</div></div></div></div>
      </div>`;
    }

    // Satır 3: En İyi Öğrenci | En Zayıf Öğrenci
    let subjRow3Html = `<div class="row g-2 sec-cards-row analysis-info-cards subject-info-cards mb-2">
      <div class="col-12 col-md-6 col-lg flex-fill mb-2"><div class="sec-card sec-pos h-100"><div class="sec-icon"><i class="fas fa-trophy"></i></div><div class="sec-body"><div class="sec-label">En İyi Öğrenci</div><div class="sec-value sec-value-small">${bestStudent ? `${escapeHtml(bestStudent.name)} (${escapeHtml(bestStudent.cls)})` : 'Veri Yok'}</div><div class="sec-sub">${bestStudent ? `${bestStudent.avg.toFixed(2)} Net (Ort.)` : ''}</div></div></div></div>
      <div class="col-12 col-md-6 col-lg flex-fill mb-2"><div class="sec-card sec-neg h-100"><div class="sec-icon"><i class="fas fa-exclamation-triangle"></i></div><div class="sec-body"><div class="sec-label">En Zayıf Öğrenci</div><div class="sec-value sec-value-small">${worstStudent ? `${escapeHtml(worstStudent.name)} (${escapeHtml(worstStudent.cls)})` : 'Veri Yok'}</div><div class="sec-sub">${worstStudent ? `${worstStudent.avg.toFixed(2)} Net (Ort.)` : ''}</div></div></div></div>
    </div>`;

    let subjTitle = toTitleCase(subj);
    let subjReportName = safeFileName(`${subjTitle}_Analizi`);
    let h = `
    <div class="d-flex justify-content-end mb-2 no-print"><button class="btn-print no-print" onclick="xPR('pSubj',${jsArg(subjReportName)},this)"><i class='fas fa-print me-1'></i>Yazdır</button></div>
    <div id="pSubj" class="card shadow-sm report-card sa-report-primary sa-report-soft">
      <div class="report-header">
        <span class="report-title-main"><i class="fas fa-book-open me-2"></i><strong>${escapeHtml(subjTitle)}</strong> — Ders Analizi</span>
        <span class="report-title-sub">${escapeHtml(eT)} | ${escapeHtml(lvlStr)} | Toplam ${dates.length} Sınav</span>
      </div>
      <div class="card-body report-card-body">
        ${subjRow1Html}
        ${subjRow2Html}
        ${subjRow3Html}
        ${subjTrendHtml}
        <div id="subjBoxPlotArea"></div>
        <div class="row analysis-list-group subject-list-group">
          <div class="col-lg-4"><div class="card shadow-sm avoid-break"><div class="card-header sa-list-header sa-list-success"><h3 class="card-title m-0"><i class="fas fa-trophy me-1"></i> En İyi 5 Öğrenci</h3></div><div class="card-body p-0 table-responsive"><table class="table table-sm table-striped m-0 table-compact"><thead><tr><th>#</th><th>Ad Soyad</th><th>Sınıf</th><th>Ort.Net</th></tr></thead><tbody>${top5.map((s,i) => `<tr><td>${i+1}</td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.cls)}</td><td><strong>${s.avg.toFixed(2)}</strong></td></tr>`).join('')}</tbody></table></div></div></div>
          <div class="col-lg-4"><div class="card shadow-sm avoid-break"><div class="card-header sa-list-header sa-list-danger"><h3 class="card-title m-0"><i class="fas fa-exclamation-circle me-1"></i> En Düşük 5 Öğrenci</h3></div><div class="card-body p-0 table-responsive"><table class="table table-sm table-striped m-0 table-compact"><thead><tr><th>#</th><th>Ad Soyad</th><th>Sınıf</th><th>Ort.Net</th></tr></thead><tbody>${bottom5.map((s,i) => `<tr><td>${i+1}</td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.cls)}</td><td><strong>${s.avg.toFixed(2)}</strong></td></tr>`).join('')}</tbody></table></div></div></div>
          <div class="col-lg-4"><div class="card shadow-sm avoid-break"><div class="card-header sa-list-header sa-list-info"><h3 class="card-title m-0"><i class="fas fa-school me-1"></i> Sınıf Ortalamaları</h3></div><div class="card-body p-0 table-responsive table-scroll-compact"><table class="table table-sm table-striped m-0 table-compact"><thead><tr><th>#</th><th>Sınıf</th><th>Ort.Net</th><th>Kayıt</th></tr></thead><tbody>${clsArr.map((c,i) => `<tr><td>${i+1}</td><td>${escapeHtml(c.cls)}</td><td><strong>${c.avg.toFixed(2)}</strong></td><td>${c.count}</td></tr>`).join('')}</tbody></table></div></div></div>
        </div>
        ${_sjMinCnt > 1 ? `<div class="text-muted small mt-1">En iyi/en düşük öğrenci sıralamalarına, seçili sınavların en az yarısına (en az ${_sjMinCnt} sınav) giren öğrenciler dahildir.</div>` : ''}
        <div class="single-exam-chart-title chart-section-title"><i class="fas fa-chart-line"></i>${escapeHtml(subjTitle)} — Sınıf Ortalamaları Grafiği</div>
        <div class="chart-box chart-box-lg mt-3 avoid-break"><canvas id="cA"></canvas></div>
      </div>
    </div>`;
    r.innerHTML = h;
    
    chartTimer=setTimeout(()=>{
      let datePublisherMap2 = {}; Object.values(EXAM_META).forEach(m => { if(m.examType===eT && m.publisher) datePublisherMap2[m.date]=m.publisher; });
      let dateLabels = dates.map(dt => datePublisherMap2[dt] ? `${dt} (${toTitleCase(datePublisherMap2[dt])})` : dt);
      let clsList =[...new Set(ex.map(e=>e.studentClass))].sort();
      let datasets = clsList.map((cls, i) => ({ label: cls, backgroundColor: cols[i % cols.length] + 'cc', borderColor: cols[i % cols.length], borderWidth: 1.5, data: dates.map(dt => { let clsExams = dateGroups[dt].filter(e => e.studentClass === cls); if(clsExams.length === 0) return null; return clsExams.reduce((a,e) => a + e.subs[toTitleCase(subj)].net, 0) / clsExams.length; }) }));
      c.a = mkChart('cA', dateLabels, datasets);
      let subjBPArea = getEl('subjBoxPlotArea');
      let totalExamsOfType = new Set(Object.values(EXAM_META).filter(m => m.examType === eT).map(m => m.date)).size;
      if(subjBPArea && totalExamsOfType >= 10) {
        let subjectClassMap = {};
        clsList.forEach(cls => {
          let vals = ex.filter(e => e.studentClass === cls).map(e => e.subs[toTitleCase(subj)].net);
          if(vals.length >= 3) subjectClassMap[cls] = vals;
        });
        if(Object.keys(subjectClassMap).length >= 1) {
          let lvlForSubjBP = lvl || (ex.length > 0 ? getGrade(ex[0].studentClass) : '');
          let allGradeSubjVals = DB.e.filter(e => e.examType===eT && !e.abs && e.subs[toTitleCase(subj)] && (lvlForSubjBP ? getGrade(e.studentClass)===lvlForSubjBP : true)).map(e => e.subs[toTitleCase(subj)].net);
          let multiSVG = mkMultiClassBoxPlot(subjectClassMap, null, {height:220}, allGradeSubjVals.length >= 3 ? allGradeSubjVals : null);
          if(multiSVG) {
            subjBPArea.innerHTML = `<div class="boxplot-card mt-2 mb-3"><div class="boxplot-title"><i class="fas fa-box-open me-1 text-success"></i>Sınıflar Arası Dağılım — ${escapeHtml(toTitleCase(subj))}</div>${multiSVG}</div>`;
          }
        }
      }
    }, 100);

  }else if(aT==='examdetail'){
    let dt = typeof getAnalysisDateValue === 'function' ? getAnalysisDateValue() : getEl('aDate').value, subSel = sb || 'summary';
    if(subSel !== 'general_summary' && subSel !== 'list_all' && !dt){r.innerHTML='<div class="alert alert-default-info">Sınav seçiniz.</div>';return;}
    let lvl = getEl('aLvl') ? getEl('aLvl').value : '', baseExams = DB.e.filter(x => x.examType === eT);
    let targetLvl = lvl; if (!targetLvl && aNo) { let st = getStuMap().get(aNo); if(st) targetLvl = getGrade(st.class); }
    if (targetLvl) { baseExams = baseExams.filter(x => getGrade(x.studentClass) === targetLvl); }
    let brFilterED = getBrVal();
    if (brFilterED) { baseExams = baseExams.filter(x => getClassParts(x.studentClass).branch === brFilterED); }

    let getName = (no) => getStuMap().get(no)?.name || 'Bilinmiyor';

    if(subSel === 'general_summary') {
        let _validNosGS = new Set(DB.s.map(s=>s.no));
        let ex = baseExams.filter(x => !x.abs && _validNosGS.has(x.studentNo)); if(ex.length === 0) { r.innerHTML = '<div class="alert alert-default-warning">Bu filtrelere uygun sınav sonucu bulunamadı.</div>'; return; }
        let dates = [...new Set(ex.map(x=>x.date))].sort(srt), stuStats = {}, gsDateStat = {}; 
        dates.forEach(d => {
            let exDt = ex.filter(x => x.date === d).sort((a,b) => { let dp=(b.score||0)-(a.score||0); if(dp!==0) return dp; return (b.totalNet||0)-(a.totalNet||0); }); if(!exDt.length) return;
            // Sınav içi puan ortalaması/SS: ilerleme eğimi sınavlar arası zorluk-ölçek farkından arındırılmış (z) puanlarla hesaplanır
            let _sc = exDt.map(x => x.score).filter(v => v !== null && v !== undefined && isFinite(v)), _scSd = _statStd(_sc);
            gsDateStat[d] = (_sc.length >= 5 && _scSd > 0) ? { m: _sc.reduce((a,b)=>a+b,0)/_sc.length, sd: _scSd } : null;
            let firstScore = exDt[0].score;
            exDt.forEach((e, idx) => {
                if(!stuStats[e.studentNo]) stuStats[e.studentNo] = { no: e.studentNo, name: getName(e.studentNo), cls: e.studentClass, first:0, top5:0, bottom5:0, exList:[] };
                stuStats[e.studentNo].exList.push(e);
                if(e.score === firstScore) stuStats[e.studentNo].first++;
                if(idx < 5) stuStats[e.studentNo].top5++;
                if(idx >= exDt.length - 5) stuStats[e.studentNo].bottom5++;
            });
        });

        let progressArr =[];
        Object.values(stuStats).forEach(st => {
            st.exList.sort((a,b) => srt(a.date, b.date));
            // En az _PROGRESS_MIN_N sınav ve her sınavda standartlaştırma yapılabilmesi şartı (2-3 noktalı eğimler gürültülüdür)
            let _zs = st.exList.length >= _PROGRESS_MIN_N ? st.exList.map(e => { let s = gsDateStat[e.date]; return (s && e.score !== null && e.score !== undefined) ? (e.score - s.m) / s.sd : null; }) : null;
            if(_zs && !_zs.some(z => z === null)) {
              let nets   = st.exList.map(e => e.totalNet);
              let slopeScore = linRegSlope(_zs);              // sınav başına SS cinsinden eğim
              let slopeNet   = linRegSlope(nets);
              let regChange = slopeScore * (_zs.length - 1);  // seri boyunca toplam değişim (SS)
              let firstEx = st.exList[0], lastEx = st.exList[st.exList.length - 1];
              progressArr.push({ ...st, diff: regChange, slope: slopeScore, slopeNet, examCount: _zs.length, firstNet: firstEx.totalNet, lastNet: lastEx.totalNet, firstScore: firstEx.score, lastScore: lastEx.score });
            }
            let tNet = 0, tScore = 0; st.exList.forEach(e => { tNet+=e.totalNet; tScore+=e.score; }); st.avgNet = tNet / st.exList.length; st.avgScore = tScore / st.exList.length;
        });

        progressArr.sort((a,b) => b.diff - a.diff);
        let bestP = progressArr.length > 0 && progressArr[0].diff > 0 ? progressArr[0] : null, worstP = progressArr.length > 0 && progressArr[progressArr.length-1].diff < 0 ? progressArr[progressArr.length-1] : null;

        let firstDate = dates[0], lastDate = dates[dates.length - 1], subDiffs =[];
        if (dates.length >= 2) {
            let firstExams = ex.filter(x => x.date === firstDate), lastExams = ex.filter(x => x.date === lastDate), allSubs = new Set([...firstExams, ...lastExams].flatMap(e => Object.keys(e.subs)));
            allSubs.forEach(sub => {
                let fSum = 0, fCount = 0; firstExams.forEach(e => { if(e.subs[sub]) { fSum+=e.subs[sub].net; fCount++; } });
                let lSum = 0, lCount = 0; lastExams.forEach(e => { if(e.subs[sub]) { lSum+=e.subs[sub].net; lCount++; } });
                if(fCount > 0 && lCount > 0) { subDiffs.push({ sub, diff: (lSum / lCount) - (fSum / fCount), fAvg: fSum / fCount, lAvg: lSum / lCount }); }
            });
            subDiffs.sort((a,b) => b.diff - a.diff);
        }
        let bestSub = subDiffs.length > 0 && subDiffs[0].diff > 0 ? subDiffs[0] : null, worstSub = subDiffs.length > 0 && subDiffs[subDiffs.length-1].diff < 0 ? subDiffs[subDiffs.length-1] : null;

        let mostFirstArr = Object.values(stuStats).filter(x=>x.first > 0).sort((a,b) => { let df = b.first - a.first; if(df !== 0) return df; return (b.avgScore||0) - (a.avgScore||0); });
        let mostFirst = mostFirstArr.length > 0 ? mostFirstArr[0] : null;
        let mostFirstTie = mostFirst && mostFirstArr.length > 1 && mostFirstArr[1].first === mostFirst.first;
        let top5List = Object.values(stuStats).filter(x=>x.top5 > 0).sort((a,b) => b.top5 - a.top5).slice(0,5), bottom5List = Object.values(stuStats).filter(x=>x.bottom5 > 0).sort((a,b) => b.bottom5 - a.bottom5).slice(0,5);
        let buildRow = (e, i, prop, countLabel) => `<tr><td>${i+1}</td><td>${escapeHtml(e.no)}</td><td>${escapeHtml(e.name)}</td><td>${escapeHtml(e.cls)}</td><td><strong>${e[prop]} ${escapeHtml(countLabel)}</strong></td><td>${e.avgNet.toFixed(2)}</td><td>${e.avgScore.toFixed(2)}</td></tr>`;
        let top5Html = top5List.length ? top5List.map((e,i) => buildRow(e, i, 'top5', 'kez')).join('') : '<tr><td colspan="7" class="text-center">Veri yok</td></tr>';
        let bottom5Html = bottom5List.length ? bottom5List.map((e,i) => buildRow(e, i, 'bottom5', 'kez')).join('') : '<tr><td colspan="7" class="text-center">Veri yok</td></tr>';
        let lvlStr = (targetLvl ? `${targetLvl}. Sınıflar` : '') + (brFilterED ? ` / ${brFilterED} Şubesi` : '') + ' ', safeName = safeFileName(`${eT}_Genel_Ozet`);

        let { baseCount: baseCountGS, attendedCount: attendedCountGS, rate: partRateGS } = _calcParticipation({ examType: eT, lvl: targetLvl, br: brFilterED, looseClass: true });

        // Tüm Sınavlar istatistik kartları: her öğrencinin ortalama neti baz alınır
        let _gsAvgNets = Object.values(stuStats).filter(s => s.avgNet !== undefined && s.exList && s.exList.length > 0).map(s => s.avgNet);
        let gsStatsHtml = '';
        if (_gsAvgNets.length >= 5) {
          let _gsMean = _statMean(_gsAvgNets);
          let _gsStd  = _statStd(_gsAvgNets);
          let _gsMed  = _statMedian(_gsAvgNets);
          let _gsQ    = _statQuartiles(_gsAvgNets);
          let _gsCV   = _statCV(_gsAvgNets);
          let _gsHomLab = _homogeneityLabel(_gsCV);
          let { color: _gsIqrColor, label: _gsIqrLabel } = _iqrSpreadInfo(_gsQ.iqr, _gsMed);
          // Sınıf bazlı ortalama net (Tüm Sınavlar bağlamı için)
          let _gsClsAvg = {};
          Object.values(stuStats).forEach(s => { if (!_gsClsAvg[s.cls]) _gsClsAvg[s.cls] = []; _gsClsAvg[s.cls].push(s.avgNet); });
          let _gsClsHtml = Object.keys(_gsClsAvg).sort().map(cls => `<span class="summary-pill"><strong>${escapeHtml(cls)}:</strong> ${(_gsClsAvg[cls].reduce((a,b)=>a+b,0)/_gsClsAvg[cls].length).toFixed(2)}</span>`).join('');
          gsStatsHtml = `
              <div class="row g-2 sec-cards-row analysis-info-cards exam-info-cards mt-2">
                <div class="col-12"><div class="sec-card"><div class="sec-icon"><i class="fas fa-chart-bar"></i></div><div class="sec-body"><div class="sec-label">Ortalama Net <small class="sec-label-note">(Tüm Sınavlar)</small></div><div class="sec-value">${_gsMean.toFixed(2)} Net</div>${_gsClsHtml ? `<div class="sec-sub summary-pills">${_gsClsHtml}</div>` : ''}</div></div></div>
              </div>
              ${_trendStatBlock([
                _trendStatItem(
                  'Ortalamadan Uzaklık (Standart Sapma)',
                  `±${_gsStd.toFixed(2)}`,
                  `${_gsHomLab}`,
                  'Öğrencilerin tüm sınav ortalamalarının genel ortalama etrafındaki yayılımı. Düşükse grup homojen.',
                  ''
                ),
                _trendStatItem(
                  'Medyan Net',
                  `${_gsMed.toFixed(2)}`,
                  `Ortalama: ${_gsMean.toFixed(2)}`,
                  'Öğrenciler kendi sınav ortalamalarına göre sıralandığında ortadaki değer. Ortalamadan belirgin farklıysa dağılım çarpıktır.',
                  ''
                ),
                _trendStatItem(
                  'Çeyrekler Arası Aralık (IQR)',
                  `<span style="color:${_gsIqrColor};">${_gsQ.iqr.toFixed(2)}</span>`,
                  `<span style="color:${_gsIqrColor};font-weight:600;">${_gsIqrLabel}</span><br>Q1: ${_gsQ.q1.toFixed(2)} · Q3: ${_gsQ.q3.toFixed(2)}`,
                  'IQR, öğrencilerin orta yüzde 50’lik bölümünün genişliğini gösterir; büyüdükçe seviye farkı artar.',
                  ''
                )
              ])}`;
        }

        let h = `<div class="d-flex justify-content-end mb-2 no-print"><button class="btn-print no-print" onclick="xPR('pGenSummary',${jsArg(safeName)},this)"><i class='fas fa-print me-1'></i>Yazdır</button></div>
        <div id="pGenSummary" class="card shadow-sm report-card sa-report-soft">
          <div class="report-header">
              <span class="report-title-main"><i class="fas fa-globe me-2"></i><strong>${escapeHtml(eT)}</strong> — Sınav Özeti (Tüm Sınavlar)</span>
              <span class="report-title-sub">${escapeHtml(lvlStr)} | Toplam ${dates.length} Sınav</span>
            </div>
            <div class="card-body report-card-body">
              <div class="row g-2 sec-cards-row analysis-info-cards exam-info-cards">
                  <div class="col-12 col-md-4"><div class="sec-card"><div class="sec-icon"><i class="fas fa-trophy"></i></div><div class="sec-body"><div class="sec-label">En Çok Birinci Olan</div><div class="sec-value sec-value-compact">${mostFirst ? `${escapeHtml(mostFirst.name)} <small>(${escapeHtml(mostFirst.cls)})</small>` : 'Veri Yok'}</div><div class="sec-sub">${mostFirst ? `Toplam ${mostFirst.first} kez birinci oldu${mostFirstTie ? ' (Puan Üstünlüğü)' : ''}` : ''}</div></div></div></div>
                  <div class="col-12 col-md-4"><div class="sec-card sec-pos"><div class="sec-icon"><i class="fas fa-chart-line"></i></div><div class="sec-body"><div class="sec-label">En Fazla İlerleme Kaydeden</div><div class="sec-value sec-value-compact">${bestP ? `${escapeHtml(bestP.name)} <small>(${escapeHtml(bestP.cls)})</small>` : 'Veri Yok'}</div><div class="sec-sub">${bestP ? `+${bestP.diff.toFixed(2)} SS toplam eğim (${bestP.firstScore.toFixed(2)} -> ${bestP.lastScore.toFixed(2)} puan)` : `En az ${_PROGRESS_MIN_N} sınava giren yok`}</div></div></div></div>
                  <div class="col-12 col-md-4"><div class="sec-card sec-neg"><div class="sec-icon"><i class="fas fa-level-down-alt"></i></div><div class="sec-body"><div class="sec-label">En Fazla Gerileme Kaydeden</div><div class="sec-value sec-value-compact">${worstP ? `${escapeHtml(worstP.name)} <small>(${escapeHtml(worstP.cls)})</small>` : 'Veri Yok'}</div><div class="sec-sub">${worstP ? `${worstP.diff.toFixed(2)} SS toplam eğim (${worstP.firstScore.toFixed(2)} -> ${worstP.lastScore.toFixed(2)} puan)` : `En az ${_PROGRESS_MIN_N} sınava giren yok`}</div></div></div></div>
              </div>
              <div class="row g-2 sec-cards-row analysis-info-cards exam-info-cards mt-2">
                  <div class="col-12 col-md-4"><div class="sec-card sec-pos"><div class="sec-icon"><i class="fas fa-arrow-up"></i></div><div class="sec-body"><div class="sec-label">Genel Ort. En Çok Artan Ders</div><div class="sec-value sec-value-compact">${bestSub ? escapeHtml(toTitleCase(bestSub.sub)) : 'Veri Yok'}</div><div class="sec-sub">${bestSub ? `+${bestSub.diff.toFixed(2)} Net (${bestSub.fAvg.toFixed(2)} -> ${bestSub.lAvg.toFixed(2)})` : 'Karşılaştırma için veri yetersiz'}</div></div></div></div>
                  <div class="col-12 col-md-4"><div class="sec-card sec-neg"><div class="sec-icon"><i class="fas fa-arrow-down"></i></div><div class="sec-body"><div class="sec-label">Ortalaması En Çok Düşen Ders</div><div class="sec-value sec-value-compact">${worstSub ? escapeHtml(toTitleCase(worstSub.sub)) : 'Veri Yok'}</div><div class="sec-sub">${worstSub ? `${worstSub.diff.toFixed(2)} Net (${worstSub.fAvg.toFixed(2)} -> ${worstSub.lAvg.toFixed(2)})` : 'Karşılaştırma için veri yetersiz'}</div></div></div></div>
                  <div class="col-12 col-md-4"><div class="sec-card sec-neutral"><div class="sec-icon"><i class="fas fa-users"></i></div><div class="sec-body"><div class="sec-label">Genel Katılım Oranı</div><div class="sec-value sec-value-compact">%${partRateGS}</div><div class="sec-sub">${attendedCountGS} / ${baseCountGS} Katılım</div></div></div></div>
              </div>

              ${gsStatsHtml}

              <div id="genSummaryBPArea"></div>
              <div class="row mt-3 analysis-list-group exam-rank-tables">
                  <div class="col-lg-6"><div class="card shadow-sm avoid-break"><div class="card-header sa-list-header sa-list-success"><h3 class="card-title m-0"><i class="fas fa-angle-double-up me-1"></i> En Çok İlk 5'e Girenler</h3></div><div class="card-body p-0 table-responsive"><table class="table table-sm table-striped m-0 table-readable"><thead><tr><th>Sıra</th><th>No</th><th>Ad Soyad</th><th>Sınıf</th><th>Sayı</th><th>Ort.Net</th><th>Ort.Puan</th></tr></thead><tbody>${top5Html}</tbody></table></div></div></div>
                  <div class="col-lg-6"><div class="card shadow-sm avoid-break"><div class="card-header sa-list-header sa-list-danger"><h3 class="card-title m-0"><i class="fas fa-angle-double-down me-1"></i> En Çok Son 5'e Girenler</h3></div><div class="card-body p-0 table-responsive"><table class="table table-sm table-striped m-0 table-readable"><thead><tr><th>Sıra</th><th>No</th><th>Ad Soyad</th><th>Sınıf</th><th>Sayı</th><th>Ort.Net</th><th>Ort.Puan</th></tr></thead><tbody>${bottom5Html}</tbody></table></div></div></div>
              </div>
              <div id="genSummaryChartArea" class="chart-box chart-box-xl avoid-break mt-3" style="display:none;"><canvas id="cGenSummaryBar"></canvas></div>
            </div>
        </div>`; r.innerHTML = h;
        setTimeout(() => {
          let bpArea = getEl('genSummaryBPArea');
          let totalExamsOfType = new Set(Object.values(EXAM_META).filter(m => m.examType === eT).map(m => m.date)).size;
          if(bpArea && totalExamsOfType >= 10) {
            let genClassMap = {};
            Object.values(stuStats).forEach(s => {
              if(!s.exList || !s.exList.length) return;
              if(!genClassMap[s.cls]) genClassMap[s.cls] = [];
              genClassMap[s.cls].push(s.avgNet);
            });
            let validClsMap = Object.fromEntries(Object.entries(genClassMap).filter(([c,v])=>v.length>=3));
            let lvlForGenBP = targetLvl || '';
            let allGradeStus = DB.e.filter(x => x.examType===eT && !x.abs && (lvlForGenBP ? getGrade(x.studentClass)===lvlForGenBP : true) && (!brFilterED || getClassParts(x.studentClass).branch===brFilterED));
            let gradeStudentAvgs = {};
            allGradeStus.forEach(e => {
              if(!gradeStudentAvgs[e.studentNo]) gradeStudentAvgs[e.studentNo] = [];
              gradeStudentAvgs[e.studentNo].push(e.totalNet);
            });
            let allGradeStuAvgVals = Object.values(gradeStudentAvgs).map(arr => arr.reduce((a,b)=>a+b,0)/arr.length);
            if(allGradeStuAvgVals.length >= 3 && Object.keys(validClsMap).length >= 1) {
              let multiGSBP = mkMultiClassBoxPlot(validClsMap, null, {height:220}, allGradeStuAvgVals);
              if(multiGSBP) {
                bpArea.innerHTML = `<div class="boxplot-card mb-3"><div class="boxplot-title"><i class="fas fa-box-open me-1 text-success"></i>Sınıflar Arası Dağılım — Öğrenci Ort. Bazlı</div>${multiGSBP}</div>`;
              }
            }
          }

          let clsScoreMapGS = {};
          Object.values(stuStats).forEach(s => {
            if(!s.exList || !s.exList.length) return;
            let cls = s.cls;
            if(!clsScoreMapGS[cls]) clsScoreMapGS[cls] = { netSum: 0, cnt: 0 };
            clsScoreMapGS[cls].netSum += s.avgNet;
            clsScoreMapGS[cls].cnt++;
          });
          let gsBarLabels = Object.keys(clsScoreMapGS).sort();
          let gsBarData = gsBarLabels.map(cls => clsScoreMapGS[cls].cnt ? clsScoreMapGS[cls].netSum / clsScoreMapGS[cls].cnt : 0);
          let gsCv = getEl('cGenSummaryBar');
          if(gsCv && gsBarLabels.length > 0) {
            let gsChartArea = getEl('genSummaryChartArea');
            if(gsChartArea) gsChartArea.style.display = 'block';
            try { let _prev = Chart.getChart && Chart.getChart('cGenSummaryBar'); if(_prev) _prev.destroy(); } catch(e){}
            new Chart(gsCv, {
              type: 'bar',
              data: {
                labels: gsBarLabels,
                datasets:[{ label: 'Ortalama Net', data: gsBarData, backgroundColor: cols.map(c=>c+'cc'), borderColor: cols, borderWidth: 1.5 }]
              },
              plugins:[ChartDataLabels],
              options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                plugins: {
                  legend: { display: false },
                  datalabels: { display: false }
                },
                scales: {
                  x: { grid: { color: '#e2e8f0' }, ticks: { font: { size: 10 } } },
                  y: { grid: { color: '#e2e8f0' }, ticks: { font: { size: 10 } }, title: { display: true, text: 'Ortalama Net', font: { size: 10 } } }
                }
              }
            });
            if(gsChartArea && !gsChartArea.dataset.titleAdded) {
              let title = document.createElement('div');
              title.className = 'single-exam-chart-title chart-section-title';
              title.textContent = `${eT} — Sınıf Bazlı Ortalama Net (Tüm Sınavlar)`;
              gsChartArea.parentNode.insertBefore(title, gsChartArea);
              gsChartArea.dataset.titleAdded = 'true';
            }
          }
        }, 50);

    } else if (subSel === 'summary') {
      let batch = baseExams.filter(x => x.date === dt), currentExams = batch.filter(x => !x.abs);
      if (!currentExams.length) { r.innerHTML='<div class="alert alert-default-warning">Bu sınavda geçerli sonuç bulunmuyor.</div>'; return; }

      let filteredDates =[...new Set(baseExams.map(x=>x.date))].sort(srt), currentIndex = filteredDates.indexOf(dt), prevDate = currentIndex > 0 ? filteredDates[currentIndex - 1] : null;
      let isFirstExam = (currentIndex === 0 || prevDate === null);
      let prevBatch = prevDate ? DB.e.filter(x => x.examType === eT && x.date === prevDate) :[];
      if(targetLvl) prevBatch = prevBatch.filter(x => getGrade(x.studentClass) === targetLvl);
      if(brFilterED) prevBatch = prevBatch.filter(x => getClassParts(x.studentClass).branch === brFilterED);
      let prevExams = prevBatch.filter(x => !x.abs), sortedExams = [...currentExams].sort((a,b) => { let dp=(b.score||0)-(a.score||0); if(dp!==0) return dp; return (b.totalNet||0)-(a.totalNet||0); }), winner = sortedExams[0], progress =[];
      
      let _validNosSum = new Set(DB.s.map(s=>s.no));
      currentExams = currentExams.filter(x => _validNosSum.has(x.studentNo));
      prevExams = prevExams.filter(x => _validNosSum.has(x.studentNo));
      currentExams.forEach(ce => { let pe = prevExams.find(x => x.studentNo === ce.studentNo); if (pe) progress.push({ no: ce.studentNo, name: getName(ce.studentNo), cls: ce.studentClass, diff: ce.totalNet - pe.totalNet, cur: ce.totalNet, prev: pe.totalNet }); });
      progress.sort((a,b) => b.diff - a.diff);
      let bestP = progress.length > 0 && progress[0].diff > 0 ? progress[0] : null, worstP = progress.length > 0 && progress[progress.length-1].diff < 0 ? progress[progress.length-1] : null;

      let subStats = {};
      let popStats = (exams, key) => { exams.forEach(ex => { Object.keys(ex.subs).forEach(sub => { if (!subStats[sub]) subStats[sub] = { curSum: 0, curCount: 0, prevSum: 0, prevCount: 0 }; subStats[sub][key + 'Sum'] += ex.subs[sub].net; subStats[sub][key + 'Count']++; }); }); };
      popStats(currentExams, 'cur'); popStats(prevExams, 'prev');
      let subDiffs =[];
      Object.keys(subStats).forEach(sub => { let curAvg = subStats[sub].curCount > 0 ? subStats[sub].curSum / subStats[sub].curCount : 0; let prevAvg = subStats[sub].prevCount > 0 ? subStats[sub].prevSum / subStats[sub].prevCount : 0; if (subStats[sub].prevCount > 0 && subStats[sub].curCount > 0) { subDiffs.push({ sub, diff: curAvg - prevAvg, curAvg, prevAvg }); } });
      subDiffs.sort((a,b) => b.diff - a.diff);
      let bestSub = subDiffs.length > 0 && subDiffs[0].diff > 0 ? subDiffs[0] : null, worstSub = subDiffs.length > 0 && subDiffs[subDiffs.length-1].diff < 0 ? subDiffs[subDiffs.length-1] : null;

      let buildRow = (e, i) => `<tr><td>${i+1}</td><td>${escapeHtml(e.no)}</td><td>${escapeHtml(getName(e.no))}</td><td>${escapeHtml(e.cls)}</td><td><strong>${e.totalNet.toFixed(2)}</strong></td><td>${e.score.toFixed(2)}</td></tr>`;
      let top5Html = sortedExams.slice(0,5).map((e,i) => buildRow({no:e.studentNo, cls:e.studentClass, totalNet:e.totalNet, score:e.score}, i)).join('');
      let bottomExams = [...sortedExams].reverse().slice(0,5); 
      let bottom5Html = bottomExams.map((e,i) => buildRow({no:e.studentNo, cls:e.studentClass, totalNet:e.totalNet, score:e.score}, i)).join('');
      
      let safeName = safeFileName(`${eT}_${String(dt).replace(/\./g,'-')}_Ozet`), lvlStr = (targetLvl ? `${targetLvl}. Sınıflar` : '') + (brFilterED ? ` / ${brFilterED} Şubesi` : '') + ' ';
      let pubName = Object.values(EXAM_META).find(m=>m.date===dt&&m.examType===eT)?.publisher || '';
      
      let thisExamMeta = Object.values(EXAM_META).find(m=>m.date===dt && m.examType===eT);
      // examGrades: sınav metasında belirli sınıf seviyeleri varsa filtrele.
      // Ancak targetLvl zaten seçilmişse (kullanıcı seviye seçti) examGrades filtresini atla;
      // çünkü metadata 9. sınıf olarak kayıtlı bir sınavı 10/11. sınıf öğrencisi de girebilir.
      let examGrades = (!targetLvl && metaGrades(thisExamMeta).length) ? new Set(metaGrades(thisExamMeta)) : null;
      let eligibleStusE = DB.s.filter(s => {
        let m = s.class.match(/^(\d+)([a-zA-ZğüşıöçĞÜŞİÖÇ]+)$/); if(!m) return false;
        if(targetLvl && m[1] !== targetLvl) return false;
        if(brFilterED && m[2].toLocaleUpperCase('tr-TR') !== brFilterED) return false;
        if(examGrades && !examGrades.has(m[1])) return false;
        return true;
      });
      // attendedNos öne alındı: hem partRateE hem absentStus hesabında kullanılır
      let attendedNos = new Set(currentExams.map(e => e.studentNo));
      let partRateE = eligibleStusE.length > 0 ? Math.max(0, Math.min(100, Math.round((attendedNos.size / eligibleStusE.length) * 100))) : 0;
      let examAvgNet = currentExams.reduce((s,e)=>s+e.totalNet,0)/currentExams.length;
      let examClassAvgHtml = (() => {
        let _cm = {};
        currentExams.forEach(e => {
          if(!_cm[e.studentClass]) _cm[e.studentClass] = [];
          _cm[e.studentClass].push(e.totalNet);
        });
        return Object.keys(_cm).sort().map(cls => `<span class="summary-pill"><strong>${escapeHtml(cls)}:</strong> ${(_cm[cls].reduce((a,b)=>a+b,0)/_cm[cls].length).toFixed(2)}</span>`).join('');
      })();

      // Tek sınav istatistik kartı: Std + Medyan + IQR (yalnızca n>=5 öğrenci varsa anlamlı)
      let examStatsHtml = '';
      let examNets = currentExams.map(e => e.totalNet).filter(v => v !== null && v !== undefined);
      if(examNets.length >= 5) {
        let _eMean = _statMean(examNets);
        let _eStd  = _statStd(examNets);
        let _eMed  = _statMedian(examNets);
        let _eQ    = _statQuartiles(examNets);
        let _eCV   = _statCV(examNets);
        let _eHomLab = _homogeneityLabel(_eCV);
        let { color: _iqrColor, label: _iqrLabel } = _iqrSpreadInfo(_eQ.iqr, _eMed);
        examStatsHtml = _trendStatBlock([
          _trendStatItem(
            'Ortalamadan Uzaklık (Standart Sapma)',
            `±${_eStd.toFixed(2)}`,
            `${_eHomLab}`,
            'Öğrenci netlerinin ortalama etrafındaki yayılımı. Düşükse grup homojen.',
            ''
          ),
          _trendStatItem(
            'Medyan Net',
            `${_eMed.toFixed(2)}`,
            `Ortalama: ${_eMean.toFixed(2)}`,
            'Sıralandığında ortadaki öğrencinin neti. Aşırı uçlardan etkilenmez; ortalamadan farklıysa dağılım çarpıktır.',
            ''
          ),
          _trendStatItem(
            'Çeyrekler Arası Aralık (IQR)',
            `<span style="color:${_iqrColor};">${_eQ.iqr.toFixed(2)}</span>`,
            `<span style="color:${_iqrColor};font-weight:600;">${_iqrLabel}</span><br>Q1: ${_eQ.q1.toFixed(2)} · Q3: ${_eQ.q3.toFixed(2)}`,
            'IQR, öğrencilerin orta yüzde 50’lik bölümünün genişliğini gösterir; büyüdükçe seviye farkı artar.',
            ''
          )
        ]);
      }

      // Katılmayan öğrenci listesi: "Katılım %82" kartı hangi %18'in kim olduğunu söylemiyor.
      // Ders öğretmeni sınav sonucunu incelerken katılmayanları doğrudan bu sayfadan görebilmeli.
      let absentStus  = eligibleStusE.filter(s => !attendedNos.has(s.no));
      let absentListHtml = '';
      if(absentStus.length > 0) {
        let absentRows = absentStus.map((s, i) => `<tr><td>${i+1}</td><td>${escapeHtml(s.no)}</td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.class)}</td></tr>`).join('');
        absentListHtml = `<div class="card shadow-sm mt-3 avoid-break">
          <div class="card-header sa-list-header sa-list-warning">
            <h3 class="card-title card-title-sm m-0"><i class="fas fa-user-times me-1"></i> Sınava Katılmayan Öğrenciler (${absentStus.length} kişi)</h3>
          </div>
          <div class="card-body p-0 table-responsive">
            <table class="table table-sm table-striped m-0 table-compact">
              <thead><tr><th>#</th><th>No</th><th>Ad Soyad</th><th>Sınıf</th></tr></thead>
              <tbody>${absentRows}</tbody>
            </table>
          </div>
        </div>`;
      }

      let summaryReportName = safeFileName(`Sinav_Ozeti_${safeName}`);
      let h = `<div class="d-flex justify-content-end mb-2 no-print"><button class="btn-print no-print" onclick="xPR('pSummary',${jsArg(summaryReportName)},this)"><i class='fas fa-print me-1'></i>Yazdır</button></div>
      <div id="pSummary" class="card shadow-sm report-card sa-report-info sa-report-soft">
        <div class="report-header">
            <span class="report-title-main"><i class="fas fa-file-alt me-2"></i>${escapeHtml(dt)} Sınav Değerlendirmesi</span>
            <span class="report-title-sub">${escapeHtml(eT)}${pubName ? ' / ' + escapeHtml(toTitleCase(pubName)) : ''} | ${escapeHtml(lvlStr)}</span>
          </div>
          <div class="card-body report-card-body">
            <div class="row g-2 sec-cards-row analysis-info-cards exam-info-cards">
                <div class="col-12 col-md-4"><div class="sec-card"><div class="sec-icon"><i class="fas fa-trophy"></i></div><div class="sec-body"><div class="sec-label">Sınav Birincisi</div><div class="sec-value sec-value-compact">${escapeHtml(getName(winner.studentNo))} <small>(${escapeHtml(winner.studentClass)})</small></div><div class="sec-sub">Net: ${winner.totalNet.toFixed(2)} | Puan: ${winner.score.toFixed(2)}</div></div></div></div>
                ${!isFirstExam ? `
                <div class="col-12 col-md-4"><div class="sec-card sec-pos"><div class="sec-icon"><i class="fas fa-chart-line"></i></div><div class="sec-body"><div class="sec-label">Önceki Sınava Göre En Büyük Çıkış</div><div class="sec-value sec-value-compact">${bestP ? `${escapeHtml(bestP.name)} <small>(${escapeHtml(bestP.cls)})</small>` : 'Veri Yok'}</div><div class="sec-sub">${bestP ? `+${bestP.diff.toFixed(2)} Net (${bestP.prev.toFixed(2)} -> ${bestP.cur.toFixed(2)})` : 'Önceki sınav bulunamadı'}</div></div></div></div>
                <div class="col-12 col-md-4"><div class="sec-card sec-neg"><div class="sec-icon"><i class="fas fa-level-down-alt"></i></div><div class="sec-body"><div class="sec-label">Önceki Sınava Göre En Büyük Düşüş</div><div class="sec-value sec-value-compact">${worstP ? `${escapeHtml(worstP.name)} <small>(${escapeHtml(worstP.cls)})</small>` : 'Veri Yok'}</div><div class="sec-sub">${worstP ? `${worstP.diff.toFixed(2)} Net (${worstP.prev.toFixed(2)} -> ${worstP.cur.toFixed(2)})` : 'Önceki sınav bulunamadı'}</div></div></div></div>
                ` : ''}
            </div>
            <div class="row g-2 sec-cards-row analysis-info-cards exam-info-cards mt-2">
                ${!isFirstExam ? `
                <div class="col-12 col-md-4"><div class="sec-card sec-pos"><div class="sec-icon"><i class="fas fa-arrow-up"></i></div><div class="sec-body"><div class="sec-label">Ortalaması En Çok Artan Ders</div><div class="sec-value sec-value-compact">${bestSub ? escapeHtml(toTitleCase(bestSub.sub)) : 'Veri Yok'}</div><div class="sec-sub">${bestSub ? `+${bestSub.diff.toFixed(2)} Net (${bestSub.prevAvg.toFixed(2)} -> ${bestSub.curAvg.toFixed(2)})` : 'Önceki sınav bulunamadı'}</div></div></div></div>
                <div class="col-12 col-md-4"><div class="sec-card sec-neg"><div class="sec-icon"><i class="fas fa-arrow-down"></i></div><div class="sec-body"><div class="sec-label">Ortalaması En Çok Düşen Ders</div><div class="sec-value sec-value-compact">${worstSub ? escapeHtml(toTitleCase(worstSub.sub)) : 'Veri Yok'}</div><div class="sec-sub">${worstSub ? `${worstSub.diff.toFixed(2)} Net (${worstSub.prevAvg.toFixed(2)} -> ${worstSub.curAvg.toFixed(2)})` : 'Önceki sınav bulunamadı'}</div></div></div></div>
                ` : ''}
                <div class="col-12 col-md-4"><div class="sec-card sec-neutral"><div class="sec-icon"><i class="fas fa-users"></i></div><div class="sec-body"><div class="sec-label">Sınav Katılım Oranı</div><div class="sec-value sec-value-compact">%${partRateE}</div><div class="sec-sub">${attendedNos.size} katıldı · ${absentStus.length} katılmadı</div></div></div></div>
                <div class="col-12 col-md-4"><div class="sec-card"><div class="sec-icon"><i class="fas fa-chart-bar"></i></div><div class="sec-body"><div class="sec-label">Ortalama Net</div><div class="sec-value">${examAvgNet.toFixed(2)} Net</div>${examClassAvgHtml ? `<div class="sec-sub summary-pills">${examClassAvgHtml}</div>` : ''}</div></div></div>
            </div>
            ${examStatsHtml}
            
            <div class="row mt-3 analysis-list-group exam-rank-tables">
                <div class="col-lg-6"><div class="card shadow-sm avoid-break"><div class="card-header sa-list-header sa-list-success"><h3 class="card-title m-0"><i class="fas fa-angle-double-up me-1"></i> İlk 5 Öğrenci</h3></div><div class="card-body p-0 table-responsive"><table class="table table-sm table-striped m-0 table-readable"><thead><tr><th>Sıra</th><th>No</th><th>Ad Soyad</th><th>Sınıf</th><th>Net</th><th>Puan</th></tr></thead><tbody>${top5Html}</tbody></table></div></div></div>
                <div class="col-lg-6"><div class="card shadow-sm avoid-break"><div class="card-header sa-list-header sa-list-danger"><h3 class="card-title m-0"><i class="fas fa-angle-double-down me-1"></i> Son 5 Öğrenci</h3></div><div class="card-body p-0 table-responsive"><table class="table table-sm table-striped m-0 table-readable"><thead><tr><th>Sıra</th><th>No</th><th>Ad Soyad</th><th>Sınıf</th><th>Net</th><th>Puan</th></tr></thead><tbody>${bottom5Html}</tbody></table></div></div></div>
            </div>

            ${absentListHtml}
            <div id="examSummaryBPArea"></div>
            <div id="examSummaryChartArea" class="chart-box chart-box-xl avoid-break mt-3" style="display:none;"><canvas id="cExamSummaryBar"></canvas></div>
          </div>
      </div>`; 
      r.innerHTML = h;

      setTimeout(() => {
        let bpArea = getEl('examSummaryBPArea');
        let totalExamsOfType = new Set(Object.values(EXAM_META).filter(m => m.examType === eT).map(m => m.date)).size;
        
        if(bpArea && totalExamsOfType >= 10) {
          let examClassMap = {};
          currentExams.forEach(e => {
            if(!examClassMap[e.studentClass]) examClassMap[e.studentClass] =[];
            examClassMap[e.studentClass].push(e.totalNet);
          });
          let lvlForExBP = targetLvl || (currentExams.length > 0 ? getGrade(currentExams[0].studentClass) : '');
          let allGradeNets = DB.e.filter(e => e.examType===eT && e.date===dt && !e.abs && (lvlForExBP ? getGrade(e.studentClass)===lvlForExBP : true) && (!brFilterED || getClassParts(e.studentClass).branch===brFilterED)).map(e => e.totalNet);
          let validClasses = Object.fromEntries(Object.entries(examClassMap).filter(([c,v])=>v.length>=3));
          if(allGradeNets.length >= 3) {
            let multiClsBP = Object.keys(validClasses).length >= 1 ? mkMultiClassBoxPlot(validClasses, null, {height:220}, allGradeNets) : '';
            if(multiClsBP) {
              bpArea.innerHTML = `<div class="boxplot-card mb-3"><div class="boxplot-title"><i class="fas fa-box-open me-1 text-success"></i>Sınıflar Arası Net Dağılımı</div>${multiClsBP}</div>`;
            }
          }
        }

        let clsScoreMap = {};
        currentExams.forEach(e => {
          if(!clsScoreMap[e.studentClass]) clsScoreMap[e.studentClass] = [];
          clsScoreMap[e.studentClass].push(e.totalNet || 0);
        });
        let sortedClsKeys = Object.keys(clsScoreMap).sort();
        let barLabels = sortedClsKeys;
        let barData = sortedClsKeys.map(cls => { let arr = clsScoreMap[cls]; return arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length) : 0; });
        let cv = getEl('cExamSummaryBar');
        
        if(cv && barLabels.length > 0) {
          let chartArea = getEl('examSummaryChartArea');
          if(chartArea) chartArea.style.display = 'block';

          try { let _prev = Chart.getChart && Chart.getChart('cExamSummaryBar'); if(_prev) _prev.destroy(); } catch(e){}
          new Chart(cv, {
            type: 'bar',
            data: {
              labels: barLabels,
              datasets:[{ label: 'Ortalama Net', data: barData, backgroundColor: cols.map(c=>c+'cc'), borderColor: cols, borderWidth: 1.5 }]
            },
            plugins: [ChartDataLabels],
            options: {
              responsive: true, maintainAspectRatio: false, animation: false,
              plugins: {
                legend: { display: false },
                datalabels: { display: false }
              },
              scales: {
                x: { grid: { color: '#e2e8f0' }, ticks: { font: { size: 10 } } },
                y: { grid: { color: '#e2e8f0' }, ticks: { font: { size: 10 } }, title: { display: true, text: 'Ortalama Net', font: { size: 10 } } }
              }
            }
          });
          
          if(chartArea && !chartArea.dataset.titleAdded) { 
            let title = document.createElement('div'); 
            title.className = 'single-exam-chart-title chart-section-title';
            title.textContent = `${eT} ${dt} — Sınıf Bazlı Ortalama Net`; 
            chartArea.parentNode.insertBefore(title, chartArea); 
            chartArea.dataset.titleAdded = 'true';
          }
        }
      }, 50);

    } else if (subSel === 'list_single') {
      let batch = baseExams.filter(x => x.date === dt);
      if(brFilterED) batch = batch.filter(x => getClassParts(x.studentClass).branch === brFilterED);
      
      if(!batch.length){r.innerHTML='<div class="alert alert-default-info">Bu sınava ait veri yok.</div>';return;}

      let subKeys=Array.from(new Set(batch.filter(x=>!x.abs).flatMap(e=>Object.keys(e.subs)))).sort();
      let _validNos = new Set(DB.s.map(s=>s.no));
      let rows2=batch.filter(e => e && _validNos.has(e.studentNo)).map(e=>{ let st=getStuMap().get(e.studentNo); return {...e,studentName:st?st.name:'—',studentCls:st?st.class:e.studentClass}; });
      let attended=rows2.filter(x=>!x.abs).sort((a,b)=>{
        let dp = (b.score||0) - (a.score||0); if(dp !== 0) return dp;
        let dn = (b.totalNet||0) - (a.totalNet||0); if(dn !== 0) return dn;
        return String(a.studentName||'').localeCompare(String(b.studentName||''),'tr',{sensitivity:'base'});
      });
      let absent=rows2.filter(x=>x.abs).sort((a,b)=>String(a.studentName||'').localeCompare(String(b.studentName||''),'tr',{sensitivity:'base'}));
      let sorted=[...attended,...absent], avgNet=attended.length?(attended.reduce((s,x)=>s+x.totalNet,0)/attended.length).toFixed(2):'0.00', avgScoreMeta=attended.length?(attended.reduce((s,x)=>s+(x.score||0),0)/attended.length).toFixed(2):'0.00', metaStr=`Katılan: ${attended.length} | Devamsız: ${absent.length} | Ortalama Puan: ${avgScoreMeta} | Sıralama: Puan`;
      
      let headCols=subKeys.map(k=>`<th>${escapeHtml(toTitleCase(k))}</th>`).join('');
      let _rankIdx = 0;
      let bodyRows=sorted.map((e)=>{
        let isSel=aNo&&e.studentNo===aNo, rCls=isSel?'highlight-row':''; let pub = e.publisher || '—';
        if(e.abs) return `<tr class="absent-row ${rCls}"><td>—</td><td>${escapeHtml(e.studentName)}</td><td>${escapeHtml(e.studentCls)}</td><td>${escapeHtml(e.date)}</td><td>${escapeHtml(toTitleCase(pub))}</td>${subKeys.map(()=>'<td>—</td>').join('')}<td>—</td><td>—</td><td>—</td><td>—</td></tr>`;
        _rankIdx++;
        return `<tr class="${rCls}"><td>${_rankIdx}</td><td>${escapeHtml(e.studentName)}</td><td>${escapeHtml(e.studentCls)}</td><td>${escapeHtml(e.date)}</td><td>${escapeHtml(toTitleCase(pub))}</td>${subKeys.map(k=>`<td>${e.subs[k]!==undefined?e.subs[k].net.toFixed(2):'—'}</td>`).join('')}<td><strong>${e.totalNet.toFixed(2)}</strong></td><td>${e.score.toFixed(2)}</td><td>${escapeHtml(e.cR||'—')}/${escapeHtml(e.cP||'—')}</td><td>${escapeHtml(e.iR||'—')}/${escapeHtml(e.iP||'—')}</td></tr>`;
      }).join('');

      // 1-F: Sınıf bazlı ara ortalama satırları (tablo sonuna eklenir)
      let classSubtotalRows = '';
      {
        let _clsGroups = {};
        attended.forEach(e => { if(!_clsGroups[e.studentCls]) _clsGroups[e.studentCls] = []; _clsGroups[e.studentCls].push(e); });
        Object.keys(_clsGroups).sort().forEach(cls => {
          let _cg = _clsGroups[cls];
          let _cgSubCols = subKeys.map(k => { let v = _cg.filter(e=>e.subs[k]!==undefined).map(e=>e.subs[k].net); return `<td>${v.length?(v.reduce((a,b)=>a+b,0)/v.length).toFixed(2):'—'}</td>`; }).join('');
          let _cgNet = (_cg.reduce((s,x)=>s+x.totalNet,0)/_cg.length).toFixed(2);
          let _cgScore = (_cg.reduce((s,x)=>s+(x.score||0),0)/_cg.length).toFixed(2);
          classSubtotalRows += `<tr class="avg-row avg-row-subtotal avg-row-strong"><td colspan="5" class="avg-label">${escapeHtml(cls)} Ortalaması (${_cg.length} kişi)</td>${_cgSubCols}<td>${_cgNet}</td><td>${_cgScore}</td><td colspan="2">—</td></tr>`;
        });
      }

      let listAvgRow = '';
      if (attended.length > 0) {
        let avgSubCols = subKeys.map(k => { let v = attended.filter(e => e.subs[k] !== undefined).map(e => e.subs[k].net); return `<td>${v.length ? (v.reduce((a,b)=>a+b,0)/v.length).toFixed(2) : '—'}</td>`; }).join('');
        let listAvgScore = (attended.reduce((s,x)=>s+x.score,0)/attended.length).toFixed(2);
        listAvgRow = `<tr class="avg-row"><td colspan="5" class="avg-label">ORTALAMA (${attended.length} Kişi)</td>${avgSubCols}<td>${avgNet}</td><td>${listAvgScore}</td><td colspan="2">—</td></tr>`;
      }
      let lvlStr = targetLvl ? `${targetLvl}. Sınıflar ` : '', safeName=safeFileName(`Sinav_${eT}_${String(dt).replace(/\./g,'-')}`);
      let h=`<div class="d-flex justify-content-end mb-2 no-print"><button class="btn btn-success btn-sm me-2" onclick="xXL('tED',${jsArg(safeName)})"><i class='fas fa-file-excel me-1'></i>Excel</button><button class="btn-print no-print" onclick="xPR('pED',${jsArg(safeName)},this,'landscape')"><i class='fas fa-print me-1'></i>Yazdır</button></div>
      <div id="pED" class="card shadow-sm report-card sa-report-warning">
        <div class="report-header">
          <span class="report-title-main"><i class="fas fa-list me-2"></i><strong>${escapeHtml(eT)}</strong> — ${escapeHtml(dt)} Toplu Liste</span>
          <span class="report-title-sub">${escapeHtml(lvlStr ? lvlStr : "")}| ${escapeHtml(metaStr)}</span>
        </div>
        <div class="card-body report-card-body">
          <div class="scroll-hint"><i class="fas fa-arrows-alt-h me-1"></i>Tabloyu kaydırın</div>
          <div class="scroll list-scroll"><table class="table table-sm table-hover table-bordered" id="tED"><thead><tr><th>#</th><th>Ad Soyad</th><th>Sınıf</th><th>Tarih</th><th>Yayınevi</th>${headCols}<th>Top. Net</th><th>Puan</th><th>Snf(S/K)</th><th>Kurum(S/K)</th></tr></thead><tbody>${bodyRows}${classSubtotalRows}${listAvgRow}</tbody></table></div>
        </div>
      </div>`;
      r.innerHTML=h; if(aNo) setTimeout(()=>{ let hlRow=getEl('tED')?.querySelector('tr.highlight-row'); if(hlRow)hlRow.scrollIntoView({behavior:'smooth',block:'center'}); },300);

    } else if (subSel === 'list_all') {
      let allEx = baseExams.filter(x => !x.abs);
      if(!allEx.length){r.innerHTML='<div class="alert alert-default-warning">Bu filtrelere uygun sınav sonucu bulunamadı.</div>';return;}

      let allSubKeys = Array.from(new Set(allEx.flatMap(e => Object.keys(e.subs)))).sort();
      let stuMap_local = {};
      allEx.forEach(e => {
        let no = e.studentNo;
        if(!stuMap_local[no]) {
          let st = getStuMap().get(no);
          stuMap_local[no] = { no, name: st ? st.name : '—', cls: e.studentClass, subSums: {}, subCounts: {}, totalNetSum: 0, scoreSum: 0, examCount: 0 };
        }
        stuMap_local[no].totalNetSum += e.totalNet;
        stuMap_local[no].scoreSum += e.score;
        stuMap_local[no].examCount++;
        allSubKeys.forEach(k => {
          if(e.subs[k] !== undefined) {
            stuMap_local[no].subSums[k] = (stuMap_local[no].subSums[k] || 0) + e.subs[k].net;
            stuMap_local[no].subCounts[k] = (stuMap_local[no].subCounts[k] || 0) + 1;
          }
        });
      });

      let _validNosLA = new Set(DB.s.map(s=>s.no));
      let fullStuArr = Object.values(stuMap_local).filter(s => _validNosLA.has(s.no)).map(s => ({
        ...s,
        avgNet: s.totalNetSum / s.examCount,
        avgScore: s.scoreSum / s.examCount,
        subAvgs: Object.fromEntries(allSubKeys.map(k =>[k, s.subCounts[k] ? s.subSums[k] / s.subCounts[k] : null]))
      }));

      // Sıralamaya yalnızca sınavların en az yarısına giren öğrenciler dahil edilir: 1 sınava giren öğrencinin şanslı tek sonucu,
      // 10 sınava girenin ortalamasıyla aynı kefeye konmaz (listedeki "!" uyarısıyla aynı kural). Eşit ortalamalar aynı sırayı alır.
      let _laTotalEx = new Set(allEx.map(x => x.date)).size;
      let _laEligible = s => !(_laTotalEx > 0 && s.examCount < _laTotalEx / 2);
      let _laCmp = (a,b) => { let dp = (b.avgScore||0) - (a.avgScore||0); if(dp !== 0) return dp; return (b.avgNet||0) - (a.avgNet||0); };
      let _laKey = s => (s.avgScore||0) + '|' + (s.avgNet||0);
      let gradeRankList = fullStuArr.filter(_laEligible).sort(_laCmp);
      let gradeSizeMap = {};
      { let rks = _rankSorted(gradeRankList, _laKey); gradeRankList.forEach((s, idx) => { gradeSizeMap[s.no] = { rank: rks[idx], total: gradeRankList.length }; }); }

      let clsRankMap = {};
      fullStuArr.filter(_laEligible).forEach(s => { (clsRankMap[s.cls] = clsRankMap[s.cls] ||[]).push(s); });
      let clsSizeMap = {};
      Object.keys(clsRankMap).forEach(cls => {
        let sorted = [...clsRankMap[cls]].sort(_laCmp);
        let rks = _rankSorted(sorted, _laKey);
        sorted.forEach((s, i) => { clsSizeMap[s.no] = { rank: rks[i], total: sorted.length }; });
      });

      let displayStuArr = fullStuArr;
      if(brFilterED) {
        displayStuArr = fullStuArr.filter(s => {
          let mm = String(s.cls||'').match(/^(\d+)([a-zA-ZğüşıöçĞÜŞİÖÇ]+)$/);
          return mm && mm[2].toLocaleUpperCase('tr-TR') === brFilterED;
        });
      }
      displayStuArr.sort((a,b) => {
        let dp = (b.avgScore||0) - (a.avgScore||0); if(dp !== 0) return dp;
        return (b.avgNet||0) - (a.avgNet||0);
      });

      let lvlStr = targetLvl ? `${targetLvl}. Sınıflar ` : '';
      let examDatesAll = [...new Set(allEx.map(x => x.date))].sort(srt);
      let metaStrAll = `Hesaplanan Sınav: ${examDatesAll.length} | Listelenen Öğrenci: ${displayStuArr.length} | Sıralama: Ortalama Puan (sınavların en az yarısına girenler arasında)`;
      let headColsAll = allSubKeys.map(k => `<th>${escapeHtml(toTitleCase(k))}</th>`).join('');

      let totalExamCount = examDatesAll.length; // toplam sınav sayısı (unique tarihler)
      let bodyRowsAll = displayStuArr.map((s, idx) => {
        let isSel = aNo && s.no === aNo, rCls = isSel ? 'highlight-row' : '';
        let subCells = allSubKeys.map(k => `<td>${s.subAvgs[k] !== null ? s.subAvgs[k].toFixed(2) : '—'}</td>`).join('');
        let cR = clsSizeMap[s.no]; let gR = gradeSizeMap[s.no];
        let clsRankCell = cR ? `${cR.rank}/${cR.total}` : '—';
        let schoolRankCell = gR ? `${gR.rank}/${gR.total}` : '—';
        // 1-G: Az sınava giren öğrenci için uyarı vurgusu (toplam sınavın yarısından az)
        let examCntWarning = (totalExamCount > 0 && s.examCount < totalExamCount / 2);
        let examCntCell = examCntWarning
          ? `<td class="rank-warning-cell" title="Toplam ${totalExamCount} sınavdan yalnızca ${s.examCount} sınava katıldı">! ${s.examCount}</td>`
          : `<td>${s.examCount}</td>`;
        return `<tr class="${rCls}"><td>${idx+1}</td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.cls)}</td>${subCells}<td><strong>${s.avgNet.toFixed(2)}</strong></td><td>${s.avgScore.toFixed(2)}</td><td>${escapeHtml(clsRankCell)}</td><td>${escapeHtml(schoolRankCell)}</td>${examCntCell}</tr>`;
      }).join('');

      let allAvgRow = '';
      if(displayStuArr.length > 0) {
        let avgSubCols = allSubKeys.map(k => {
          let vals = displayStuArr.filter(s => s.subAvgs[k] !== null).map(s => s.subAvgs[k]);
          return `<td>${vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2) : '—'}</td>`;
        }).join('');
        let genAvgNet = (displayStuArr.reduce((a,s)=>a+s.avgNet,0)/displayStuArr.length).toFixed(2);
        let genAvgScore = (displayStuArr.reduce((a,s)=>a+s.avgScore,0)/displayStuArr.length).toFixed(2);
        let genAvgExam = (displayStuArr.reduce((a,s)=>a+s.examCount,0)/displayStuArr.length).toFixed(1);
        allAvgRow = `<tr class="avg-row"><td colspan="3" class="avg-label">GENEL ORTALAMA (${displayStuArr.length} Öğrenci)</td>${avgSubCols}<td>${genAvgNet}</td><td>${genAvgScore}</td><td colspan="2">—</td><td>${genAvgExam}</td></tr>`;
      }

      let safeNameAll = safeFileName(`${eT}_TumSinavlar_Toplu`);
      let hAll = `<div class="d-flex justify-content-end mb-2 no-print"><button class="btn btn-success btn-sm me-2" onclick="xXL('tEDAll',${jsArg(safeNameAll)})"><i class='fas fa-file-excel me-1'></i>Excel</button><button class="btn-print no-print" onclick="xPR('pEDAll',${jsArg(safeNameAll)},this,'landscape')"><i class='fas fa-print me-1'></i>Yazdır</button></div>
      <div id="pEDAll" class="card shadow-sm report-card sa-report-primary">
        <div class="report-header">
          <span class="report-title-main"><i class="fas fa-list-alt me-2"></i><strong>${escapeHtml(eT)}</strong> — Tüm Sınavlar Toplu Liste</span>
          <span class="report-title-sub">${escapeHtml(lvlStr ? lvlStr : "")}| ${escapeHtml(metaStrAll)}</span>
        </div>
        <div class="card-body report-card-body">
          <div class="scroll-hint"><i class="fas fa-arrows-alt-h me-1"></i>Tabloyu kaydırın</div>
          <div class="scroll list-scroll">
            <table class="table table-sm table-hover table-bordered" id="tEDAll">
              <thead><tr><th>#</th><th>Ad Soyad</th><th>Sınıf</th>${headColsAll}<th>Top. Net Ort.</th><th>Puan Ort.</th><th>Sıra/Sınıf</th><th>Sıra/Kurum</th><th>Sınav Say.</th></tr></thead>
              <tbody>${bodyRowsAll}${allAvgRow}</tbody>
            </table>
          </div>
        </div>
      </div>`;
      r.innerHTML = hAll;
      if(aNo) setTimeout(()=>{ let hlRow = getEl('tEDAll')?.querySelector('tr.highlight-row'); if(hlRow) hlRow.scrollIntoView({behavior:'smooth', block:'center'}); }, 300);
    }
  }
}

function raporInit() {
  let lvlSel = getEl('rLvl'), prevLvl = lvlSel.value;
  let levels = (typeof _resultGrades === 'function')
    ? _resultGrades()
    : [...new Set((DB.e||[]).filter(e=>e&&!e.abs).map(e=>getGrade(e.studentClass)).filter(Boolean))].sort((a,b)=>parseInt(a)-parseInt(b));
  lvlSel.innerHTML = optionHtml('', levels.length ? 'Sınıf Seviyesi Seç' : 'Verisi olan sınıf yok', !prevLvl, true)
    + levels.map(x=>optionHtml(x, `${x}. Sınıf`, prevLvl===x)).join('');
  if(prevLvl && levels.includes(prevLvl)) lvlSel.value = prevLvl;
  else lvlSel.value = '';
  raporFillBranches();
}

// ---- resetRapor ----
function resetRapor() {
  let lvlSel = getEl('rLvl'), brSel = getEl('rBr'), etSel = getEl('rExType'), rtSel = getEl('rReportType');
  if(lvlSel) lvlSel.value = '';
  if(brSel) { brSel.innerHTML = '<option value="">Tümü</option>'; brSel.value = ''; }
  if(etSel) { etSel.innerHTML = '<option value="" disabled selected>Sınav Seçiniz</option>'; etSel.value = ''; }
  if(rtSel) { rtSel.innerHTML = '<option value="" disabled selected>Rapor Türü Seçiniz</option><option value="Karne">Karne (Öğrenci Bazlı)</option><option value="Liste">Liste (Toplu Netler)</option>'; rtSel.value = ''; }
  let res = getEl('raporRes'); if(res) res.innerHTML = '';
  raporInit();
  // Sıfırlama sonrası filtre kartını görünür konuma getir
  let scrollTarget = lvlSel ? lvlSel.closest('.card, .sa-panel, section') : null;
  if(!scrollTarget) scrollTarget = getEl('raporRes') ? getEl('raporRes').closest('.card, .sa-panel, section') : null;
  if(scrollTarget) scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function raporFillBranches() {
  let lvl = getEl('rLvl').value, brSel = getEl('rBr'), prevBr = brSel.value;
  let branches = lvl
    ? (typeof _resultBranches === 'function'
      ? _resultBranches({ grade:lvl })
      : [...new Set((DB.e||[]).filter(e=>e&&!e.abs&&getGrade(e.studentClass)===lvl).map(e=>getClassParts(e.studentClass).branch).filter(Boolean))].sort())
    : [];
  brSel.innerHTML = optionHtml('', lvl ? (branches.length ? 'Şube Seç' : 'Uygun şube yok') : 'Önce sınıf seviyesi seçin', !prevBr, true)
    + (branches.length ? optionHtml('__ALL__', 'Tümü', prevBr==='__ALL__') : '')
    + branches.map(x=>optionHtml(x, x, prevBr===x)).join('');
  if(prevBr === '__ALL__' && branches.length) brSel.value = prevBr;
  else if(prevBr && branches.includes(prevBr)) brSel.value = prevBr;
  else brSel.value = '';
  raporFillExamTypes();
}

function raporFillExamTypes() {
  let lvl = getEl('rLvl') ? getEl('rLvl').value : '';
  let brRaw = getEl('rBr') ? getEl('rBr').value : '';
  let br = brRaw === '__ALL__' ? '' : brRaw;
  let etSel = getEl('rExType'); if(!etSel) return;
  let prev = etSel.value;
  let types = (lvl && brRaw)
    ? (typeof _resultExamTypes === 'function'
      ? _resultExamTypes({ grade:lvl, branch:br })
      : [...new Set((DB.e||[]).filter(e=>e&&!e.abs&&getGrade(e.studentClass)===lvl&&(!br||getClassParts(e.studentClass).branch===br)).map(e=>e.examType).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'tr')))
    : [];
  etSel.innerHTML = optionHtml('', lvl && brRaw ? (types.length ? 'Sınav Seçiniz' : 'Uygun sınav türü yok') : 'Önce şube seçin', !prev, true)
    + types.map(x=>optionHtml(x, x, prev===x)).join('')
    + (types.length ? optionHtml('ALL', 'Tüm Sınav Türleri (Genel Karne)', prev === 'ALL') : '');
  if(prev && (prev === 'ALL' || types.includes(prev))) etSel.value = prev;
  else etSel.value = '';
  if(etSel.value === 'ALL') raporFillReportTypes(true);
  raporUpdateLocks();
  if(etSel.value && etSel.value !== 'ALL' && getEl('rReportType') && getEl('rReportType').value) generateRapor();
}

function raporFillReportTypes(resetGeneralSelection) {
  let reportSel = getEl('rReportType');
  if(!reportSel) return;
  let et = getEl('rExType') ? getEl('rExType').value : '';
  let prev = reportSel.value;
  let generalTranscript = et === 'ALL';
  let keepKarne = generalTranscript ? (!resetGeneralSelection && prev === 'Karne') : prev === 'Karne';
  reportSel.innerHTML = optionHtml('', 'Rapor Türü Seçiniz', !keepKarne && prev !== 'Liste', true)
    + optionHtml('Karne', 'Karne (Öğrenci Bazlı)', keepKarne)
    + (generalTranscript ? '' : optionHtml('Liste', 'Liste (Toplu Netler)', prev === 'Liste'));
  if(generalTranscript) reportSel.value = keepKarne ? 'Karne' : '';
  else if(prev === 'Karne' || prev === 'Liste') reportSel.value = prev;
  else reportSel.value = '';
}

function raporExamTypeChanged() {
  let et = getEl('rExType') ? getEl('rExType').value : '';
  if(et === 'ALL') {
    raporFillReportTypes(true);
    raporUpdateLocks();
    let r = getEl('raporRes');
    if(r) r.innerHTML = '<div class="alert alert-default-info"><i class="fas fa-info-circle me-2"></i>Genel karne için yalnızca Karne (Öğrenci Bazlı) raporu kullanılabilir. Raporu oluşturmak için rapor türünden Karne seçin.</div>';
    return;
  }
  raporUpdateLocks();
  if(et && getEl('rReportType') && getEl('rReportType').value) generateRapor();
}

function raporUpdateLocks() {
  let lvl = getEl('rLvl') ? getEl('rLvl').value : '';
  let br = getEl('rBr') ? getEl('rBr').value : '';
  let et = getEl('rExType') ? getEl('rExType').value : '';
  raporFillReportTypes();
  if(typeof _setSelectLock === 'function') {
    // Zincir: Sınıf Seviyesi → Şube → Sınav Türü → Rapor Türü
    _setSelectLock('rBr',         !lvl,             'Önce sınıf seviyesi seçin');
    _setSelectLock('rExType',     !lvl || !br,      !lvl ? 'Önce sınıf seviyesi seçin' : 'Önce şube seçin');
    _setSelectLock('rReportType', !lvl || !br || !et, !lvl ? 'Önce sınıf seviyesi seçin' : (!br ? 'Önce şube seçin' : 'Önce sınav türü seçin'));
  } else {
    if(getEl('rBr')) getEl('rBr').disabled = !lvl;
    if(getEl('rExType')) getEl('rExType').disabled = !lvl || !br;
    if(getEl('rReportType')) getEl('rReportType').disabled = !lvl || !br || !et;
  }
}

async function generateRapor() {
  let lvl = getEl('rLvl').value, brRaw = getEl('rBr').value, br = brRaw === '__ALL__' ? '' : brRaw, eTypeSel = getEl('rExType').value;
  let rType = getEl('rReportType') ? getEl('rReportType').value : '';
  let r = getEl('raporRes');
  if(eTypeSel === 'ALL' && rType !== 'Karne') {
    raporFillReportTypes(true);
    if(r) r.innerHTML = '<div class="alert alert-default-info"><i class="fas fa-info-circle me-2"></i>Genel karne için yalnızca Karne (Öğrenci Bazlı) raporu kullanılabilir. Raporu oluşturmak için rapor türünden Karne seçin.</div>';
    return;
  }
  if(!lvl) { r.innerHTML = '<div class="alert alert-default-info"><i class="fas fa-info-circle me-2"></i>Rapor oluşturmak için sınıf seviyesi seçin.</div>'; return; }
  if(!brRaw) { r.innerHTML = '<div class="alert alert-default-info"><i class="fas fa-info-circle me-2"></i>Rapor oluşturmak için şube seçin ya da "Tümü" seçeneğini kullanın.</div>'; return; }
  if(!eTypeSel) { r.innerHTML = '<div class="alert alert-default-info"><i class="fas fa-info-circle me-2"></i>Rapor oluşturmak için sınav türü seçin.</div>'; return; }
  if(!rType) { r.innerHTML = '<div class="alert alert-default-info"><i class="fas fa-info-circle me-2"></i>Rapor oluşturmak için rapor türü seçin.</div>'; return; }
  
  let students = DB.s.filter(s => { let m = s.class.match(/^(\d+)([a-zA-ZğüşıöçĞÜŞİÖÇ]+)$/); if(!m) return false; if(m[1] !== lvl) return false; if(br && m[2].toLocaleUpperCase('tr-TR') !== br) return false; return true; });
  if(!students.length) { showToast('Bu filtreye uygun öğrenci bulunamadı.','warning'); return; }
  
  let neededBatches =[];
  if (eTypeSel === 'ALL') { neededBatches = Object.keys(EXAM_META).filter(id => { let m = EXAM_META[id]; return metaHasGrade(m, lvl); }); } else {
      neededBatches = Object.keys(EXAM_META).filter(id => { let m = EXAM_META[id]; return m.examType === eTypeSel && metaHasGrade(m, lvl); });
  }
  await fetchBatches(neededBatches);
  
  if(window._raporCharts){ window._raporCharts.forEach(ch=>{try{ch.destroy();}catch(e){}});} window._raporCharts=[];
  let lvlStr = br ? `${lvl}${br}` : `${lvl}. Sınıflar`;
  
  // --- LİSTE MODU ---
  if (rType === 'Liste') {
    let listReportName = safeFileName(`Toplu_Liste_${lvlStr}`);
    let html = `<div class="d-flex justify-content-end mb-2 no-print rapor-action-bar"><button class="btn btn-success btn-sm me-2" onclick="xXLMul('raporCont',${jsArg(listReportName)})"><i class='fas fa-file-excel me-1'></i>Excel</button><button class="btn-print no-print" onclick="xPR('raporCont',${jsArg(listReportName)},this,'landscape')"><i class='fas fa-print me-1'></i>Tümünü Yazdır</button></div><div id="raporCont" class="print-compact-list rapor-list-report">`;

    let typesToProcess =[];
    if (eTypeSel === 'ALL') {
      let tSet = new Set();
      neededBatches.forEach(bId => tSet.add(EXAM_META[bId].examType));
      typesToProcess = [...tSet].sort();
    } else {
      typesToProcess = [eTypeSel];
    }

    let validNos = new Set(students.map(s => s.no));
    let renderedTypeCount = 0;

    typesToProcess.forEach(t => {
      // Sınıf seviyesindeki tüm sınavları getir (derecelendirme tüm popülasyon bazında olmalı)
      let allExamsOfType = DB.e.filter(x => x.examType === t && !x.abs && getGrade(x.studentClass) === lvl);
      if (allExamsOfType.length === 0) return;

      let allSubKeys = Array.from(new Set(allExamsOfType.flatMap(e => Object.keys(e.subs)))).sort();
      let stuMap_local = {};

      allExamsOfType.forEach(e => {
        let no = e.studentNo;
        if(!stuMap_local[no]) {
          let st = getStuMap().get(no);
          stuMap_local[no] = { no, name: st ? st.name : '—', cls: e.studentClass, subSums: {}, subCounts: {}, totalNetSum: 0, scoreSum: 0, examCount: 0 };
        }
        stuMap_local[no].totalNetSum += e.totalNet;
        stuMap_local[no].scoreSum += (e.score || 0);
        stuMap_local[no].examCount++;
        allSubKeys.forEach(k => {
          if(e.subs[k] !== undefined) {
            stuMap_local[no].subSums[k] = (stuMap_local[no].subSums[k] || 0) + e.subs[k].net;
            stuMap_local[no].subCounts[k] = (stuMap_local[no].subCounts[k] || 0) + 1;
          }
        });
      });

      let fullStuArr = Object.values(stuMap_local).map(s => ({
        ...s,
        avgNet: s.totalNetSum / s.examCount,
        avgScore: s.scoreSum / s.examCount,
        subAvgs: Object.fromEntries(allSubKeys.map(k => [k, s.subCounts[k] ? s.subSums[k] / s.subCounts[k] : null]))
      }));

      // Sıralamaya yalnızca sınavların en az yarısına giren öğrenciler dahil edilir (1 sınava giren öğrencinin şanslı tek sonucu,
      // çok sınava girenin ortalamasıyla aynı kefeye konmaz); eşit ortalamalar aynı sırayı alır.
      let _rlTotalEx = new Set(allExamsOfType.map(x => x.date)).size;
      let _rlEligible = s => !(_rlTotalEx > 0 && s.examCount < _rlTotalEx / 2);
      let _rlCmp = (a,b) => { let dp = (b.avgScore||0) - (a.avgScore||0); if(dp !== 0) return dp; return (b.avgNet||0) - (a.avgNet||0); };
      let _rlKey = s => (s.avgScore||0) + '|' + (s.avgNet||0);

      // Kurum / Seviye Sıralaması
      let gradeRankList = fullStuArr.filter(_rlEligible).sort(_rlCmp);
      let gradeSizeMap = {};
      { let rks = _rankSorted(gradeRankList, _rlKey); gradeRankList.forEach((s, idx) => { gradeSizeMap[s.no] = { rank: rks[idx], total: gradeRankList.length }; }); }

      // Sınıf Sıralaması
      let clsRankMap = {};
      fullStuArr.filter(_rlEligible).forEach(s => { (clsRankMap[s.cls] = clsRankMap[s.cls] ||[]).push(s); });
      let clsSizeMap = {};
      Object.keys(clsRankMap).forEach(cls => {
        let sorted = [...clsRankMap[cls]].sort(_rlCmp);
        let rks = _rankSorted(sorted, _rlKey);
        sorted.forEach((s, i) => { clsSizeMap[s.no] = { rank: rks[i], total: sorted.length }; });
      });

      // Ekrana sadece filtreye uyan öğrencileri bas
      let displayStuArr = fullStuArr.filter(s => validNos.has(s.no));
      if (displayStuArr.length === 0) return;

      displayStuArr.sort((a,b) => { let dp = (b.avgScore||0) - (a.avgScore||0); if(dp !== 0) return dp; return (b.avgNet||0) - (a.avgNet||0); });

      // Başlık: tam adı title'da, görünen kısmı kısaltılmış ama hizası rl-sub ile aynı
      let headColsAll = allSubKeys.map(k => {
        let title = toTitleCase(k);
        return `<th class="rl-sub" title="${escapeHtml(title)}">${escapeHtml(title.length > 6 ? title.substring(0,3) : title)}</th>`;
      }).join('');

      let bodyRowsAll = displayStuArr.map((s, idx) => {
        let subCells = allSubKeys.map(k => `<td class="rl-sub">${s.subAvgs[k] !== null ? s.subAvgs[k].toFixed(2) : '—'}</td>`).join('');
        let cR = clsSizeMap[s.no]; let gR = gradeSizeMap[s.no];
        let clsRankCell = cR ? `${cR.rank}/${cR.total}` : '—';
        let schoolRankCell = gR ? `${gR.rank}/${gR.total}` : '—';
        return `<tr><td class="rl-idx">${idx+1}</td><td class="rl-name">${escapeHtml(s.name)}</td><td class="rl-class">${escapeHtml(s.cls)}</td>${subCells}<td class="rl-net"><strong>${s.avgNet.toFixed(2)}</strong></td><td class="rl-score">${s.avgScore.toFixed(2)}</td><td class="rl-rank">${escapeHtml(clsRankCell)}</td><td class="rl-rank">${escapeHtml(schoolRankCell)}</td><td class="rl-count">${s.examCount}</td></tr>`;
      }).join('');

      let allAvgRow = '';
      // Ortalama satırı: ders sütunları da rl-sub sınıfıyla ortaya hizalanır
      let avgSubCols = allSubKeys.map(k => {
        let vals = displayStuArr.filter(s => s.subAvgs[k] !== null).map(s => s.subAvgs[k]);
        return `<td class="rl-sub">${vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2) : '—'}</td>`;
      }).join('');
      let genAvgNet = (displayStuArr.reduce((a,s)=>a+s.avgNet,0)/displayStuArr.length).toFixed(2);
      let genAvgScore = (displayStuArr.reduce((a,s)=>a+s.avgScore,0)/displayStuArr.length).toFixed(2);
      let genAvgExam = (displayStuArr.reduce((a,s)=>a+s.examCount,0)/displayStuArr.length).toFixed(1);
      // avg-label: colspan 3 → sağa yasla (avg-label zaten text-align:right'tır)
      allAvgRow = `<tr class="avg-row"><td colspan="3" class="avg-label">ORTALAMA (${displayStuArr.length} Öğrenci)</td>${avgSubCols}<td class="rl-net">${genAvgNet}</td><td class="rl-score">${genAvgScore}</td><td class="rl-rank" colspan="2">—</td><td class="rl-count">${genAvgExam}</td></tr>`;

      let _rExColorIdx = (typeof examColorIdx === 'function') ? examColorIdx(t) : 0;
      let _rExLabel    = (typeof toExamLabel === 'function') ? toExamLabel(t) : t;
      let isFirst = renderedTypeCount === 0;
      renderedTypeCount++;
      // colGroup: sabit % genişlikler yerine sadece min-width veren dinamik yapı
      // table-layout:auto ile tarayıcı içeriğe göre dağıtır; print'te A4'e sığdırır
      let colGroupAll = `<colgroup><col class="rl-col-idx"><col class="rl-col-name"><col class="rl-col-class">${allSubKeys.map(()=>'<col class="rl-col-sub">').join('')}<col class="rl-col-net"><col class="rl-col-score"><col class="rl-col-rank"><col class="rl-col-rank"><col class="rl-col-count"></colgroup>`;

      let _colCount = 3 + allSubKeys.length + 5; /* #, Ad Soyad, Sınıf + dersler + Top.Net, Puan, Sıra/Sınıf, Sıra/Kurum, Sınav Say. */
      html += `<div class="card shadow-sm mb-4 exam-type-block rapor-list-block exam-color-${_rExColorIdx}${isFirst?' exam-type-first':''}" data-exam-color-idx="${_rExColorIdx}" data-exam-color="${_rExColorIdx}">
        <div class="card-header sa-exam-header">
          <h3 class="card-title card-title-md m-0"><i class="fas fa-list-alt me-2"></i>${escapeHtml(_rExLabel)} — Toplu Liste | <span class="card-title-subtle">${escapeHtml(lvlStr)}</span></h3>
        </div>
        <div class="card-body p-2">
          <div class="scroll-hint"><i class="fas fa-arrows-alt-h me-1"></i>Tabloyu kaydırın</div>
          <div class="scroll list-scroll">
            <table class="table table-sm table-bordered table-striped table-hover rapor-list-table" data-sh="${escapeHtml(t)}">
              ${colGroupAll}
              <thead>
                <tr class="print-title-row"><th colspan="${_colCount}">${escapeHtml(_rExLabel)} — Toplu Liste | ${escapeHtml(lvlStr)}</th></tr>
                <tr><th class="rl-idx">#</th><th class="rl-name">Ad Soyad</th><th class="rl-class">Sınıf</th>${headColsAll}<th class="rl-net">Top. Net Ort.</th><th class="rl-score">Puan Ort.</th><th class="rl-rank">Sıra/Sınıf</th><th class="rl-rank">Sıra/Kurum</th><th class="rl-count">Sınav Say.</th></tr>
              </thead>
              <tbody>${bodyRowsAll}${allAvgRow}</tbody>
            </table>
          </div>
        </div>
      </div>`;
    });
    
    if(!renderedTypeCount){
      r.innerHTML = '<div class="alert alert-default-warning"><i class="fas fa-info-circle me-2"></i>Bu filtrelere uygun liste verisi bulunamadı.</div>';
      return;
    }
    html += `</div>`;
    r.innerHTML = html;

  } else {
    // --- KARNE MODU ---
    let examsByStudent = new Map();
    DB.e.forEach(ex => {
      if(!examsByStudent.has(ex.studentNo)) examsByStudent.set(ex.studentNo,[]);
      examsByStudent.get(ex.studentNo).push(ex);
    });
    
    let karneReportName = safeFileName(`Toplu_Karne_${lvlStr}`);
    let html = `<div class="d-flex justify-content-end mb-2 no-print rapor-action-bar"><button class="btn-print no-print" onclick="xPR('raporCont',${jsArg(karneReportName)},this)"><i class='fas fa-print me-1'></i>Tümünü Yazdır</button></div><div id="raporCont">`;
    
    students.forEach((stu, stuIdx) => {
      let stuExams = examsByStudent.get(stu.no) ||[];
      stuExams = stuExams.sort((a,b) => srt(a.date,b.date)); if(!stuExams.length) return;

      let grp = {};
      if (eTypeSel === 'ALL') { stuExams.forEach(e => { (grp[e.examType] = grp[e.examType] ||[]).push(e); }); } else {
          stuExams.filter(e => e.examType === eTypeSel).forEach(e => { (grp[e.examType] = grp[e.examType] ||[]).push(e); });
      }

      let typs = Object.keys(grp).sort(); if(typs.length === 0) return;
      let stGrade = getGrade(stu.class);

      html += `<div class="student-rapor-wrapper">`;
      html += `<div class="report-header report-header-tight no-print"><span class="report-title-main"><i class="fas fa-user-graduate me-2"></i><strong>${escapeHtml(stu.name)}</strong> — Genel Karne Özeti</span><span class="report-title-sub">Sınıf: ${escapeHtml(stu.class)} | ${new Date().toLocaleDateString('tr-TR')}</span></div>`;

      typs.forEach(t => {
        let el = grp[t].sort((a,b)=>srt(a.date,b.date));
        // --- Sanal "Katılmadı" satırları: sınıf seviyesinde var olup öğrenci için kaydı bulunmayan sınavlar ---
        {
          let attendedKeys = new Set();
          el.forEach(e => { attendedKeys.add(e.date+'||'+(e.publisher||'')); });
          let seenGradeKey = new Set();
          DB.e.forEach(x => {
            if(x.examType !== t) return;
            if(getGrade(x.studentClass) !== stGrade) return;
            let k = x.date+'||'+(x.publisher||'');
            if(seenGradeKey.has(k)) return;
            seenGradeKey.add(k);
            if(!attendedKeys.has(k)) {
              el.push({ studentNo: stu.no, studentClass: stu.class, examType: t, date: x.date, publisher: x.publisher||'', subs: {}, totalNet: 0, score: 0, cR:'—', cP:'—', iR:'—', iP:'—', abs: true });
            }
          });
          el.sort((a,b)=>srt(a.date,b.date));
        }
        let sb = Array.from(new Set(el.filter(e=>!e.abs).flatMap(e=>Object.keys(e.subs)))).sort();
        let shorten = (sb.length + 5) > 10, abbrev = (name) => shorten ? name.substring(0,3) : toTitleCase(name);
        
        let summary = calcKarneSummaryCards(stu.no, t, stGrade, el);
        let cardsHtml = buildKarneExamCards(summary, t);
        let riskCardsHtml = buildRiskInfoCards(stu.no, t, stu.class);
        
        let karneRows = '', kIdx = 1;
        el.forEach(e => {
          let pubLabel = e.publisher ? toTitleCase(e.publisher) : '—';
          if(e.abs) { karneRows += `<tr class="absent-row"><td>—</td><td>${escapeHtml(e.date)}</td><td>${escapeHtml(pubLabel)}</td><td colspan="${sb.length+4}" class="text-center fw-bold">Katılmadı</td></tr>`; } else {
            karneRows += `<tr><td>${kIdx++}</td><td>${escapeHtml(e.date)}</td><td>${escapeHtml(pubLabel)}</td>${sb.map(x=>`<td>${e.subs[x]!==undefined?e.subs[x].net.toFixed(2):'—'}</td>`).join('')}<td><strong>${e.totalNet.toFixed(2)}</strong></td><td>${e.score.toFixed(2)}</td><td>${escapeHtml(e.cR||'—')}/${escapeHtml(e.cP||'—')}</td><td>${escapeHtml(e.iR||'—')}/${escapeHtml(e.iP||'—')}</td></tr>`;
          }
        });
        
        let attended = el.filter(e=>!e.abs), avgRow = '';
        if(attended.length > 0) {
          // Sınıf/Kurum ortalaması öğrencinin KATILDIĞI sınavlarla eşleştirilir (girmediği sınavlar hariç)
          let _attKR = new Set(attended.map(e => e.date + '||' + (e.publisher || '')));
          let allGradeExamsR = DB.e.filter(x => x.examType === t && !x.abs && getGrade(x.studentClass) === stGrade && _attKR.has(x.date + '||' + (x.publisher || '')));
          let allClassExamsR = DB.e.filter(x => x.examType === t && !x.abs && x.studentClass === stu.class && _attKR.has(x.date + '||' + (x.publisher || '')));
          let genAvgSubsR = sb.map(x => { let v = allGradeExamsR.filter(e => e.subs[x] !== undefined).map(e => e.subs[x].net); return v.length ? (v.reduce((a,b)=>a+b,0)/v.length).toFixed(2) : '—'; });
          let genAvgNetR = allGradeExamsR.length > 0 ? (allGradeExamsR.reduce((a,e)=>a+e.totalNet,0)/allGradeExamsR.length).toFixed(2) : '—';
let genAvgScoreR = allGradeExamsR.length > 0 ? (allGradeExamsR.reduce((a,e)=>a+e.score,0)/allGradeExamsR.length).toFixed(2) : '—';
          let clsAvgSubsR = sb.map(x => { let v = allClassExamsR.filter(e => e.subs[x] !== undefined).map(e => e.subs[x].net); return v.length ? (v.reduce((a,b)=>a+b,0)/v.length).toFixed(2) : '—'; });
          let clsAvgNetR = allClassExamsR.length > 0 ? (allClassExamsR.reduce((a,e)=>a+e.totalNet,0)/allClassExamsR.length).toFixed(2) : '—';
          let clsAvgScoreR = allClassExamsR.length > 0 ? (allClassExamsR.reduce((a,e)=>a+e.score,0)/allClassExamsR.length).toFixed(2) : '—';
          let avgSubs = sb.map(x => { let v=attended.filter(e=>e.subs[x]!==undefined).map(e=>e.subs[x].net); return v.length?(v.reduce((a,b)=>a+b,0)/v.length).toFixed(2):'—'; });
          let avgNet = (attended.reduce((a,e)=>a+e.totalNet,0)/attended.length).toFixed(2), avgScore = (attended.reduce((a,e)=>a+e.score,0)/attended.length).toFixed(2);
          
          avgRow = `<tr class="avg-row"><td colspan="3" class="avg-label-sm">Öğrenci Ortalama</td>${avgSubs.map(v=>`<td>${v}</td>`).join('')}<td>${avgNet}</td><td>${avgScore}</td><td colspan="2">—</td></tr>`;
          avgRow += `<tr class="avg-row"><td colspan="3" class="avg-label-sm">Sınıf Ortalama (${escapeHtml(stu.class)})</td>${clsAvgSubsR.map(v=>`<td>${v}</td>`).join('')}<td>${clsAvgNetR}</td><td>${clsAvgScoreR}</td><td colspan="2">—</td></tr>`;
          avgRow += `<tr class="avg-row"><td colspan="3" class="avg-label-sm">Kurum Ortalama (${escapeHtml(stGrade)}. Sınıflar)</td>${genAvgSubsR.map(v=>`<td>${v}</td>`).join('')}<td>${genAvgNetR}</td><td>${genAvgScoreR}</td><td colspan="2">—</td></tr>`;
        }
        
        let chartId = 'rKarneChart_' + stu.no.replace(/[^a-zA-Z0-9]/g,'_') + '_' + t.replace(/[^a-zA-Z0-9]/g,'_');
        let bpId = 'rBP_' + stu.no.replace(/[^a-zA-Z0-9]/g,'_') + '_' + t.replace(/[^a-zA-Z0-9]/g,'_');
        let _rExColorIdx = (typeof examColorIdx === 'function') ? examColorIdx(t) : 0;
        let _rExLabel    = (typeof toExamLabel === 'function') ? toExamLabel(t) : t;
        html += `<div class="card shadow-sm mb-4 exam-type-block exam-color-${_rExColorIdx}${typs.indexOf(t)===0?' exam-type-first':''}" data-stu-name="${escapeHtml(stu.name)}" data-stu-class="${escapeHtml(stu.class)}" data-exam-color-idx="${_rExColorIdx}" data-exam-color="${_rExColorIdx}">
          <div class="card-header sa-exam-header"><h3 class="card-title card-title-md m-0"><i class="fas fa-book me-2"></i>${escapeHtml(_rExLabel)} Sınavları</h3></div>
          <div class="card-body p-2">
            ${cardsHtml}
            ${riskCardsHtml}
            <div id="${bpId}"></div>
            <div class="single-exam-table-part analysis-table-part">
              <div class="scroll-hint"><i class="fas fa-arrows-alt-h me-1"></i>Tabloyu kaydırın</div>
              <div class="scroll"><table class="table table-sm table-bordered table-striped" data-sh="${escapeHtml(t)}"><thead><tr><th>#</th><th>Tarih</th><th>Yayınevi</th>${sb.map(x=>`<th title="${escapeHtml(toTitleCase(x))}">${escapeHtml(abbrev(x))}</th>`).join('')}<th>Top. Net</th><th>Puan</th><th>Snf(S/K)</th><th>Kurum(S/K)</th></tr></thead><tbody>${karneRows}${avgRow}</tbody></table></div>
            </div>
            <div class="single-exam-chart-title chart-section-title"><i class="fas fa-chart-line"></i>${escapeHtml(_rExLabel)} — Toplam Net Gelişimi</div>
            <div class="chart-box chart-box-xs chart-box-top avoid-break"><canvas id="${chartId}"></canvas></div>
          </div></div>`;
      });
      html += `</div>`;
    });
    
    html += `</div>`; r.innerHTML = html;
    
    // Grafikler ve kutu grafikleri öğrenci gruplarına bölünerek üretilir (yüzlerce grafiği tek seferde kurmak arayüzü dondurur);
    // ilerleme yükleme katmanında gösterilir, işlem bitince (ya da hata olursa) kapanır. Yeni rapor üretilirse eski döngü durur.
    const _karneTok = window._raporKarneToken = (window._raporKarneToken || 0) + 1;
    let _karneIdx = 0;
    const _karneChunk = 6;
    const _karneForStudent = (stu) => {
        let stuExams = examsByStudent.get(stu.no) ||[];
        stuExams = stuExams.sort((a,b) => srt(a.date, b.date)); if (!stuExams.length) return;
        let grp = {};
        if (eTypeSel === 'ALL') { stuExams.forEach(e => { (grp[e.examType] = grp[e.examType] ||[]).push(e); }); } else {
            stuExams.filter(e => e.examType === eTypeSel).forEach(e => { (grp[e.examType] = grp[e.examType] ||[]).push(e); });
        }
        let stGrade = getGrade(stu.class);
        Object.keys(grp).forEach(t => {
          let chartId = 'rKarneChart_' + stu.no.replace(/[^a-zA-Z0-9]/g,'_') + '_' + t.replace(/[^a-zA-Z0-9]/g,'_'); let cv = getEl(chartId); if(!cv) return;
          let el = grp[t].sort((a,b)=>srt(a.date,b.date)), chartLabels = el.map(e => e.publisher ? `${e.date} (${toTitleCase(e.publisher)})` : e.date);
          let stuNets = el.map(e=>e.abs?null:e.totalNet);
          let clsNets = el.map(e => { if(e.abs) return null; let v=DB.e.filter(x=>x.date===e.date&&x.examType===t&&x.studentClass===stu.class&&!x.abs).map(x=>x.totalNet); return v.length?(v.reduce((a,b)=>a+b,0)/v.length):null; });
          let insNets = el.map(e => { if(e.abs) return null; let v=DB.e.filter(x=>x.date===e.date&&x.examType===t&&!x.abs&&getGrade(x.studentClass)===stGrade).map(x=>x.totalNet); return v.length?(v.reduce((a,b)=>a+b,0)/v.length):null; });
          let ch = mkChart(chartId, chartLabels,[ {label:'Öğrenci', data:stuNets, backgroundColor:cols[0]+'cc', borderColor:cols[0], borderWidth:1.5}, {label:'Sınıf Ort.', data:clsNets, backgroundColor:cols[2]+'99', borderColor:cols[2], borderWidth:1.5}, {label:'Kurum Ort.', data:insNets, backgroundColor:cols[3]+'99', borderColor:cols[3], borderWidth:1.5} ]);
          window._raporCharts.push(ch);
          let bpId = 'rBP_' + stu.no.replace(/[^a-zA-Z0-9]/g,'_') + '_' + t.replace(/[^a-zA-Z0-9]/g,'_');
          let bpEl = getEl(bpId);
          if(bpEl) {
            let bpHtml = buildStuBoxPlots(stu.no, t, stu.class, stGrade, 'totalNet');
            if(bpHtml) bpEl.innerHTML = bpHtml;
          }
        });
    };
    const _karneStep = () => {
      if(window._raporKarneToken !== _karneTok) return; // daha yeni bir rapor başlatıldı
      try {
        const end = Math.min(_karneIdx + _karneChunk, students.length);
        for(; _karneIdx < end; _karneIdx++) _karneForStudent(students[_karneIdx]);
      } catch(err) { ld(0); throw err; }
      if(_karneIdx < students.length){
        ld(1, `Karne grafikleri hazırlanıyor (${_karneIdx}/${students.length})...`);
        setTimeout(_karneStep, 0);
      } else {
        ld(0);
      }
    };
    setTimeout(_karneStep, 200);
  }
}
