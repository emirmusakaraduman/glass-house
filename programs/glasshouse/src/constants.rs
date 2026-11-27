//! Sabitler. Birimler: tutar = micro-USDC (u64), oran = bps, zaman = saniye (i64).

// ---- PDA seed'leri (docs/STATE.md ile aynı) ----
pub const POOL_SEED: &[u8] = b"pool";
pub const VAULT_SEED: &[u8] = b"vault";
pub const FIRST_LOSS_SEED: &[u8] = b"first_loss";
pub const RESERVE_SEED: &[u8] = b"reserve";
pub const SHARES_SEED: &[u8] = b"shares";
pub const WITHDRAW_REQUEST_SEED: &[u8] = b"wreq";
pub const LOAN_SEED: &[u8] = b"loan";
pub const ESCROW_SEED: &[u8] = b"escrow";
pub const COLLATERAL_SEED: &[u8] = b"collateral";

// ---- Sabit nokta ----
/// 1e18 ölçeği.
pub const SCALE: u128 = 1_000_000_000_000_000_000;
pub const BPS_DENOM: u64 = 10_000;
pub const MONTHS_PER_YEAR: u128 = 12;

// ---- Ürün kuralları ----
/// Açılış ücreti: kredi tutarının %1'i, borçlu peşin öder.
pub const ORIGINATION_FEE_BPS: u64 = 100;
/// Teminat: kaç taksit (CollateralEscrow).
pub const COLLATERAL_INSTALLMENTS: u64 = 3;
/// Faiz bölüşümü: platform ve yedek fon payı, yıllık oran cinsinden mutlak bps
/// (ev: %7 faizin %0,5'i, araç: %9 faizin %0,5'i). Faizin kendisindeki pay
/// `interest × 50 / rate_bps` olur; kalan havuza gider.
pub const PLATFORM_INTEREST_BPS: u64 = 50;
pub const RESERVE_INTEREST_BPS: u64 = 50;

/// Karar 1: yedek fon freni eşiği %0,25.
pub const DEFAULT_BRAKE_RESERVE_BPS: u16 = 25;

// ---- Değer bandı (zincire tam değer yerine bant yazılır) ----
pub const VALUE_BAND_HOUSE: u64 = 50_000 * 1_000_000;
pub const VALUE_BAND_VEHICLE: u64 = 5_000 * 1_000_000;

// ---- Pay hesabı: sanal ofset (ilk yatırımcı / bağış saldırısına karşı) ----
pub const VIRTUAL_SHARES: u128 = 1_000_000;
pub const VIRTUAL_ASSETS: u128 = 1_000_000;

// ---- create_pool sınırları (karar 2: güvenlik aralığı, ürün değeri değil) ----
pub const MAX_LTV_BPS_LIMIT: u16 = 9_700;
pub const MIN_RATE_BPS: u16 = 1;
pub const MAX_RATE_BPS: u16 = 2_000;
pub const MIN_TERM_MONTHS: u16 = 1;
pub const MAX_TERM_MONTHS: u16 = 360;
pub const MAX_BPS: u16 = 10_000;
pub const MAX_BUFFER_BPS: u16 = 5_000;
pub const MAX_ENTRY_EXIT_FEE_BPS: u16 = 100;

/// Yatırımcı allowlist'i (stretch). Kapalı; açmak için deposit.rs'de doğrulama eklenir.
pub const ALLOWLIST_ENABLED: bool = false;

/// Pool/Loan sonunda Kişi 2 için ayrılan boş alan.
pub const RESERVED_BYTES: usize = 64;
