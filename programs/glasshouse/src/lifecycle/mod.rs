//! lifecycle — SAHİBİ: Kişi 2.
//! Yaşam döngüsü, karşılık kademeleri ve zarar sırası için Kişi 2'nin ortak olmayan modülü.
//! Hata kodları ortak `errors.rs`'tedir (`GlassError` 6015–6022, Kişi 1 ekledi).
//! Seed'ler ortak `constants.rs`'ten; yalnızca `share_escrow` seed'i burada (`state::seeds`).

pub mod events;
pub mod provision;
pub mod schedule;
pub mod state;
pub mod waterfall;
