// app-settings.js — Settings CRUD, Excel upload wizard, DB exp/imp, PWA install

function rTabS(){
  let t=getEl('tStu').querySelector('tbody');
  t.innerHTML=DB.s.map((s,idx)=>{
    let safeNo   = escapeHtml(s.no);
    let safeName = escapeHtml(toTitleCase(s.name));
    let safeCls  = escapeHtml(s.class);
    let noArg    = jsArg(s.no);
    let delMsgArg= jsArg(`${s.no} numaralı öğrenci ve tüm sonuçları silinecek. Onaylıyor musunuz?`);
    return `<tr><td>${idx+1}</td><td>${safeNo}</td><td>${safeName}</td><td>${safeCls}</td><td><div class='btn-group btn-group-sm'><button class='btn btn-warning admin-only' onclick="eStu(${noArg})"><i class='fas fa-edit'></i></button><button class='btn btn-danger admin-only' onclick="cDel('student',${delMsgArg},${noArg})"><i class='fas fa-trash'></i></button></div></td></tr>`;
  }).join('');
}

function filterSettingsStudents() {
  let input = getEl('setStuSearch').value.toLocaleLowerCase('tr-TR');
  let rows = getEl('tStu').querySelectorAll('tbody tr');
  rows.forEach(row => {
      let no = row.cells[1].textContent.toLocaleLowerCase('tr-TR');
      let name = row.cells[2].textContent.toLocaleLowerCase('tr-TR');
      if(no.includes(input) || name.includes(input)) { row.style.display = ''; } else { row.style.display = 'none'; }
  });
}

function rTabE(){
  let u = Object.keys(EXAM_META).map(bId => ({ examBatchId: bId, ...EXAM_META[bId] })).sort((a,b)=>{
    let dateCmp = srt(a.date, b.date); if(dateCmp !== 0) return dateCmp;
    let aGrade = (a.grades && a.grades.length > 0) ? Math.min(...a.grades.map(g=>parseInt(g)||99)) : 99;
    let bGrade = (b.grades && b.grades.length > 0) ? Math.min(...b.grades.map(g=>parseInt(g)||99)) : 99;
    return aGrade - bGrade;
  });
  getEl('tExA').innerHTML=`<table class="table table-sm table-hover text-nowrap"><thead><tr><th>#</th><th>Tarih</th><th>Tür</th><th>Sınıf Seviyesi</th><th>Yayınevi</th><th>Sayı</th><th>İşlem</th></tr></thead><tbody>${u.map((e,idx)=>{ let gl = (e.grades && e.grades.length > 0) ? [...e.grades].sort().join(', ') : 'Tümü'; let bIdArg = jsArg(e.examBatchId); return `<tr><td>${idx+1}</td><td>${escapeHtml(e.date)}</td><td>${escapeHtml(e.examType)}</td><td>${escapeHtml(gl)}</td><td>${escapeHtml(toTitleCase(e.publisher)||'—')}</td><td>${escapeHtml(e.count)}</td><td><div class="btn-group btn-group-sm"><button class="btn btn-warning admin-only" onclick="eExam(${bIdArg})" title="Düzenle"><i class='fas fa-edit'></i></button><button class="btn btn-danger admin-only" onclick="cDel('exam','Sınav tamamen silinecek. Onaylıyor musunuz?',${bIdArg})"><i class='fas fa-trash'></i></button></div></td></tr>`; }).join('')}</tbody></table>`;
}

function eExam(bId){
  let m = EXAM_META[bId]; if(!m) return;
  getEl('eExBatchId').value = bId; getEl('eExDate').value = m.date; getEl('eExType').value = m.examType; getEl('eExPub').value = m.publisher || '';
  showModal('mEditExam');
}

async function svExam(){
  if(!requireAdmin('Sınav güncelleme')) return;
  let bId = getEl('eExBatchId').value, rawDate = getEl('eExDate').value.trim(), newDate = normalizeExamDate(rawDate), newType = getEl('eExType').value.trim().toLocaleUpperCase('tr-TR'), newPub = getEl('eExPub').value.trim();
  if(!rawDate || !newType){ showToast('Tarih ve tür zorunludur!','warning'); return; }
  if(!newDate){ showToast('Tarih gerçek bir GG.AA.YYYY tarihi olmalıdır! (Örn: 15.04.2024)', 'error'); return; }
  let m = EXAM_META[bId]; if(!m) return;
  let dupId = Object.keys(EXAM_META).find(id => {
    if(id === bId) return false; let em = EXAM_META[id]; if(em.examType !== newType || em.date !== newDate) return false;
    return metaIntersectsGrades(em, m.grades || []);
  });
  if(dupId){ showToast('Bu tarih ve tür kombinasyonu aynı sınıf seviyesi için zaten mevcut!','error'); return; }
  if(!ensureOnlineForWrite('Sınav güncelleme')) return;
  
  ld(1,'Sınav güncelleniyor...');
  try {
    let updatedMeta = {...m, date: newDate, examType: newType, publisher: newPub};
    let updatedResults;
    if(CACHED_RESULTS[bId]){
      updatedResults = CACHED_RESULTS[bId].map(e => ({...e, date: newDate, examType: newType, publisher: newPub}));
    } else {
      let snap = await database.ref('db_v2/examResults/'+bId).once('value'), arr = toCleanArray(snap.val());
      updatedResults = arr.map(e => e ? ({...e, date: newDate, examType: newType, publisher: newPub}) : null).filter(x=>x);
    }
    await database.ref('db_v2').update({
      ['examMeta/'+bId]: updatedMeta,
      ['examResults/'+bId]: updatedResults
    });
    EXAM_META[bId] = updatedMeta;
    CACHED_RESULTS[bId] = updatedResults;
    DB.e = DB.e.map(e => e.examBatchId === bId ? {...e, date: newDate, examType: newType, publisher: newPub} : e);
    rTabE(); uDrp(); uStat(); if(aNo) reqProfile(); else if(getEl('sonuclar').classList.contains('active-pane')) reqAnl();
    hideModal('mEditExam'); showToast('Sınav bilgileri güncellendi.','success');
  } catch(err){ showToast('Hata: '+err.message,'error'); }
  ld(0);
}

function oMod(id){showModal(id);}

function cMod(id){hideModal(id);}

function oModAdd(){getEl('mSTit').textContent='Öğrenci Ekle';getEl('mSNo').value='';getEl('mSNo').disabled=false;getEl('mSNa').value='';getEl('mSCl').value='';oMod('mStu');}

function eStu(n){let s=getStuMap().get(n);if(s){getEl('mSTit').textContent='Öğrenci Düzenle';getEl('mSNo').value=s.no;getEl('mSNo').disabled=true;getEl('mSNa').value=toTitleCase(s.name);getEl('mSCl').value=s.class;oMod('mStu');}}

function cDel(t,m,id=null){
  dInf={t,id};
  let title = getEl('mConfTitle'), ok = getEl('mConfOkBtn');
  if(title) title.textContent = 'Dikkat!';
  if(ok) ok.textContent = 'Evet, Sil';
  getEl('cTxt').textContent=m;
  oMod('mConf');
}

function appConfirm(message, onConfirm, options = {}){
  dInf = { t:'callback', cb:onConfirm };
  let title = getEl('mConfTitle'), ok = getEl('mConfOkBtn');
  if(title) title.textContent = options.title || 'Onay';
  if(ok) ok.textContent = options.okText || 'Onayla';
  getEl('cTxt').textContent = message;
  oMod('mConf');
}

async function xDel(){
  let t=dInf.t,id=dInf.id;
  if(t === 'callback'){
    let cb = dInf.cb;
    cMod('mConf');
    dInf = {};
    if(typeof cb === 'function') cb();
    return;
  }
  if(!ensureOnlineForWrite('Silme işlemi')){ cMod('mConf'); return; }
  if(!requireAdmin('Silme işlemi')){ cMod('mConf'); return; }
  if(t==='student'){
    // === FIX v11: Hayalet (orphan) veri temizliği — Firebase'deki TÜM sınav paketlerinden öğrenciyi sil ===
    let previousStudents = DB.s.slice();
    let nextStudents = DB.s.filter(x => x.no !== id);
    try {
      // Önce bellekte hangi paketlerde geçtiğini bul (DB.e + CACHED_RESULTS); ayrıca güvenlik için EXAM_META anahtarlarını da tara
      let touchedBatches = new Set();
      DB.e.forEach(e => { if(e.studentNo === id && e.examBatchId) touchedBatches.add(e.examBatchId); });
      Object.keys(CACHED_RESULTS||{}).forEach(bId => { if((CACHED_RESULTS[bId]||[]).some(x => x.studentNo === id)) touchedBatches.add(bId); });
      // Geriye dönük tarama: bellekte yer almayan eski paketleri de Firebase'den kontrol et
      let allBatchIds = Object.keys(EXAM_META||{});
      let unloaded = allBatchIds.filter(b => !touchedBatches.has(b) && !CACHED_RESULTS[b]);
      let unloadedScans = await Promise.all(unloaded.map(bId => database.ref('db_v2/examResults/'+bId).once('value').then(snap => ({bId, val: toCleanArray(snap.val())})).catch(() => ({bId, val: []}))));
      unloadedScans.forEach(({bId, val}) => { if(Array.isArray(val) && val.some(x => x && x.studentNo === id)) touchedBatches.add(bId); });
      // Şimdi her etkilenen paketten öğrencinin kayıtlarını sil ve Firebase'e yaz
      let cleanedByBatch = {};
      let writePromises = [];
      touchedBatches.forEach(bId => {
        writePromises.push((async () => {
          let snap = await database.ref('db_v2/examResults/'+bId).once('value');
          let res = toCleanArray(snap.val());
          if(!Array.isArray(res)) return;
          let cleaned = res.filter(x => x && x.studentNo !== id);
          if(cleaned.length !== res.length){
            cleanedByBatch[bId] = cleaned;
          }
        })());
      });
      await Promise.all(writePromises);
      let updates = { students: nextStudents };
      Object.keys(cleanedByBatch).forEach(bId => { updates['examResults/'+bId] = cleanedByBatch[bId]; });
      await database.ref('db_v2').update(updates);
      DB.s = nextStudents;
      _stuMapCache = null;
      // Bellek senkronizasyonu
      Object.keys(cleanedByBatch).forEach(bId => { CACHED_RESULTS[bId] = cleanedByBatch[bId]; });
      Object.keys(CACHED_RESULTS).forEach(bId => { CACHED_RESULTS[bId] = (CACHED_RESULTS[bId]||[]).filter(x => x.studentNo !== id); });
      rebuildDbFromCache(); // kalan öğrencilerin sınıf/kurum sıraları güncel veriden yeniden türetilir
      _riskCache = null; // Risk cache'i geçersiz kıl
      if(aNo === id) sAct(null);
      showToast('Öğrenci ve tüm sınav kayıtları silindi (' + touchedBatches.size + ' paket).', 'success');
    } catch(err){
      DB.s = previousStudents;
      _stuMapCache = null;
      rTabS();
      showToast('Öğrenci silinemedi: ' + err.message, 'error');
    }
  }
  else if(t==='allStudents'){
    // Geri dönüşsüz işlemden önce otomatik yedek (indirilir); yedek alınamazsa işlem yapılmaz
    ld(1,'Silmeden önce otomatik yedek alınıyor...');
    let _bkOk = await autoBackupBeforeDestructive(); ld(0);
    if(!_bkOk){ cMod('mConf'); return; }
    try { await database.ref('db_v2').update({ students: [], examResults: null, examMeta: null }); DB.s=[]; CACHED_RESULTS={}; DB.e=[]; EXAM_META={}; _riskCache=null; _stuMapCache=null; sAct(null); rTabS(); rTabE(); uStat(); uDrp(); showToast('Tüm öğrenci ve sınav verileri silindi.', 'success'); }
    catch(err){ showToast('Silme işlemi başarısız: ' + err.message, 'error'); }
  }
  else if(t==='exam'){
    try { await database.ref('db_v2').update({ ['examResults/'+id]: null, ['examMeta/'+id]: null }); if(CACHED_RESULTS[id]) delete CACHED_RESULTS[id]; delete EXAM_META[id]; rebuildDbFromCache(); _riskCache = null; // Risk cache'i geçersiz kıl
rTabE(); uStat(); uDrp(); if(aNo) reqProfile(); else if(getEl('sonuclar').classList.contains('active-pane')) reqAnl(); showToast('Sınav silindi.', 'success'); }
    catch(err){ showToast('Sınav silinemedi: ' + err.message, 'error'); }
  }
  else if(t==='all'){
    ld(1,'Sıfırlamadan önce otomatik yedek alınıyor...');
    if(!(await autoBackupBeforeDestructive())){ ld(0); cMod('mConf'); return; }
    ld(1,'Sıfırlanıyor...');
    try { await database.ref('db_v2').remove(); location.reload(); return; }
    catch(err){ showToast('Sıfırlama başarısız: ' + err.message, 'error'); ld(0); }
  }
  cMod('mConf');
}

async function svStu(){
  let n=String(getEl('mSNo').value).trim(),nm=getEl('mSNa').value.trim(),cc=normalizeClassName(getEl('mSCl').value);
  if(!n||!nm||!cc){showToast('Tüm alanları doldurun!','warning');return;}
  let classParts = getClassParts(cc);
  if(!classParts.grade || !classParts.branch){ showToast('Sınıf formatı geçersiz. Örn: 9A, 10B', 'warning'); return; }
  if(!requireAdmin('Öğrenci kaydı')) return;
  if(!ensureOnlineForWrite('Öğrenci kaydı')) return;
  let s=getStuMap().get(n); 
  // "Ekle" modunda (numara alanı açık) var olan bir numarayı girmek mevcut öğrenciyi sessizce ezmesin
  if(s && !getEl('mSNo').disabled){
    showToast(`${n} numaralı öğrenci zaten kayıtlı (${s.name}, ${s.class}). Bilgilerini değiştirmek için listedeki düzenle düğmesini kullanın.`, 'warning', 7000);
    return;
  }
  let oldClass = s ? s.class : null;
  let nextStudents = s
    ? DB.s.map(st => st.no === n ? {...st, name:toTitleCase(nm), class:cc} : st)
    : DB.s.concat({no:n, name:toTitleCase(nm), class:cc});
  let updatedBatches = {};
  try {
    if(s && oldClass !== cc) {
      ld(1, 'Sınav kayıtları güncelleniyor...');
      let batchesToUpdate = new Set();
      DB.e.forEach(e => { if (e.studentNo === n && e.examBatchId) batchesToUpdate.add(e.examBatchId); });
      await Promise.all([...batchesToUpdate].map(async bId => {
        let snap = await database.ref('db_v2/examResults/' + bId).once('value');
        let res = toCleanArray(snap.val());
        let changed = false;
        let updated = res.map(e => {
          if (e && e.studentNo === n && normalizeClassName(e.studentClass) !== cc) {
            changed = true;
            return { ...e, studentClass: cc };
          }
          return e;
        });
        if(changed) updatedBatches[bId] = updated.filter(x=>x);
      }));
    }
    let updates = { students: nextStudents };
    Object.keys(updatedBatches).forEach(bId => { updates['examResults/' + bId] = updatedBatches[bId]; });
    await database.ref('db_v2').update(updates);
    DB.s = nextStudents;
    Object.keys(updatedBatches).forEach(bId => { CACHED_RESULTS[bId] = updatedBatches[bId]; });
    rebuildDbFromCache();
    _stuMapCache = null;
  } catch(err) {
    _stuMapCache = null;
    showToast('Öğrenci kaydedilemedi: ' + err.message, 'error');
    ld(0);
    return;
  }
  ld(0);
  rTabS(); uStat();
  if(aNo===n) reqProfile(); 
  if(aNo){ let upd=getStuMap().get(aNo); if(upd){ getEl('aBadge').innerHTML=`<span class="badge rounded-pill px-3 py-2 sa-selected-pill"><i class="fas fa-check-circle me-1"></i>Seçili Öğrenci: ${escapeHtml(upd.name)} (${escapeHtml(upd.class)})</span>`; let ab=getEl('anlStuBadge'); if(ab) ab.innerHTML=`<span class="badge rounded-pill px-2 py-1 sa-selected-pill selected-student-pill"><i class="fas fa-check-circle me-1"></i>Seçili Öğrenci: ${escapeHtml(upd.name)} (${escapeHtml(upd.class)})</span>`; } }
  cMod('mStu'); showToast('Öğrenci bilgileri kaydedildi.', 'success');
}

// ---- Yedekleme ----
async function buildBackupPayload(){
  let resultsSnap = await database.ref('db_v2/examResults').once('value');
  return { _version: 2, _date: new Date().toISOString(), students: DB.s, examMeta: EXAM_META, examResults: resultsSnap.val() || {} };
}

function downloadBackupFile(payload, prefix, withTime){
  const now = new Date();
  const day = now.toLocaleDateString('tr-TR').replace(/\./g,'-');
  const pad = n => String(n).padStart(2,'0');
  const time = withTime ? '_' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) : '';
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${prefix}_${day}${time}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Geri dönüşsüz işlemlerden (tümünü silme, sıfırlama, geri yükleme) önce çağrılır.
// Yedek hazırlanamazsa false döner ve çağıran işlem iptal edilir.
async function autoBackupBeforeDestructive(){
  try {
    downloadBackupFile(await buildBackupPayload(), 'OtomatikYedek', true);
    showToast('İşlemden önce otomatik yedek indirildi. Lütfen saklayın.', 'info', 6000);
    return true;
  } catch(err){
    showToast('Otomatik yedek alınamadı; veri güvenliği için işlem iptal edildi: ' + err.message, 'error', 8000);
    return false;
  }
}

async function expDB(){
  ld(1,'Yedek hazırlanıyor, lütfen bekleyin...');
  try { downloadBackupFile(await buildBackupPayload(), 'TamYedek', false); } catch(err) { showToast('Yedek alınamadı: ' + err.message, 'error'); }
  ld(0);
}

async function impDB(e){
  if(!document.body.classList.contains('is-admin')){
  showToast('Bu işlem sadece admin tarafından yapılabilir.', 'error');
  e.target.value = '';
  return;
}
  let f = e.target.files[0]; if(!f){ e.target.value=''; return; }
  if(!ensureOnlineForWrite('Geri yükleme')){ e.target.value=''; return; }
  appConfirm('Mevcut tüm verinin üzerine yazılacak. Bu işlem geri alınamaz. Devam edilsin mi?', () => restoreBackupFile(f), {
    title: 'Geri Yükleme Onayı',
    okText: 'Evet, Geri Yükle'
  });
  e.target.value = '';
}

function restoreBackupFile(f){
  if(!f) return;
  if(!ensureOnlineForWrite('Geri yükleme')) return;
  // Yaklaşık boyut limiti: 50 MB
  if(f.size > 50 * 1024 * 1024){ showToast('Yedek dosyası çok büyük (>50 MB). Geçerli bir yedek dosyası seçin.', 'error'); return; }
  let rd = new FileReader();
  rd.onload = async ev => {
    try {
      let p;
      try { p = JSON.parse(ev.target.result); } catch(pe){ throw new Error('Dosya geçerli JSON değil: ' + pe.message); }
      if(typeof p !== 'object' || p === null) throw new Error('Geçersiz yedek: kök nesne bekleniyor.');
      // Zorunlu alan kontrolleri
      if(!Array.isArray(p.students))         throw new Error('Geçersiz yedek dosyası. students alanı bulunamadı ya da dizi değil.');
      if(!p.examMeta || typeof p.examMeta !== 'object') throw new Error('Geçersiz yedek dosyası. examMeta alanı bulunamadı ya da nesne değil.');
      if(p.examResults !== undefined && (typeof p.examResults !== 'object' || p.examResults === null)) throw new Error('Geçersiz yedek dosyası. examResults beklenen formatta değil.');
      // Makul limit kontrolleri
      const MAX_STUDENTS = 5000;
      const MAX_EXAM_META = 2000;
      const MAX_RESULT_BATCHES = 2000;
      const MAX_RECORDS_PER_BATCH = 5000;
      if(p.students.length > MAX_STUDENTS) throw new Error(`Yedek dosyasında çok fazla öğrenci (${p.students.length} > ${MAX_STUDENTS}). Dosya geçerli bir yedek olmayabilir.`);
      let metaCount = Object.keys(p.examMeta).length;
      if(metaCount > MAX_EXAM_META) throw new Error(`Yedek dosyasında çok fazla sınav meta kaydı (${metaCount} > ${MAX_EXAM_META}).`);
      if(p.examResults){
        let batchCount = Object.keys(p.examResults).length;
        if(batchCount > MAX_RESULT_BATCHES) throw new Error(`Yedek dosyasında çok fazla sonuç paketi (${batchCount} > ${MAX_RESULT_BATCHES}).`);
        for(let bId of Object.keys(p.examResults)){
          let batch = p.examResults[bId];
          if(!Array.isArray(batch)) throw new Error(`Sonuç paketi "${bId}" dizi değil.`);
          if(batch.length > MAX_RECORDS_PER_BATCH) throw new Error(`Sonuç paketi "${bId}" çok büyük (${batch.length} > ${MAX_RECORDS_PER_BATCH}).`);
        }
      }
      let cleanPayload = sanitizeBackupPayload(p);
      ld(1,'Geri yüklemeden önce mevcut verinin otomatik yedeği alınıyor...');
      if(!(await autoBackupBeforeDestructive())){ ld(0); return; }
      ld(1,'Veriler geri yükleniyor...');
      await database.ref('db_v2').set(cleanPayload);
      CACHED_RESULTS = {}; showToast('Geri yükleme tamamlandı. Sayfa yenileniyor...', 'success', 2500); setTimeout(() => location.reload(), 700);
    } catch(err) { showToast('Geri yükleme başarısız: ' + err.message, 'error'); ld(0); }
  };
  rd.onerror = () => { showToast('Yedek dosyası okunamadı.', 'error'); ld(0); };
  rd.readAsText(f);
}

function cancelUpload() {
  PENDING_UPLOAD = null;
  let fStu = getEl('fStu'), fEx = getEl('fEx');
  if(fStu) fStu.value = '';
  if(fEx) fEx.value = '';
  wizardStep = 0;
  hideModal('mMappings');
  hideModal('mUploadPreview');
}

function backToMapping() { hideModal('mUploadPreview'); showModal('mMappings'); }

function sanitizeBackupPayload(p){
  const badKey = /[.#$\[\]\/]/;
  const students = [];
  const studentNos = new Set();
  p.students.forEach((s, idx) => {
    let no = String((s && s.no) || '').trim();
    let name = String((s && s.name) || '').trim();
    let cls = normalizeClassName(s && s.class);
    let parts = getClassParts(cls);
    if(!no || !name || !parts.grade || !parts.branch) throw new Error(`Öğrenci kaydı geçersiz (satır ${idx + 1}). Sınıf örn: 9A olmalı.`);
    if(studentNos.has(no)) throw new Error(`Yedekte mükerrer öğrenci no var: ${no}`);
    studentNos.add(no);
    students.push({...s, no, name: toTitleCase(name), class: cls});
  });

  const examMeta = {};
  Object.keys(p.examMeta || {}).forEach(bId => {
    if(!bId || badKey.test(bId)) throw new Error(`Geçersiz sınav paket anahtarı: ${bId}`);
    let m = p.examMeta[bId] || {};
    let date = normalizeExamDate(m.date);
    let examType = String(m.examType || '').trim().toLocaleUpperCase('tr-TR');
    if(!date || !examType) throw new Error(`Sınav meta kaydı geçersiz: ${bId}`);
    let subjects = Array.isArray(m.subjects) ? m.subjects.map(x => toTitleCase(String(x || '').trim())).filter(Boolean) : [];
    let grades = Array.isArray(m.grades) ? m.grades.map(x => String(x || '').trim()).filter(Boolean) : [];
    let count = parseNumberStrict(m.count);
    examMeta[bId] = {...m, date, examType, publisher: toTitleCase(m.publisher || ''), count: count === null ? 0 : count, subjects, grades};
  });

  const examResults = {};
  Object.keys(p.examResults || {}).forEach(bId => {
    if(!bId || badKey.test(bId)) throw new Error(`Geçersiz sonuç paket anahtarı: ${bId}`);
    if(!examMeta[bId]) throw new Error(`Sonuç paketinin sınav meta kaydı yok: ${bId}`);
    let batch = p.examResults[bId];
    if(!Array.isArray(batch)) throw new Error(`Sonuç paketi "${bId}" dizi değil.`);
    examResults[bId] = batch.map((r, idx) => {
      if(!r || typeof r !== 'object') throw new Error(`Sonuç paketi "${bId}" içinde geçersiz kayıt (${idx + 1}).`);
      let studentNo = String(r.studentNo || '').trim();
      let studentClass = normalizeClassName(r.studentClass);
      let parts = getClassParts(studentClass);
      let date = normalizeExamDate(r.date);
      let examType = String(r.examType || '').trim().toLocaleUpperCase('tr-TR');
      let totalNet = parseNumberStrict(r.totalNet);
      let score = parseNumberStrict(r.score);
      if(!studentNo || !studentNos.has(studentNo)) throw new Error(`Sonuç paketinde kayıtlı olmayan öğrenci no var: ${studentNo || 'boş'}`);
      if(!parts.grade || !parts.branch) throw new Error(`Sonuç paketinde sınıf formatı geçersiz: ${studentClass || 'boş'}`);
      if(!date || !examType || totalNet === null || score === null) throw new Error(`Sonuç paketi "${bId}" içinde tarih/sayı hatası (${idx + 1}).`);
      let subs = {};
      Object.keys(r.subs || {}).forEach(sub => {
        let raw = r.subs[sub];
        let net = parseNumberStrict(raw && typeof raw === 'object' ? raw.net : raw);
        if(net === null) throw new Error(`Sonuç paketi "${bId}" içinde geçersiz ders neti: ${sub}`);
        subs[toTitleCase(sub)] = raw && typeof raw === 'object' ? {...raw, net} : { net };
      });
      return {...r, examBatchId: bId, studentNo, studentClass, date, examType, publisher: toTitleCase(r.publisher || ''), totalNet, score, abs: r.abs === true, subs};
    });
    if(examMeta[bId] && (!examMeta[bId].count || examMeta[bId].count !== examResults[bId].length)) examMeta[bId].count = examResults[bId].length;
  });

  return { students, examMeta, examResults };
}

function upl(e, t) {
  let f = e.target.files[0]; if(!f) return;
  if(!xlsxReady()) { e.target.value=''; return; }
  // === FIX: XLSX yükleme kırılganlığı — uzantı, boyut, sayfa ve başlık doğrulamaları ===
  let validExt = /\.(xlsx|xls|xlsm|csv)$/i;
  if(!validExt.test(f.name)) { showToast('Sadece Excel/CSV dosyaları yüklenebilir (.xlsx, .xls, .xlsm, .csv).', 'error'); e.target.value=''; return; }
  if(f.size > 25 * 1024 * 1024) { showToast('Dosya çok büyük (>25MB). Lütfen daha küçük bir dosya kullanın.', 'error'); e.target.value=''; return; }
  ld(1, 'Dosya Analiz Ediliyor...'); currentUploadType = t;
  setTimeout(() => {
    let rd = new FileReader();
    rd.onerror = () => { ld(0); e.target.value=''; showToast('Dosya okunamadı.', 'error'); };
    rd.onload = ev => {
      try {
        if(!ev || !ev.target || !ev.target.result) throw new Error('Dosya içeriği okunamadı.');
        let wb;
        try { wb = XLSX.read(new Uint8Array(ev.target.result), {type:'array', cellDates:false, raw:true}); }
        catch(parseErr) { throw new Error('Excel dosyası bozuk veya tanınmıyor: ' + parseErr.message); }
        if(!wb || !wb.SheetNames || !wb.SheetNames.length) throw new Error('Dosyada hiç sayfa (sheet) bulunamadı.');
        // İlk dolu sayfayı bul (boş ilk sayfa varsa atla)
        let sheetName = null, sheet = null;
        for(let sn of wb.SheetNames) {
          let s = wb.Sheets[sn];
          if(s && s['!ref']) { sheetName = sn; sheet = s; break; }
        }
        if(!sheet) throw new Error('Dosyadaki tüm sayfalar boş görünüyor.');
        currentExcelData = XLSX.utils.sheet_to_json(sheet, {defval: '', raw: false});
        if(!Array.isArray(currentExcelData) || !currentExcelData.length) throw new Error('Sayfada veri satırı bulunamadı.');
        let range; try { range = XLSX.utils.decode_range(sheet['!ref']); } catch(rErr) { throw new Error('Sayfa aralığı çözümlenemedi.'); }
        currentHeaders = [];
        for(let C = range.s.c; C <= range.e.c; C++){
          let cell = sheet[XLSX.utils.encode_cell({c:C, r:range.s.r})];
          if(cell && cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== '') currentHeaders.push(String(cell.v).trim());
        }
        if(!currentHeaders.length) throw new Error('Başlık satırı bulunamadı (ilk satır boş).');
        buildMappingUI(); ld(0); showModal('mMappings', {backdrop: 'static'});
      } catch(err) { ld(0); getEl('fStu').value=''; getEl('fEx').value=''; showToast('Hata: ' + (err && err.message ? err.message : 'Bilinmeyen hata'), 'error'); }
    };
    try { rd.readAsArrayBuffer(f); } catch(rErr) { ld(0); e.target.value=''; showToast('Dosya okunamadı: ' + rErr.message, 'error'); }
  }, 100);
}

function buildOptions(headers, selectedGuess, allowEmpty) {
  let html = allowEmpty ? optionHtml('', '-- Boş Geç --') : optionHtml('', '-- Seçiniz --');
  headers.forEach(h => { let sel = !!(selectedGuess && selectedGuess !== '' && (h.toLocaleLowerCase('tr-TR') === selectedGuess.toLocaleLowerCase('tr-TR') || h.toLocaleLowerCase('tr-TR').includes(selectedGuess.toLocaleLowerCase('tr-TR')))); html += optionHtml(h, h, sel); }); return html;
}

let wizardStep = 0;

function buildMappingUI() {
  let b = getEl('mMappingsBody'), h = currentHeaders;
  if(currentUploadType === 's') {
    let saved = JSON.parse(userStorageGet('map_s') || '{}');
    b.innerHTML = `<div class="alert alert-info py-2 mapping-info"><i class="fas fa-info-circle me-1"></i> Excel dosyanızdaki sütunları sistemdeki alanlarla eşleştirin.</div>
      <div class="wizard-section"><h6><i class="fas fa-id-card me-1"></i> Temel Alanlar</h6>
        <div class="mb-3"><label class="form-label">Öğrenci No Sütunu</label><select id="map_s_no" class="form-select">${buildOptions(h, saved.no || 'no')}</select></div>
        <div class="mb-3"><label class="form-label">Ad Soyad Sütunu</label><select id="map_s_name" class="form-select">${buildOptions(h, saved.name || 'ad')}</select></div>
        <div class="mb-0"><label class="form-label">Sınıf Sütunu</label><select id="map_s_cls" class="form-select">${buildOptions(h, saved.cls || 'sınıf')}</select></div>
      </div>`;
    getEl('mMappingsFooter').innerHTML = `<button type="button" class="btn btn-secondary" onclick="cancelUpload()">İptal</button><button type="button" class="btn btn-primary" onclick="processMappings()">Onayla ve Analiz Et <i class="fas fa-arrow-right ms-1"></i></button>`;
  } else {
    wizardStep = 0; renderWizardStep();
    getEl('mMappingsFooter').innerHTML = `<button type="button" class="btn btn-secondary" onclick="cancelUpload()">İptal</button><div class="ms-auto d-flex mapping-footer-actions"><button type="button" class="btn btn-outline-secondary" id="wizBtnBack" onclick="wizardNav(-1)" style="display:none;"><i class="fas fa-arrow-left me-1"></i>Geri</button><button type="button" class="btn btn-primary" id="wizBtnNext" onclick="wizardNav(1)">İleri <i class="fas fa-arrow-right ms-1"></i></button><button type="button" class="btn btn-success" id="wizBtnDone" onclick="processMappings()" style="display:none;">Onayla ve Analiz Et <i class="fas fa-check ms-1"></i></button></div>`;
  }
}

const WIZARD_STEPS = [ { id:'wiz-step-0', title:'1. Sınav Genel Bilgileri' }, { id:'wiz-step-1', title:'2. Sabit Excel Sütunları' }, { id:'wiz-step-2', title:'3. Ders Netleri Eşleştirmesi' }, { id:'wiz-step-3', title:'4. Dereceler (İsteğe Bağlı)' } ];

function renderWizardStep() {
  let h = currentHeaders, saved = {}; try { saved = JSON.parse(userStorageGet('map_e') || '{}'); } catch(e){}
  let today = new Date().toISOString().split('T')[0], [y,m,d] = today.split('-'), trDate = `${d}.${m}.${y}`, b = getEl('mMappingsBody');

  let progHtml = `<div class="wizard-progress"><div class="wizard-step-row">${WIZARD_STEPS.map((s,i) => `<div class="wizard-step-label ${i===wizardStep?'is-active':i<wizardStep?'is-complete':''}">${i<wizardStep?'✓ ':''}${s.title}</div>`).join('')}</div><div class="progress"><div class="progress-bar wizard-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(((wizardStep+1)/WIZARD_STEPS.length)*100)}"></div></div></div>`;

  let stepHtml = '';
  if(wizardStep === 0) {
    stepHtml = `<div class="wizard-section"><h6><i class="fas fa-tag me-1"></i> Sınav Genel Bilgileri (Zorunlu)</h6>
      <div class="row"><div class="col-md-4"><div class="mb-3"><label class="form-label">Sınav Türü <small class="text-muted">(Örn: TYT)</small></label><input type="text" id="map_e_type" class="form-control" placeholder="TYT" value="${escapeHtml(saved.type||'')}"></div></div><div class="col-md-4"><div class="mb-3"><label class="form-label">Tarih <small class="text-muted">(GG.AA.YYYY)</small></label><input type="text" id="map_e_date" class="form-control" placeholder="15.04.2024" value="${escapeHtml(saved.date||trDate)}"></div></div><div class="col-md-4"><div class="mb-3"><label class="form-label">Yayınevi <small class="text-muted">(İsteğe Bağlı)</small></label><input type="text" id="map_e_pub" class="form-control" placeholder="MEB" value="${escapeHtml(saved.pub||'')}"></div></div></div>
      <div class="form-check mt-2"><input class="form-check-input" type="checkbox" id="map_e_mark_absent" ${saved.markAbsent?'checked':''}><label class="form-check-label" for="map_e_mark_absent">Dosyada olmayan sınıf öğrencilerini <strong>katılmadı</strong> olarak işaretle</label><div class="form-text">Kısmi/filtreli Excel yüklemelerinde bu seçenek kapalı kalmalıdır.</div></div></div>`;
  } else if(wizardStep === 1) {
    stepHtml = `<div class="wizard-section"><h6><i class="fas fa-columns me-1"></i> Sabit Excel Sütunları</h6>
      <div class="row"><div class="col-md-4"><div class="mb-3"><label class="form-label">Öğrenci No Sütunu <span class="text-danger">*</span></label><select id="map_e_no" class="form-select">${buildOptions(h, saved.no||'no')}</select></div></div><div class="col-md-4"><div class="mb-3"><label class="form-label">Toplam Net Sütunu <span class="text-danger">*</span></label><select id="map_e_tnet" class="form-select">${buildOptions(h, saved.tnet||'toplam')}</select></div></div><div class="col-md-4"><div class="mb-3"><label class="form-label">Toplam Puan Sütunu <span class="text-danger">*</span></label><select id="map_e_score" class="form-select">${buildOptions(h, saved.score||'puan')}</select></div></div></div></div>`;
  } else if(wizardStep === 2) {
    stepHtml = `<div class="wizard-section"><div class="d-flex justify-content-between align-items-center mb-3"><h6 class="mb-0 border-0"><i class="fas fa-book-open me-1"></i> Ders Netleri Eşleştirmesi</h6><button class="btn btn-success btn-sm" onclick="addSubjectRow()"><i class="fas fa-plus me-1"></i>Ders Ekle</button></div><p class="text-muted wizard-subject-note">Sadece analize dahil etmek istediğiniz dersleri seçin ve isimlendirin. Eşleştirilmeyenler tabloda — olarak görünür.</p><div id="subjectMapContainer"></div></div>`;
  } else if(wizardStep === 3) {
    stepHtml = `<div class="wizard-section"><h6><i class="fas fa-medal me-1"></i> Dereceler (İsteğe Bağlı)</h6><p class="text-muted wizard-note">Sınıf ve Kurum sıralaması artık sistem tarafından otomatik hesaplanmaktadır. Buradan yalnızca İlçe, İl ve Genel sıralamayı Excel'den alabilirsiniz.</p>
      <div class="row"><div class="col-md-6"><div class="mb-3"><label class="form-label"><i class="fas fa-city me-1"></i>İlçe Sırası Sütunu</label><select id="map_e_dR" class="form-select">${buildOptions(h, saved.dR||'ilçe sıra', true)}</select></div></div><div class="col-md-6"><div class="mb-3"><label class="form-label">İlçe Kişi Sayısı Sütunu</label><select id="map_e_dP" class="form-select">${buildOptions(h, saved.dP||'', true)}</select></div></div><div class="col-md-6"><div class="mb-3"><label class="form-label"><i class="fas fa-map-marker-alt me-1"></i>İl Sırası Sütunu</label><select id="map_e_pR" class="form-select">${buildOptions(h, saved.pR||'il sıra', true)}</select></div></div><div class="col-md-6"><div class="mb-3"><label class="form-label">İl Kişi Sayısı Sütunu</label><select id="map_e_pP" class="form-select">${buildOptions(h, saved.pP||'', true)}</select></div></div><div class="col-md-6"><div class="mb-3"><label class="form-label"><i class="fas fa-globe-europe me-1"></i>Genel Sırası Sütunu</label><select id="map_e_gR" class="form-select">${buildOptions(h, saved.gR||'genel sıra', true)}</select></div></div><div class="col-md-6"><div class="mb-3"><label class="form-label">Genel Kişi Sayısı Sütunu</label><select id="map_e_gP" class="form-select">${buildOptions(h, saved.gP||'', true)}</select></div></div></div></div>`;
  }
  
  b.innerHTML = progHtml + stepHtml;
  let progBar = b.querySelector('.wizard-progress-bar');
  if(progBar) progBar.style.width = `${((wizardStep+1)/WIZARD_STEPS.length)*100}%`;
  
  if(wizardStep === 2) {
    let savedSubs = []; try { savedSubs = JSON.parse(userStorageGet('map_e') || '{}').subs || []; } catch(e){}
    if(savedSubs.length > 0) { savedSubs.forEach(s => addSubjectRow(s.col, s.name)); } else {
      let trCol = h.find(x => x.toLocaleLowerCase('tr-TR').includes('türkçe') || x.toLocaleLowerCase('tr-TR') === 'tr'), matCol = h.find(x => x.toLocaleLowerCase('tr-TR').includes('matematik') || x.toLocaleLowerCase('tr-TR') === 'mat');
      if(trCol) addSubjectRow(trCol, 'Türkçe'); if(matCol) addSubjectRow(matCol, 'Matematik'); if(!trCol && !matCol) addSubjectRow();
    }
  }

  let btnBack = getEl('wizBtnBack'), btnNext = getEl('wizBtnNext'), btnDone = getEl('wizBtnDone');
  if(btnBack) btnBack.style.display = wizardStep > 0 ? 'inline-block' : 'none';
  if(btnNext) btnNext.style.display = wizardStep < WIZARD_STEPS.length - 1 ? 'inline-block' : 'none';
  if(btnDone) btnDone.style.display = wizardStep === WIZARD_STEPS.length - 1 ? 'inline-block' : 'none';
}

function wizardNav(dir) { saveWizardStepData(); wizardStep = Math.max(0, Math.min(WIZARD_STEPS.length - 1, wizardStep + dir)); renderWizardStep(); }

function saveWizardStepData() {
  let saved = {}; try { saved = JSON.parse(userStorageGet('map_e') || '{}'); } catch(e){}
  if(wizardStep === 0) { let t = getEl('map_e_type'), d = getEl('map_e_date'), p = getEl('map_e_pub'), ma = getEl('map_e_mark_absent'); if(t) saved.type = t.value; if(d) saved.date = d.value; if(p) saved.pub = p.value; if(ma) saved.markAbsent = ma.checked; }
  else if(wizardStep === 1) { let no = getEl('map_e_no'), tn = getEl('map_e_tnet'), sc = getEl('map_e_score'); if(no) saved.no = no.value; if(tn) saved.tnet = tn.value; if(sc) saved.score = sc.value; }
  else if(wizardStep === 2) { let rows = document.querySelectorAll('.subj-map-row'), subs = []; rows.forEach(r => { let c = r.querySelector('.map-subj-col').value, n = r.querySelector('.map-subj-name').value.trim(); if(c && n) subs.push({col:c,name:n}); }); saved.subs = subs; }
  else if(wizardStep === 3) { ['dR','dP','pR','pP','gR','gP'].forEach(k => { let el = getEl('map_e_'+k); if(el) saved[k] = el.value; }); ['cR','cP','iR','iP'].forEach(k => { delete saved[k]; }); }
  try { userStorageSet('map_e', JSON.stringify(saved)); } catch(e) {}
}

function addSubjectRow(selectedCol = '', typedName = '') {
  let div = document.createElement('div'); div.className = 'subj-map-row';
  let html = `<select class="form-select form-select-sm map-subj-col">${optionHtml('', '-- Excel Sütunu Seçin --')}`;
  currentHeaders.forEach(h => { html += optionHtml(h, h, h === selectedCol); });
  html += `</select><i class="fas fa-arrow-right text-muted mx-2 "></i><input type="text" class="form-control form-control-sm map-subj-name" placeholder="Sistemde Görünecek Ad (Örn: Türkçe)" value="${escapeHtml(toTitleCase(typedName))}"><button class="btn btn-danger btn-sm btn-remove" onclick="this.parentElement.remove()" title="Sil"><i class="fas fa-trash"></i></button>`;
  div.innerHTML = html; getEl('subjectMapContainer').appendChild(div);
}

function processMappings() {
  let d = currentExcelData, previewHtml = '';
  if(currentUploadType === 's') {
    let cNo = getEl('map_s_no').value, cName = getEl('map_s_name').value, cCls = getEl('map_s_cls').value;
    if(!cNo || !cName || !cCls) { showToast('Lütfen tüm temel alanları eşleştirin.', 'warning'); return; }
    try { userStorageSet('map_s', JSON.stringify({no: cNo, name: cName, cls: cCls})); } catch(e) {}

    let newStus = [], existingNos = [], invalidRows = [], seenNos = new Set();
    d.forEach((r, i) => {
      let n = String(r[cNo]||'').trim(), nm = String(r[cName]||'').trim(), cc = normalizeClassName(r[cCls]);
      let parts = getClassParts(cc);
      if(!n || !nm || !cc) { invalidRows.push({ rowNum: i + 2, data: `${n || '—'} - ${nm || '—'}`, reason: 'Eksik Alan' }); return; }
      if(!parts.grade || !parts.branch) { invalidRows.push({ rowNum: i + 2, data: `${n || '—'} - ${nm || '—'} - ${r[cCls] || ''}`, reason: 'Sınıf formatı geçersiz (örn: 9A)' }); return; }
      if(seenNos.has(n)) { invalidRows.push({ rowNum: i + 2, data: `${n} - ${nm}`, reason: 'Dosyada mükerrer numara (ilk satır kullanıldı)' }); return; }
      seenNos.add(n);
      if(getStuMap().get(n)) existingNos.push(n); else newStus.push({no:n, name:toTitleCase(nm), class:cc});
    });

    if(newStus.length === 0 && existingNos.length === 0) { showToast('Geçerli veri bulunamadı.', 'error'); return; }

    previewHtml = `<h5 class="text-primary border-bottom pb-2 mb-3">Öğrenci Listesi Analizi</h5>
      <div class="row"><div class="col-md-4"><div class="preview-box"><strong>Eklenecek Yeni:</strong><br><span class="text-success preview-count-lg">${newStus.length} Kişi</span></div></div>
      <div class="col-md-4"><div class="preview-box warning"><strong>Zaten Kayıtlı (Atlanacak):</strong><br><span class="text-warning preview-count-lg">${existingNos.length} Kişi</span></div></div>
      <div class="col-md-4"><div class="preview-box danger"><strong>Hatalı/Eksik Satır:</strong><br><span class="text-danger preview-count-lg">${invalidRows.length} Satır</span></div></div></div>`;
    if(existingNos.length > 0) previewHtml += `<div class="alert alert-warning mt-2 preview-alert"><strong>Sistemde Zaten Olan Numaralar:</strong> ${existingNos.slice(0,20).map(escapeHtml).join(', ')}${existingNos.length>20?'...':''}</div>`;
    if(invalidRows.length > 0) previewHtml += `<div class="table-responsive mt-3 preview-error-table"><table class="table table-sm table-striped mb-0"><thead><tr><th class="preview-col-row">Satır</th><th>Okunan Veri</th><th>Hata Nedeni</th></tr></thead><tbody>${invalidRows.map(err => `<tr><td><strong>${escapeHtml(err.rowNum)}</strong></td><td>${escapeHtml(err.data)}</td><td class="text-danger">${escapeHtml(err.reason)}</td></tr>`).join('')}</tbody></table></div>`;
    PENDING_UPLOAD = { type: 's', data: newStus };

  } else {
    let _sv = {}; try { _sv = JSON.parse(userStorageGet('map_e') || '{}'); } catch(e) {}
    let eType = (getEl('map_e_type') ? getEl('map_e_type').value.trim() : (_sv.type||'')).toLocaleUpperCase('tr-TR');
    let rawEDate = getEl('map_e_date') ? getEl('map_e_date').value.trim() : (_sv.date || '');
    let eDate = normalizeExamDate(rawEDate), ePub = getEl('map_e_pub') ? getEl('map_e_pub').value.trim() : (_sv.pub || '');
    let cNo = getEl('map_e_no') ? getEl('map_e_no').value : (_sv.no || ''), cTnet = getEl('map_e_tnet') ? getEl('map_e_tnet').value : (_sv.tnet || ''), cScore = getEl('map_e_score') ? getEl('map_e_score').value : (_sv.score || '');
    
    saveWizardStepData(); let _saved = {}; try { _saved = JSON.parse(userStorageGet('map_e') || '{}'); } catch(e) {}
    if(!eType) { showToast('Lütfen Sınav Türünü girin (Adım 1).', 'warning'); return; } 
    if(!rawEDate) { showToast('Lütfen Sınav Tarihini girin (Adım 1).', 'warning'); return; }
    if(!eDate){ showToast('Tarih gerçek bir GG.AA.YYYY tarihi olmalıdır! (Örn: 15.04.2024)', 'error'); return; }
    if(!cNo)   { showToast('Lütfen Öğrenci No sütununu seçin (Adım 2).', 'warning'); return; } if(!cTnet) { showToast('Lütfen Toplam Net sütununu seçin (Adım 2).', 'warning'); return; }
    if(!cScore){ showToast('Lütfen Puan sütununu seçin (Adım 2).', 'warning'); return; }

    let subRows = document.querySelectorAll('.subj-map-row'), subsMap = []; subRows.forEach(r => { let c = r.querySelector('.map-subj-col').value, n = r.querySelector('.map-subj-name').value.trim(); if(c && n) subsMap.push({col: c, name: n}); });
    if(subsMap.length === 0) { let _lsSubs = []; try { _lsSubs = JSON.parse(userStorageGet('map_e') || '{}').subs || []; } catch(e) {} if(_lsSubs.length > 0) subsMap = _lsSubs; }
    if(subsMap.length === 0) { showToast('En az bir ders neti eşleştirmelisiniz (Adım 3).', 'warning'); return; }

    saveWizardStepData(); let finalSaved = {}; try { finalSaved = JSON.parse(userStorageGet('map_e') || '{}'); } catch(e){}
    let markAbsent = !!finalSaved.markAbsent;
    let cRank = { cR: '', cP: '', iR: '', iP: '', dR: finalSaved.dR||'', dP: finalSaved.dP||'', pR: finalSaved.pR||'', pP: finalSaved.pP||'', gR: finalSaved.gR||'', gP: finalSaved.gP||'' };

    let gradesFound = new Set();
    d.forEach(r => { let no = String(r[cNo]||'').trim(); if(no) { let st = getStuMap().get(no); if(st) { let gr = getGrade(st.class); if(gr) gradesFound.add(gr); } } });
    let existsId = Object.keys(EXAM_META).find(id => { let em = EXAM_META[id]; if(em.examType !== eType || em.date !== eDate) return false; return metaIntersectsGrades(em, gradesFound); });
    let bId = existsId || Date.now().toString();
    let cl=new Set(), sn=new Set(), validResults = [], missingStus = [], invalidRows = [], subjectsFound = new Set(), seenStudentNos = new Set();

    d.forEach((r, i) => {
      let no = String(r[cNo]||'').trim(), st = getStuMap().get(no), net = r[cTnet];
      if(!no) { invalidRows.push({ rowNum: i + 2, no: '—', reason: 'Numara Boş' }); return; }
      if(!st) { missingStus.push(no); return; } 
      if(net === undefined || net === null || net === '') { invalidRows.push({ rowNum: i + 2, no: no, reason: 'Toplam Net Yok' }); return; }
      if(seenStudentNos.has(no)) { invalidRows.push({ rowNum: i + 2, no: no, reason: `Mükerrer Öğrenci` }); return; }
      let totalNet = parseNumberStrict(r[cTnet]);
      let score = parseNumberStrict(r[cScore]);
      if(totalNet === null) { invalidRows.push({ rowNum: i + 2, no: no, reason: 'Toplam Net sayısal değil' }); return; }
      if(score === null) { invalidRows.push({ rowNum: i + 2, no: no, reason: 'Puan sayısal değil' }); return; }
      seenStudentNos.add(no); cl.add(st.class); sn.add(no);
      let getRank = (col) => { if(!col) return '-'; let v = r[col]; return (v !== undefined && v !== null && v !== '') ? String(v) : '-'; };
      let ex = { examBatchId:bId, studentNo:st.no, studentClass:st.class, date:eDate, examType:eType, publisher:toTitleCase(ePub), totalNet, score, cR:getRank(cRank.cR), cP:getRank(cRank.cP), iR:getRank(cRank.iR), iP:getRank(cRank.iP), dR:getRank(cRank.dR), dP:getRank(cRank.dP), pR:getRank(cRank.pR), pP:getRank(cRank.pP), gR:getRank(cRank.gR), gP:getRank(cRank.gP), abs:false, subs:{} };
      for(let sm of subsMap) {
        let rawVal = r[sm.col];
        if(rawVal !== undefined && rawVal !== null && rawVal !== '') {
          let subjNet = parseNumberStrict(rawVal);
          if(subjNet === null) { invalidRows.push({ rowNum: i + 2, no: no, reason: `${sm.name} neti sayısal değil` }); return; }
          ex.subs[toTitleCase(sm.name)] = {net: subjNet};
          subjectsFound.add(toTitleCase(sm.name));
        }
      }
      validResults.push(ex);
    });

    let clsGroups = {}, instGroups = {};
    validResults.filter(x=>!x.abs).forEach(x => { if(!clsGroups[x.studentClass]) clsGroups[x.studentClass] = []; clsGroups[x.studentClass].push(x); let gr = getGrade(x.studentClass); if(!instGroups[gr]) instGroups[gr] = []; instGroups[gr].push(x); });
    Object.values(clsGroups).forEach(arr => { arr.sort((a,b) => (b.score||0) - (a.score||0)); arr.forEach((r, idx) => { r.cR = String(idx+1); r.cP = String(arr.length); }); });
    Object.values(instGroups).forEach(arr => { arr.sort((a,b) => (b.score||0) - (a.score||0)); arr.forEach((r, idx) => { r.iR = String(idx+1); r.iP = String(arr.length); }); });
    let absentCount = 0, notInFileCount = 0;
    DB.s.forEach(s => {
      if(cl.has(s.class) && !sn.has(s.no)) {
        if(markAbsent) {
          validResults.push({ examBatchId:bId, studentNo:s.no, studentClass:s.class, date:eDate, examType:eType, publisher:toTitleCase(ePub), totalNet:0, score:0, cR:'-', cP:'-', iR:'-', iP:'-', dR:'-', dP:'-', pR:'-', pP:'-', gR:'-', gP:'-', abs:true, subs:{} });
          absentCount++;
        } else {
          notInFileCount++;
        }
      }
    });
    if(validResults.length === 0) { showToast('Sisteme eklenecek geçerli bir sınav sonucu bulunamadı.', 'error'); return; }
    let _oldCount = (existsId && Array.isArray(CACHED_RESULTS[existsId])) ? CACHED_RESULTS[existsId].length : null;
    let overwriteWarning = existsId ? `<div class="alert alert-warning mt-3"><strong><i class="fas fa-exclamation-triangle me-2"></i>Bu sınav sistemde zaten kayıtlı!</strong> <b>${escapeHtml(eDate)}</b> tarihli <b>${escapeHtml(eType)}</b> sınavı için ${_oldCount !== null ? `<b>${_oldCount}</b> kayıt` : 'kayıtlar'} mevcut. Nasıl devam edilsin?
      <div class="form-check mt-2"><input class="form-check-input" type="radio" name="uploadMode" id="uploadModeMerge" value="merge" checked><label class="form-check-label" for="uploadModeMerge"><strong>Birleştir (önerilen):</strong> Dosyadaki öğrencilerin sonuçları eklenir veya güncellenir; dosyada olmayan öğrencilerin mevcut sonuçları <u>korunur</u>.</label></div>
      <div class="form-check mt-1"><input class="form-check-input" type="radio" name="uploadMode" id="uploadModeReplace" value="replace"><label class="form-check-label" for="uploadModeReplace"><strong>Tamamen değiştir:</strong> Eski sınav verisi silinir; yalnızca bu dosyadaki sonuçlar kalır.</label></div></div>` : '';
    let missingFromFileLabel = markAbsent ? 'Katılmadı:' : 'Dosyada Yok:';
    let missingFromFileClass = markAbsent ? 'text-warning' : 'text-muted';
    let missingFromFileTitle = markAbsent ? 'Sınıf listesinde olup dosyada bulunmayanlar. Katılmadı olarak işaretlenecek.' : 'Sınıf listesinde olup dosyada bulunmayanlar. Devamsız sayılmayacak ve kayıt oluşturulmayacak.';
    let missingFromFileCount = markAbsent ? absentCount : notInFileCount;
    previewHtml = `<h5 class="text-primary border-bottom pb-2 mb-3">Sınav Analizi: <strong>${escapeHtml(eType)}</strong> - ${escapeHtml(eDate)} <small class="text-muted">(${escapeHtml(toTitleCase(ePub)||'Yayınevi Yok')})</small></h5>
      <div class="row"><div class="col-md-3"><div class="preview-box compact"><strong>Geçerli Sonuç:</strong><br><span class="text-success preview-count-md">${validResults.length - absentCount} Kişi</span></div></div><div class="col-md-3"><div class="preview-box compact ${markAbsent?'warning':''}" title="${missingFromFileTitle}"><strong>${missingFromFileLabel}</strong><br><span class="${missingFromFileClass} preview-count-md">${missingFromFileCount} Kişi</span></div></div><div class="col-md-3"><div class="preview-box compact danger" title="Dosyada olan ama sistemde kaydı olmayanlar."><strong>Sistemde Yok:</strong><br><span class="text-danger preview-count-md">${missingStus.length} Kişi</span></div></div><div class="col-md-3"><div class="preview-box compact danger danger-strong" title="Excel hataları."><strong>Hatalı Satır:</strong><br><span class="text-danger preview-count-md">${invalidRows.length} Satır</span></div></div></div>${overwriteWarning}`;
    if(missingStus.length > 0) previewHtml += `<div class="alert alert-warning mt-2 preview-alert"><strong>Sistemde Bulunamayan Numaralar (Atlanacak):</strong> ${missingStus.slice(0,20).map(escapeHtml).join(', ')}${missingStus.length>20?'...':''}</div>`;
    if(invalidRows.length > 0) previewHtml += `<div class="table-responsive mt-3 preview-error-table"><table class="table table-sm table-striped mb-0"><thead><tr><th class="preview-col-row">Satır</th><th class="preview-col-no">Öğrenci No</th><th>Hata Nedeni (Yüklenmeyecek)</th></tr></thead><tbody>${invalidRows.map(err => `<tr><td><strong>${escapeHtml(err.rowNum)}</strong></td><td>${escapeHtml(err.no)}</td><td class="text-danger">${escapeHtml(err.reason)}</td></tr>`).join('')}</tbody></table></div>`;
    PENDING_UPLOAD = { type: 'e', existsId: existsId, bId: bId, bD: eDate, bT: eType, bPub: toTitleCase(ePub), newResults: validResults, subjects: Array.from(subjectsFound), grades: Array.from(gradesFound), markAbsent: markAbsent, omittedStudents: notInFileCount };
  }
  getEl('uploadPreviewBody').innerHTML = previewHtml; hideModal('mMappings'); showModal('mUploadPreview', {backdrop: 'static'});
}

let UPLOAD_IN_PROGRESS = false;

async function confirmUpload() {
  if(UPLOAD_IN_PROGRESS) return;
  if(!PENDING_UPLOAD) return cancelUpload();
  if(!requireAdmin('Veri yükleme')) return;
  if(!ensureOnlineForWrite('Veri yükleme')) return;
  // Aynı sınav zaten kayıtlıysa: 'merge' (varsayılan, mevcut sonuçlar korunur) ya da 'replace' (tamamen değiştir)
  let _uploadMode = (getEl('uploadModeReplace') && getEl('uploadModeReplace').checked) ? 'replace' : 'merge';
  // Çift tıklama koruması: butonu disable et ve yükleme bayrağını kur
  UPLOAD_IN_PROGRESS = true;
  let _btn = getEl('btnConfirmUpload');
  if(_btn){ _btn.disabled = true; _btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Kaydediliyor…'; }
  hideModal('mUploadPreview'); ld(1, 'Veriler buluta gönderiliyor, lütfen bekleyin...');
  try {
    if(PENDING_UPLOAD.type === 's') {
      let nextStudents = DB.s.concat(PENDING_UPLOAD.data);
      await database.ref('db_v2').update({ students: nextStudents });
      DB.s = nextStudents;
      _stuMapCache = null;
      rTabS(); uStat(); showToast(`${PENDING_UPLOAD.data.length} yeni öğrenci sisteme başarıyla eklendi.`, 'success');
    } 
    else if (PENDING_UPLOAD.type === 'e') {
      let finalResults = PENDING_UPLOAD.newResults, finalSubjects = PENDING_UPLOAD.subjects, finalGrades = PENDING_UPLOAD.grades, finalPub = PENDING_UPLOAD.bPub;
      let mergeInfo = null;
      if(PENDING_UPLOAD.existsId && _uploadMode === 'merge'){
        // Birleştirme: mevcut kayıtlar Firebase'den taze okunur (başka oturum değiştirmiş olabilir)
        let oldSnap = await database.ref('db_v2/examResults/' + PENDING_UPLOAD.existsId).once('value');
        let merged = new Map(toCleanArray(oldSnap.val()).filter(Boolean).map(r => [r.studentNo, r]));
        let applied = 0;
        PENDING_UPLOAD.newResults.forEach(r => {
          let o = merged.get(r.studentNo);
          if(r.abs && o && !o.abs) return; // "katılmadı" işaretlenen ama mevcut gerçek sonucu olan öğrencinin sonucu korunur
          merged.set(r.studentNo, r); applied++;
        });
        finalResults = Array.from(merged.values());
        let oldMeta = EXAM_META[PENDING_UPLOAD.existsId] || {};
        finalGrades = Array.from(new Set([...(metaGrades(oldMeta) || []).map(String), ...(PENDING_UPLOAD.grades || []).map(String)]));
        finalSubjects = Array.from(new Set([...(Array.isArray(oldMeta.subjects) ? oldMeta.subjects : []), ...(PENDING_UPLOAD.subjects || [])]));
        if(!finalPub) finalPub = oldMeta.publisher || '';
        mergeInfo = { applied, kept: finalResults.length - applied };
      }
      let examMeta = { date: PENDING_UPLOAD.bD, examType: PENDING_UPLOAD.bT, publisher: finalPub, count: finalResults.length, subjects: finalSubjects, grades: finalGrades, updatedAt: Date.now() };
      let updates = {
        ['examResults/' + PENDING_UPLOAD.bId]: finalResults,
        ['examMeta/' + PENDING_UPLOAD.bId]: examMeta
      };
      if(PENDING_UPLOAD.existsId && PENDING_UPLOAD.existsId !== PENDING_UPLOAD.bId) {
        updates['examResults/' + PENDING_UPLOAD.existsId] = null;
        updates['examMeta/' + PENDING_UPLOAD.existsId] = null;
      }
      await database.ref('db_v2').update(updates);
      if(PENDING_UPLOAD.existsId && PENDING_UPLOAD.existsId !== PENDING_UPLOAD.bId) {
        delete CACHED_RESULTS[PENDING_UPLOAD.existsId];
        delete EXAM_META[PENDING_UPLOAD.existsId];
      }
      CACHED_RESULTS[PENDING_UPLOAD.bId] = finalResults;
      EXAM_META[PENDING_UPLOAD.bId] = examMeta;
      rebuildDbFromCache();
      _riskCache = null; // Risk cache'i geçersiz kıl
      showToast(mergeInfo ? `Sınav sonuçları birleştirildi: ${mergeInfo.applied} sonuç eklendi/güncellendi, ${mergeInfo.kept} mevcut sonuç korundu.` : 'Sınav sonuçları sisteme başarıyla kaydedildi.', 'success', mergeInfo ? 6500 : 4000);
    }
  } catch(err) { showToast('Kayıt sırasında hata oluştu: ' + err.message, 'error'); }
  finally {
    UPLOAD_IN_PROGRESS = false;
    if(_btn){ _btn.disabled = false; _btn.innerHTML = 'Kaydet'; }
    cancelUpload(); ld(0);
  }
}

let APP_BOOTED = false;
function bootApp(){
  if(APP_BOOTED) return;
  APP_BOOTED = true;
  checkAuth();
  document.body.addEventListener('click', function(e){
    if(!document.body.classList.contains('sidebar-open')) return;
    var sidebar = document.querySelector('.app-sidebar');
    var toggleBtn = document.querySelector('[data-lte-toggle="sidebar"]');
    if(sidebar && !sidebar.contains(e.target) && toggleBtn && !toggleBtn.contains(e.target)){
      if(typeof closeSidebarIfOpen === 'function') closeSidebarIfOpen();
      else {
        document.body.classList.remove('sidebar-open');
        document.body.classList.add('sidebar-collapse');
        document.querySelectorAll('.sidebar-overlay,.sidebar-backdrop').forEach(el => el.remove());
      }
    }
  });
  // Service Worker kaydı ve eski önbelleklerin temizliği index.html (başlangıç betiği) ve sw.js (activate) tarafından yapılır.
}

if(document.readyState === 'complete') bootApp();
else window.addEventListener('load', bootApp);

let deferredInstallPrompt = null, pwaPopupTimer = null, pwaPopupShowTimer = null, userLoggedIn = false;
let pwaInstallToast = null, pwaInstallCompleted = false;
let pwaInstallHandled = false;

function clearPwaInstallToast() {
  if(pwaInstallToast && pwaInstallToast.parentNode) pwaInstallToast.remove();
  pwaInstallToast = null;
  document.querySelectorAll('[data-toast-key="pwa-install-loading"]').forEach(toast => toast.remove());
}

function showPwaInstallLoading() {
  if(pwaInstallToast && pwaInstallToast.parentNode) return;
  clearPwaInstallToast();
  pwaInstallToast = showToast('Uygulama yükleniyor...', 'info', 12000);
  if(pwaInstallToast) pwaInstallToast.dataset.toastKey = 'pwa-install-loading';
}

function finishPwaInstallFlow() {
  if(pwaInstallHandled) return;
  pwaInstallHandled = true;
  clearPwaInstallToast();
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  pwaInstallCompleted = false;
  pwaInstallHandled = false;
  clearPwaInstallToast();
  if (userLoggedIn) showPwaPopupIfReady();
});

// Başarı bildirimi tarayıcı/işletim sistemi tarafından verilir; burada yalnızca yükleniyor toast'ı temizlenir.
window.addEventListener('appinstalled', () => {
  pwaInstallCompleted = true;
  deferredInstallPrompt = null;
  let installWrap = document.getElementById('installBtnWrapper');
  if(installWrap) installWrap.style.display = 'none';
  closePwaPopup();
  finishPwaInstallFlow();
});

// iOS Safari'de beforeinstallprompt olayı yoktur; kurulum adımı kullanıcıya (cihaz başına bir kez) kısa bir ipucuyla anlatılır.
function _maybeShowIosInstallHint() {
  try {
    const ua = navigator.userAgent || '';
    const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    if(!isIos || standalone || !isSafari) return;
    if(userStorageGet('iosInstallHint') === '1') return;
    userStorageSet('iosInstallHint', '1');
    setTimeout(() => showToast('Uygulamayı ana ekrana eklemek için Safari’de Paylaş düğmesine, ardından “Ana Ekrana Ekle”ye dokunun.', 'info', 10000), 2500);
  } catch(e) {}
}

function showPwaPopupIfReady() {
  userLoggedIn = true;
  _maybeShowIosInstallHint();
  if (!deferredInstallPrompt || pwaInstallCompleted || pwaInstallHandled) return;
  let installWrap = document.getElementById('installBtnWrapper');
  if(installWrap) installWrap.style.display = 'block';
  if(pwaPopupShowTimer) clearTimeout(pwaPopupShowTimer);
  pwaPopupShowTimer = setTimeout(() => {
    pwaPopupShowTimer = null;
    if (!deferredInstallPrompt || pwaInstallCompleted || pwaInstallHandled) return;
    const popup = document.getElementById('pwaInstallPopup');
    if(!popup) return;
    const bar = popup.querySelector('.pwa-progress');
    if(bar) {
      bar.style.animation = 'none';
      bar.offsetHeight;
      bar.style.animation = 'pwaBar 4s linear forwards';
    }
    popup.style.animation = 'popupSlideDown 0.4s ease-out';
    popup.style.display = 'flex';
    if(pwaPopupTimer) clearTimeout(pwaPopupTimer);
    pwaPopupTimer = setTimeout(() => closePwaPopup(), 4000);
  }, 1500);
}

function closePwaPopup() {
  if(pwaPopupShowTimer) {
    clearTimeout(pwaPopupShowTimer);
    pwaPopupShowTimer = null;
  }
  const popup = document.getElementById('pwaInstallPopup');
  if (!popup || popup.style.display === 'none') return;
  clearTimeout(pwaPopupTimer);
  popup.style.animation = 'popupSlideUp 0.3s ease-in forwards';
  setTimeout(() => { popup.style.display = 'none'; popup.style.animation = ''; }, 300);
}

// userChoice kullanıcının diyalogu kabul/reddettiğini bildirir, yükleme tamamını değil.
// Başarı toast'ı gösterilmez; burada sadece "yükleniyor" gösterilir.
function triggerInstall(e) {
  if(e && e.preventDefault) e.preventDefault();
  closePwaPopup();
  if (!deferredInstallPrompt) {
    let installWrap = document.getElementById('installBtnWrapper');
    if(installWrap) installWrap.style.display = 'none';
    showToast('Uygulama yükleme hazır değil. Sayfayı yenileyip tekrar deneyin.', 'warning', 4500);
    return;
  }
  pwaInstallCompleted = false;
  pwaInstallHandled = false;
  const promptEvent = deferredInstallPrompt;
  showPwaInstallLoading();
  try {
    promptEvent.prompt();
  } catch(err) {
    deferredInstallPrompt = null;
    clearPwaInstallToast();
    showToast('Yükleme penceresi açılamadı. Sayfayı yenileyip tekrar deneyin.', 'warning', 4500);
    return;
  }
  Promise.resolve(promptEvent.userChoice).then(choice => {
    deferredInstallPrompt = null;
    if (choice && choice.outcome === 'accepted') {
      let installWrap = document.getElementById('installBtnWrapper');
      if(installWrap) installWrap.style.display = 'none';
    } else {
      clearPwaInstallToast();
    }
  }).catch(() => {
    deferredInstallPrompt = null;
    clearPwaInstallToast();
  });
}
