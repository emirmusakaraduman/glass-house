//! 256 bit tamsayı. Ayrı modülde: `anchor_lang::prelude::Result` makro içindeki
//! std `Result`'ı gölgelemesin.

use uint::construct_uint;

construct_uint! {
    pub struct U256(4);
}
