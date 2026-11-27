# Legal notes / Hukuki notlar

GlassHouse is a hackathon prototype on Solana **devnet** with **mock USDC**. Nothing here is
financial, legal or tax advice, and nothing here is an offer of credit or of securities.
Bu bir hackathon prototipidir: Solana **devnet**, **sahte (mock) USDC**. Hiçbir metin finansal,
hukuki ya da vergi tavsiyesi veya kredi/menkul kıymet teklifi değildir.

## 1. Compliance depends on legal review / Uyum hukuki görüşe bağlıdır

**EN.** The design aims to reduce conflicts with data-protection law (for example the right to
erasure), but GDPR/KVKK compliance **depends on legal review**. Salted hashes, payment-behaviour
data and any badge that can be linked to a borrower may still carry indirect-identification risk.

**TR.** Tasarım, silme hakkı gibi veri koruma kurallarıyla çelişkiyi azaltmak için yapılmıştır;
ancak KVKK/GDPR uyumu **hukuki görüşe bağlıdır**. Tuzlu hash'ler, ödeme davranışı verisi ve
borçluya bağlanabilecek rozetler dolaylı kimliklendirme riski taşıyabilir.

## 2. Personal data is not written on-chain / Kişisel veri zincire yazılmaz

**EN.** The program never receives names, physical addresses, listing URLs, VIN/plate numbers or
deed numbers. Only salted hashes, a value band (house: 50k steps, vehicle: 5k steps) and a
city-level region code are stored for the asset. Identity checks happen off-chain at the title
agent.

**What *is* public in this version** (so this is not overstated): wallet addresses of the borrower
and the seller, the loan price, principal, instalment and appraised value, payment state, and
pool counters. Wallet addresses are pseudonymous, not anonymous.

**TR.** Program; isim, açık adres, ilan URL'si, şasi/plaka numarası ya da tapu numarası almaz.
Varlık için yalnızca tuzlu hash, değer bandı (ev 50k, araç 5k) ve şehir düzeyi bölge kodu tutulur.
Kimlik doğrulaması zincir dışında tescil ajanında yapılır. Bu sürümde **herkese açık olanlar**:
borçlu ve satıcı cüzdan adresleri, kredi fiyatı, anapara, taksit, ekspertiz değeri, ödeme durumu
ve havuz sayaçları. Cüzdan adresi takma addır, anonim değildir.

## 3. Rates are not a legal APR / Oranlar yasal APR değildir

**EN.** Reference house loan: 100,000 USD price, 30% down, 70,000 USD principal, 7% fixed,
240 months, 1% origination fee paid up front. Nominal annual cost including the fee is about
7.13%; the effective annual cost is about 7.37%. **These are illustrative figures and not a
legally defined APR** in any jurisdiction.

**TR.** Örnek ev kredisi: 100.000 USD fiyat, %30 peşinat, 70.000 USD anapara, %7 sabit, 240 ay,
peşin %1 açılış ücreti. Ücret dahil nominal yıllık maliyet yaklaşık %7,13, efektif yaklaşık %7,37.
**Bunlar açıklayıcı rakamlardır; hiçbir ülkede yasal olarak tanımlı APR değildir.**

## 4. Countries and licensing / Ülkeler ve lisans

**EN.** Our first target is dollarized economies; each country will be verified with a local
licensed partner. We have **not** signed a licensed lender or SPV partner. Cross-border lending to
foreign-income borrowers, foreign capital rules, KYC/AML, vehicle-lien registers and insurance
differ by country and may each need a licence or local counsel. The licensed layer is a next step,
not something we claim to have solved. GlassHouse is infrastructure, not a bank; on-chain state
records and caps lending, while collection and enforcement are a legal process run by a licensed
partner.

**TR.** İlk hedefimiz dolarize ekonomilerdir; her ülke için yerel lisanslı ortakla doğrulanacaktır.
İmzalanmış bir lisanslı kuruluş ya da SPV ortağımız **yoktur**. Yabancı gelirli kişiye sınır ötesi
kredi, yabancı sermaye, KYC/AML, araç rehin sicili ve sigorta ülkeye göre farklıdır; her biri ayrı
lisans ya da yerel hukuk danışmanlığı gerektirebilir. Zincirdeki `Defaulted` yalnızca bir durum
kaydıdır; ihtar ve icra hukuki süreçtir ve lisanslı ortak tarafından yürütülür.

## 5. Türkiye

**TR.** Türkiye borçlu pazarı değildir: 32 sayılı Karar'ın 17/f maddesi uyarınca Türkiye'de
yerleşik gerçek kişilerin döviz ya da dövize endeksli kredi kullanması kısıtlıdır. Bu proje
Türkiye'de bireylere kredi sunmak için tasarlanmamıştır. (Madde numaraları ve kapsam teslimden
önce hukuki olarak yeniden doğrulanmalıdır.)

## 6. Pool shares / Havuz payları

**EN.** Pool share tokens would likely be treated as securities in many jurisdictions. The program
contains a disabled allowlist hook (`ALLOWLIST_ENABLED = false`); a production version would
restrict shares to KYC-verified investors (for example with a Token-2022 transfer hook). This
hackathon build does **not** enforce KYC on deposits. Do not use it with real funds.

**TR.** Pay tokenları birçok ülkede menkul kıymet sayılabilir. Programda kapalı bir allowlist
kancası vardır; gerçek üründe pay yalnızca KYC'den geçmiş yatırımcılara açılır. Bu hackathon
sürümü mevduatta KYC **uygulamaz**. Gerçek parayla kullanmayın.

## 7. No warranty / Garanti yok

Released under the MIT License, provided "as is". The code has been tested but has **not** been
independently audited. / MIT Lisansı ile "olduğu gibi" sunulur. Test edilmiştir ancak bağımsız
bir güvenlik denetiminden **geçmemiştir**.
