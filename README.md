# Sınav Analizi

Okullar için Türkçe, tarayıcı tabanlı **sınav sonucu analiz** uygulaması. Öğrenci ve deneme sınavı sonuçlarını Excel'den alır; öğrenci karnesi, sınıf/ders/sınav analizleri, risk izleme ve toplu rapor üretir. Firebase (Auth + Realtime Database) ve saf JavaScript kullanır; derleme adımı yoktur.

## Dosyalar

| Dosya | Görev |
|---|---|
| `index.html` | Sayfa iskeleti, giriş, modallar, betik yükleyici |
| `app-core.js` | Firebase, oturum, veri önbelleği (`DB`, `EXAM_META`, `CACHED_RESULTS`), ortak yardımcılar |
| `app-ui.js` | Sekmeler, filtreler, yazdırma motoru (`xPR`), Excel dışa aktarma, kart açıklamaları |
| `app-analysis.js` | Analizler (öğrenci, sınıf, ders, sınav detayı, risk, toplu rapor) ve istatistik yardımcıları |
| `app-settings.js` | Öğrenci/sınav yönetimi, Excel içe aktarma sihirbazı, yedekleme/geri yükleme |
| `style.css` | Tüm stiller |
| `sw.js`, `manifest.json` | PWA (servis çalışanı, kurulum) |
| `version.js` | `APP_VERSION` — her değişiklik sonrası artırılır (önbellek sürümü bu değerden türer) |
| `database.rules.json` | Realtime Database güvenlik kuralları (aşağıya bakın) |
| `tests/` | İstatistik/yardımcı fonksiyon birim testleri |

## Kurulum ve yayın

- Uygulama `/sinav/` alt yolunda yayınlanacak şekilde yapılandırılmıştır (`manifest.json`, `sw.js` ve `index.html` içindeki servis çalışanı kaydı). Farklı bir yola taşınırsa bu üç yerdeki yollar güncellenmelidir.
- Her değişiklikten sonra `version.js` içindeki `APP_VERSION` değeri artırılmalıdır; betikler ve önbellek bu sürümle yenilenir.

## Veri modeli (Realtime Database, `db_v2`)

- `students`: `{ no, name, class }` listesi
- `examMeta/<paketId>`: `{ date, examType, publisher, count, subjects[], grades[], updatedAt }`
- `examResults/<paketId>`: öğrenci başına `{ studentNo, studentClass, date, examType, publisher, totalNet, score, subs{ders:{net}}, abs, ... }`

Sınıf ve kurum sıraları (`cR/cP/iR/iP`) saklanan değerlerden değil, her yüklemede güncel veriden **türetilir** (eşit puan = aynı sıra).

## Güvenlik

Yazma işlemleri yalnızca `admin` yetkisi (custom claim) olan kullanıcılara açıktır; okuma için oturum açmak yeterlidir (`database.rules.json`). Arayüzdeki yönetici kontrolleri yalnızca ön kontroldür; asıl koruma bu kurallardır. API anahtarı istemcide görünür (Firebase için normaldir); anahtara Google Cloud konsolunda yalnızca kendi alan adınızdan kullanım kısıtı koymanız önerilir.

Silme, sıfırlama ve geri yükleme işlemlerinden önce **otomatik yedek** (`OtomatikYedek_*.json`) indirilir; yedek alınamazsa işlem yapılmaz.

## İstatistik yöntemleri (özet)

- **Trend:** Eğimin t-testi (iki yönlü, p ≤ 0.10, en az 4 sınav). Anlamlı değilse yön söylenmez. R², açıklanan varyans oranıdır (tahmin doğruluğu değildir).
- **Etki büyüklüğü:** Hedges g (küçük örneklem düzeltmeli Cohen d); en az 10 öğrenci gerekir. En yüksek ortalamalı grup veriden seçildiği için fark olduğundan büyük görünebilir.
- **Risk analizi:** Öğrencinin her sınavdaki göreli konumu (sınav içi z-skoru) üzerinden; sınavlar arası zorluk farkı ortadan kalkar.
- **Dersler arası kıyas:** Soru sayısı saklanmadığı için ham netler dersler arasında değil, aynı dersteki sınıflar arasında karşılaştırılır; dersler arası kıyas standartlaştırılmış farkla yapılır.
- **Sıralamalar:** Çok sınav seçiliyse sıralamaya sınavların en az yarısına giren öğrenciler dahildir.

## Test

```
node --test
```

Birim testler `tests/` altındadır (Node 18+; harici bağımlılık yoktur).

## Bilinen sınırlar

- Sınav kimliği (tür, tarih, sınıf seviyesi) üçlüsüdür; aynı gün aynı türde iki ayrı sınav saklanamaz.
- Doğru/yanlış/boş sayıları ve soru sayısı saklanmaz (yalnızca net).
- Uygulama tüm sınav paketlerini açılışta indirir; çok büyük veride açılış süresi uzar.
