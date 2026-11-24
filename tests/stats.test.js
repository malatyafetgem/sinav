// İstatistik ve yardımcı fonksiyonlar için birim testleri.
// Çalıştırma (Node 18+):  node --test
// Fonksiyonlar kaynak dosyalardan okunup izole bir bağlamda çalıştırılır; tarayıcı/Firebase gerekmez.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/^\uFEFF/, '').replace(/\r/g, '');

// Basit süslü parantez eşleştirmesiyle fonksiyon gövdesini çıkarır
function grab(src, name) {
  const L = src.split('\n');
  const i = L.findIndex(l => new RegExp('^(async )?function ' + name + '\\(').test(l));
  if (i < 0) throw new Error('Fonksiyon bulunamadı: ' + name);
  let depth = 0, started = false, out = [];
  for (let j = i; j < L.length; j++) {
    out.push(L[j]);
    for (const ch of L[j].replace(/'[^']*'|"[^"]*"|`[^`]*`|\/\/.*$/g, '')) {
      if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--;
    }
    if (started && depth === 0) break;
  }
  return out.join('\n');
}

const core = read('app-core.js'), ui = read('app-ui.js'), an = read('app-analysis.js');
const pick = (src, names) => names.map(n => grab(src, n)).join('\n');
const settings = read('app-settings.js');
const code = [
  pick(settings, ['_parseManualCount', '_wizardAvailableGrades']),
  pick(core, ['linRegSlope', 'linRegR2', 'parseNumberStrict', 'toTitleCase', 'calcZScore']),
  pick(ui, ['getGrade']),
  'const _TREND_ALPHA = 0.10, _TREND_SIG_MIN_N = 4;',
  pick(an, ['_statMean', '_statStd', '_statCohenD', '_lgamma', '_betacf', '_betai', '_tTwoSidedP', '_trendFit',
            '_rankSorted', '_perStudentMeans', '_hasMetric', '_surpriseLabel', '_iqrSpreadInfo']),
  pick(core, ['_applyDerivedRanks']),
].join('\n');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(code + '\nObject.assign(this,{_parseManualCount,_wizardAvailableGrades,_trendFit,_statCohenD,_rankSorted,_perStudentMeans,_hasMetric,_surpriseLabel,_iqrSpreadInfo,_applyDerivedRanks,parseNumberStrict});', ctx);

const plain = x => JSON.parse(JSON.stringify(x)); // farklı vm bağlamından gelen dizileri düz değere çevirir
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('trend: SciPy referans değerleriyle uyum (eğim, R², p)', () => {
  const A = ctx._trendFit([10, 12, 15, 14, 18, 21]);
  near(A.slope, 2.0571428571428574); near(A.r2, 0.9257142857142859); near(A.p, 0.002122883053839458, 1e-9);
  assert.equal(A.significant, true);
  const B = ctx._trendFit([10, 14, 9, 13, 10]);
  near(B.p, 0.9072218512964005, 1e-9); assert.equal(B.significant, false);
});
test('trend: sabit seri, kusursuz doğru ve az gözlem', () => {
  const C = ctx._trendFit([5, 5, 5, 5]); assert.equal(C.significant, false); assert.equal(C.slope, 0);
  const D = ctx._trendFit([10, 11, 12, 13, 14, 15, 16, 17]); assert.equal(D.significant, true); assert.ok(D.p < 1e-10);
  assert.equal(ctx._trendFit([1, 2, 3]).significant, false, 'n=3 anlamlı sayılmaz');
  assert.equal(ctx._trendFit([1, 2]).p, null);
});
test('etki büyüklüğü: Hedges g (küçük örneklem düzeltmeli)', () => {
  const a = [10, 12, 11, 13, 12, 14, 11, 12, 13, 10], b = [8, 9, 7, 10, 9, 8, 9, 7, 8, 9];
  near(ctx._statCohenD(a, b), 2.820071455703694, 1e-9);
  assert.ok(ctx._statCohenD(b, a) < 0, 'işaret grup sırasına bağlı');
});
test('sıralama: eşit değerler aynı sırayı alır (1-1-3-4-4-6)', () => {
  const sorted = [10, 10, 9, 8, 8, 7];
  assert.deepEqual(plain(ctx._rankSorted(sorted, x => x)), [1, 1, 3, 4, 4, 6]);
});
test('türetilmiş sıralar: sınıf ve kurum, beraberlikte aynı sıra, devamsızlar atlanır', () => {
  const rows = [
    { examBatchId: 'b', studentClass: '5A', score: 400, studentNo: '1' },
    { examBatchId: 'b', studentClass: '5A', score: 400, studentNo: '2' },
    { examBatchId: 'b', studentClass: '5A', score: 380, studentNo: '3' },
    { examBatchId: 'b', studentClass: '5B', score: 410, studentNo: '4' },
    { examBatchId: 'b', studentClass: '5B', abs: true, score: 0, studentNo: '5', cR: '-' },
  ];
  ctx._applyDerivedRanks(rows);
  assert.deepEqual(rows.slice(0, 3).map(r => r.cR), ['1', '1', '3']);
  assert.deepEqual(rows.map(r => r.iR).slice(0, 4), ['2', '2', '4', '1'], 'kurum sırası sınıf seviyesi içinde (5A+5B)');
  assert.equal(rows[3].iP, '4'); assert.equal(rows[4].cR, '-');
});
test('öğrenci ortalamaları: çoklu sınav tek gözlem sayılır', () => {
  const m = ctx._perStudentMeans([{ studentNo: 'a', v: 10 }, { studentNo: 'a', v: 20 }, { studentNo: 'b', v: 5 }, { studentNo: 'c', v: null }], r => r.v);
  assert.deepEqual(plain(m).sort((x, y) => x - y), [5, 15]);
});
test('ders bazlı metrik: dersi olmayan kayıt dışlanır', () => {
  assert.equal(ctx._hasMetric({ subs: { 'Fen Bilimleri': { net: 3 } } }, 's_fen bilimleri'), true);
  assert.equal(ctx._hasMetric({ subs: { 'Türkçe': { net: 3 } } }, 's_fen bilimleri'), false);
  assert.equal(ctx._hasMetric({ subs: {} }, 'totalNet'), true);
});
test('sürpriz payı: ölçekten bağımsız etiket ve geri dönüş', () => {
  assert.equal(ctx._surpriseLabel(2, 20), 'Çok Düşük');
  assert.equal(ctx._surpriseLabel(8, 20), 'Düşük');
  assert.equal(ctx._surpriseLabel(12, 20), 'Orta');
  assert.equal(ctx._surpriseLabel(20, 20), 'Yüksek');
  assert.equal(ctx._surpriseLabel(3, null), 'Çok Düşük', 'ölçek yoksa mutlak eşikler');
});
test('IQR/medyan etiketi: nötr dil ve eşikler', () => {
  assert.equal(ctx._iqrSpreadInfo(10, 100).label, 'Homojen / Dengeli');
  assert.equal(ctx._iqrSpreadInfo(25, 100).label, 'Orta düzeyde dağılım');
  assert.equal(ctx._iqrSpreadInfo(35, 100).label, 'Seviye farkı belirgin');
  assert.equal(ctx._iqrSpreadInfo(50, 100).label, 'Seviye farkı çok yüksek');
  assert.equal(ctx._iqrSpreadInfo(5, 0).label, '—');
});
test('sayı ayrıştırma: virgüllü ondalık ve geçersiz değerler', () => {
  assert.equal(ctx.parseNumberStrict('12,5'), 12.5);
  assert.equal(ctx.parseNumberStrict(''), null);
  assert.equal(ctx.parseNumberStrict('abc'), null);
});
test('elle girilen kişi sayısı: boş kullanılmaz, yalnızca pozitif tam sayı kabul edilir', () => {
  assert.equal(ctx._parseManualCount(''), '');
  assert.equal(ctx._parseManualCount('  '), '');
  assert.equal(ctx._parseManualCount(' 5000 '), '5000');
  for (const bad of ['0', '-3', '12.5', '1e3', 'abc', '012', '1234567890']) assert.equal(ctx._parseManualCount(bad), null, bad);
});
test('sınav aktarma: seçilebilir sınıf seviyeleri sistemdeki öğrencilerden, sayısal sırayla ve tekrarsız çıkar', () => {
  ctx.DB = { s: [{ class: '10A' }, { class: '9B' }, { class: '12A' }, { class: '9A' }, { class: '11C' }, { class: '10B' }, { class: 'HZR' }] };
  assert.deepEqual(plain(ctx._wizardAvailableGrades()), ['9', '10', '11', '12']);
  ctx.DB = { s: [] };
  assert.deepEqual(plain(ctx._wizardAvailableGrades()), []);
});
