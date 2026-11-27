use anchor_lang::prelude::*;

#[error_code]
pub enum GlassError {
    #[msg("Caller is not authorized for this action")]
    Unauthorized,
    #[msg("Loan or pool is not in the required status")]
    InvalidStatus,
    #[msg("Seller must differ from borrower")]
    SellerIsBorrower,
    #[msg("Down payment is below the minimum required by max LTV")]
    InsufficientDownPayment,
    #[msg("Principal exceeds max LTV on min(price, appraised value)")]
    AppraisalTooLow,
    #[msg("Funding would breach the liquidity buffer")]
    LiquidityBufferBreached,
    #[msg("Late/default ratio is above the brake threshold")]
    BrakeLateRatio,
    #[msg("Reserve is below the brake threshold")]
    BrakeReserve,
    #[msg("First-loss vault is below the required minimum")]
    InsufficientFirstLoss,
    #[msg("Pool parameter is out of the allowed bounds")]
    ParamOutOfBounds,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Title confirmation deadline has passed")]
    TitleDeadlinePassed,
    #[msg("Title confirmation deadline has not been reached yet")]
    TitleDeadlineNotReached,
    #[msg("Accounting invariant violated")]
    InvariantViolation,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    // ---- Kişi 2 (Backend B) yaşam döngüsü hataları: 6015 ve sonrası ----
    // Mevcut varyantların numaraları değişmesin diye hep sona eklenir; sıra değiştirilmez.
    #[msg("Loan is not in a status that allows this action")]
    LoanNotServiceable,
    #[msg("This period has already been processed for the loan")]
    PeriodAlreadyProcessed,
    #[msg("Recovery proceeds are below the required floor")]
    RecoveryBelowFloor,
    #[msg("Withdraw queue is empty")]
    WithdrawQueueEmpty,
    #[msg("Withdraw request is invalid or out of order")]
    InvalidWithdrawRequest,
    #[msg("Not enough idle cash for this action")]
    InsufficientIdleCash,
    #[msg("Payment amount is invalid")]
    InvalidPaymentAmount,
    #[msg("Co-signer is missing or invalid")]
    InvalidCoSigner,
}
