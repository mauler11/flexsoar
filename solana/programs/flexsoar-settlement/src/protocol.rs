use anchor_lang::prelude::*;

pub const TAG: [u8; 8] = *b"FSOARV2\0";
/// Canonical 690-byte Borsh contract. TS KEY_FIELDS/U64_FIELDS use this order.
/// Buyer AND online issuer sign the transaction containing this exact payload.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default, PartialEq, Eq, InitSpace)]
pub struct Permit {
    pub tag: [u8; 8], pub version: u8, pub mode: u8,
    pub domain: [u8; 32], pub program: Pubkey, pub config: Pubkey,
    pub sale_id: [u8; 32], pub card: [u8; 32], pub pair: [u8; 32],
    pub attempt: [u8; 32], pub beneficiary: [u8; 32], pub policy: [u8; 32],
    pub buyer: Pubkey, pub seller: Pubkey, pub treasury: Pubkey, pub mint: Pubkey,
    pub token_program: Pubkey, pub buyer_token: Pubkey, pub seller_token: Pubkey,
    pub treasury_token: Pubkey, pub refund_token: Pubkey, pub issuer: Pubkey,
    pub generation: u64, pub revision: u64, pub custody_version: u64,
    pub authority_epoch: u64, pub total: u64, pub net: u64, pub fee: u64,
    pub valid_from: i64, pub expires_at: i64,
}
impl Permit {
    pub fn valid_at(&self, now: i64) -> bool {
        self.tag == TAG && self.version == 2 && self.mode <= 1 && self.total > 0
            && self.valid_from < self.expires_at && now >= self.valid_from && now < self.expires_at
            && self.fee == ((self.total as u128 * 500) / 10000) as u64
            && self.net == self.total - self.fee
            && self.buyer != self.seller && self.buyer != self.treasury && self.seller != self.treasury
    }
    pub fn same_sale(&self, p: &Self) -> bool {
        self.domain == p.domain && self.program == p.program && self.config == p.config
            && self.sale_id == p.sale_id && self.card == p.card && self.pair == p.pair
            && self.policy == p.policy && self.mode == p.mode && self.generation == p.generation
            && self.revision == p.revision && self.custody_version == p.custody_version
            && self.seller == p.seller && self.treasury == p.treasury && self.mint == p.mint
            && self.token_program == p.token_program && self.seller_token == p.seller_token
            && self.treasury_token == p.treasury_token
    }
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct Attestation {
    pub tag: [u8; 8], pub action: u8, pub sale: [u8; 32], pub attempt: [u8; 32],
    pub pair: [u8; 32], pub evidence: [u8; 32], pub revision: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn independent_wire_vector() {
        // Independent byte construction; TS uses this same published vector.
        let mut bytes = b"FSOARV2\0".to_vec(); bytes.extend([2, 0]);
        for key in 1u8..=19 { bytes.extend([key; 32]); }
        for n in 1u64..=7 { bytes.extend(n.to_le_bytes()); }
        bytes.extend((-8i64).to_le_bytes()); bytes.extend(9i64.to_le_bytes());
        let p = Permit::try_from_slice(&bytes).unwrap();
        assert_eq!(bytes.len(), 690); assert_eq!(p.domain, [1;32]);
        assert_eq!(p.issuer, Pubkey::new_from_array([19;32]));
        assert_eq!(p.valid_from, -8); assert_eq!(p.expires_at, 9);
        assert_eq!(p.try_to_vec().unwrap(), bytes);
    }
    #[test]
    fn attestation_vector() {
        let mut bytes = TAG.to_vec(); bytes.push(4);
        for n in 1..=4 { bytes.extend([n;32]); } bytes.extend(5u64.to_le_bytes());
        let a = Attestation::try_from_slice(&bytes).unwrap();
        assert_eq!(bytes.len(), 145); assert_eq!(a.revision, 5);
        assert_eq!(a.try_to_vec().unwrap(), bytes);
    }
    #[test]
    fn quote_execution_and_immutable_sale_bindings() {
        let mut p = Permit::default(); p.tag=TAG; p.version=2; p.mode=0;
        p.total=1_000_000; p.net=950_000; p.fee=50_000; p.valid_from=100; p.expires_at=400;
        p.buyer=Pubkey::new_from_array([1;32]); p.seller=Pubkey::new_from_array([2;32]); p.treasury=Pubkey::new_from_array([3;32]);
        assert!(p.valid_at(100)); assert!(!p.valid_at(99)); assert!(!p.valid_at(400));
        let mut other=p.clone(); other.fee=1; assert!(!other.valid_at(200));
        other=p.clone(); other.mode=1; assert!(!p.same_sale(&other));
        other=p.clone(); other.custody_version+=1; assert!(!p.same_sale(&other));
        other=p.clone(); other.revision+=1; assert!(!p.same_sale(&other));
        other=p.clone(); other.generation+=1; assert!(!p.same_sale(&other));
        other=p.clone(); other.domain=[9;32]; assert!(!p.same_sale(&other));
        // Per-buyer fields differ, but consumption is shared by the SAME sale.
        other=p.clone(); other.attempt=[9;32]; assert!(p.same_sale(&other));
    }
}
