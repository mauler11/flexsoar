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
/// Seller-signed listing message (solo-operator design section 5, as amended by P1). 61 bytes:
/// `"FSOARV2-LIST\0" || binding || min_total u64le || list_expires_at i64le`, where
/// `binding = SHA-256(domain || program || card || sale_id || generation u64le)`.
/// The seller's wallet (card.owner) signs these exact bytes off chain; `open_sale` requires the Ed25519
/// precompile instruction immediately before it. Builder twin: lib/solana/listing-v2.ts.
///
/// WHY A BINDING HASH AND NOT THE FIELDS: the design listed the five fields inline (165 bytes). Measured, that makes the
/// `open_sale` transaction 1,276 bytes against the 1,232-byte packet limit (1,236 even with no compute-budget instruction),
/// so it cannot be sent at all. The hash form binds exactly the same five fields and is 1,172 bytes (60 spare).
pub const LISTING_TAG: [u8; 13] = *b"FSOARV2-LIST\0";
pub const LISTING_LEN: usize = 61;
const LISTING_MIN_OFFSET: usize = 13 + 32;
pub fn listing_binding(domain: &[u8; 32], program: &Pubkey, card: &[u8; 32], sale_id: &[u8; 32], generation: u64) -> [u8; 32] {
    anchor_lang::solana_program::hash::hashv(&[domain, program.as_ref(), card, sale_id, &generation.to_le_bytes()]).to_bytes()
}
pub fn listing_message(domain: &[u8; 32], program: &Pubkey, card: &[u8; 32], sale_id: &[u8; 32], generation: u64, min_total: u64, list_expires_at: i64) -> [u8; LISTING_LEN] {
    let mut m = [0u8; LISTING_LEN];
    m[..13].copy_from_slice(&LISTING_TAG);
    m[13..45].copy_from_slice(&listing_binding(domain, program, card, sale_id, generation));
    m[LISTING_MIN_OFFSET..LISTING_MIN_OFFSET + 8].copy_from_slice(&min_total.to_le_bytes());
    m[LISTING_MIN_OFFSET + 8..].copy_from_slice(&list_expires_at.to_le_bytes());
    m
}
/// The only two seller-chosen numbers in a listing message; everything else is re-derived and compared whole.
pub fn listing_floor_and_expiry(msg: &[u8]) -> Option<(u64, i64)> {
    if msg.len() != LISTING_LEN { return None; }
    Some((u64::from_le_bytes(msg[LISTING_MIN_OFFSET..LISTING_MIN_OFFSET + 8].try_into().ok()?),
          i64::from_le_bytes(msg[LISTING_MIN_OFFSET + 8..].try_into().ok()?)))
}
/// Extracts (public key, message) from a single-signature Ed25519 precompile instruction.
/// The runtime verifies the signature against bytes addressed by the three `*_instruction_index` fields.
/// We read the same offsets out of THIS instruction's data, so every index must be u16::MAX (self);
/// otherwise the runtime would have verified some other instruction's bytes than the ones compared here.
pub fn ed25519_signer_and_message(data: &[u8]) -> Option<(&[u8], &[u8])> {
    if data.len() < 16 || data[0] != 1 { return None; }
    let at = |i: usize| u16::from_le_bytes([data[i], data[i + 1]]);
    if at(4) != u16::MAX || at(8) != u16::MAX || at(14) != u16::MAX { return None; }
    let (sig, pk, msg, len) = (at(2) as usize, at(6) as usize, at(10) as usize, at(12) as usize);
    if sig + 64 > data.len() || pk + 32 > data.len() || msg + len > data.len() { return None; }
    Some((&data[pk..pk + 32], &data[msg..msg + len]))
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
    fn p(n: u8) -> Pubkey { Pubkey::new_from_array([n; 32]) }
    /// Same inputs and digest as tests/solana-listing-v2.test.ts: the two builders are checked against one vector.
    #[test]
    fn listing_message_wire_vector() {
        // Independent construction: hash the five fields by hand, then lay the message out byte by byte.
        let mut preimage = Vec::new();
        for n in 1u8..=4 { preimage.extend([n; 32]); }
        preimage.extend(5u64.to_le_bytes());
        let binding = anchor_lang::solana_program::hash::hash(&preimage).to_bytes();
        assert_eq!(hex(&binding), "4f9cc37436893a4b2c837ac87fd40271bd5cce559c2a7534a853318aa259784f");
        let mut expected = b"FSOARV2-LIST\0".to_vec();
        expected.extend(binding); expected.extend(1_000_000u64.to_le_bytes()); expected.extend(1_900_000_000i64.to_le_bytes());
        let m = listing_message(&[1; 32], &p(2), &[3; 32], &[4; 32], 5, 1_000_000, 1_900_000_000);
        assert_eq!(m.len(), LISTING_LEN); assert_eq!(&m[..], &expected[..]);
        assert_eq!(hex(&anchor_lang::solana_program::hash::hash(&m).to_bytes()), "f7125fc0f364c4134469517178192ce16d44875818d6cd30e5768cdf28de9830");
        assert_eq!(listing_floor_and_expiry(&m), Some((1_000_000, 1_900_000_000)));
        assert_eq!(listing_floor_and_expiry(&m[..60]), None);
        assert_eq!(listing_floor_and_expiry(&[m.to_vec(), vec![0]].concat()), None);
        // Each of the five bound fields changes the binding; the two seller numbers do not.
        let base = listing_binding(&[1; 32], &p(2), &[3; 32], &[4; 32], 5);
        assert_ne!(base, listing_binding(&[9; 32], &p(2), &[3; 32], &[4; 32], 5));
        assert_ne!(base, listing_binding(&[1; 32], &p(9), &[3; 32], &[4; 32], 5));
        assert_ne!(base, listing_binding(&[1; 32], &p(2), &[9; 32], &[4; 32], 5));
        assert_ne!(base, listing_binding(&[1; 32], &p(2), &[3; 32], &[9; 32], 5));
        assert_ne!(base, listing_binding(&[1; 32], &p(2), &[3; 32], &[4; 32], 6));
        assert_eq!(&listing_message(&[1; 32], &p(2), &[3; 32], &[4; 32], 5, 7, 8)[13..45], &base[..]);
    }
    fn hex(b: &[u8]) -> String { b.iter().map(|x| format!("{x:02x}")).collect() }
    /// Layout the runtime builds for one self-contained signature: header, 14-byte offsets, pk, sig, message.
    fn ed_ix(pk: &[u8; 32], msg: &[u8], idx: [u16; 3]) -> Vec<u8> {
        let (pk_off, sig_off, msg_off) = (16u16, 48u16, 112u16);
        let mut d = vec![1u8, 0];
        for v in [sig_off, idx[0], pk_off, idx[1], msg_off, msg.len() as u16, idx[2]] { d.extend(v.to_le_bytes()); }
        d.extend(pk); d.extend([9u8; 64]); d.extend(msg); d
    }
    #[test]
    fn ed25519_instruction_parsing_binds_the_bytes_the_runtime_verified() {
        let (pk, msg) = ([7u8; 32], b"hello listing".to_vec());
        let ok = ed_ix(&pk, &msg, [u16::MAX; 3]);
        assert_eq!(ed25519_signer_and_message(&ok), Some((&pk[..], &msg[..])));
        // Any index other than "this instruction" means the runtime verified a DIFFERENT instruction's bytes.
        for which in 0..3 { let mut idx = [u16::MAX; 3]; idx[which] = 0; assert_eq!(ed25519_signer_and_message(&ed_ix(&pk, &msg, idx)), None, "index field {which}"); }
        let mut two = ok.clone(); two[0] = 2; assert_eq!(ed25519_signer_and_message(&two), None);
        let mut zero = ok.clone(); zero[0] = 0; assert_eq!(ed25519_signer_and_message(&zero), None);
        assert_eq!(ed25519_signer_and_message(&ok[..15]), None);
        assert_eq!(ed25519_signer_and_message(&ok[..ok.len() - 1]), None, "message running past the data");
        assert_eq!(ed25519_signer_and_message(&ok[..100]), None, "signature/public key region cut short");
        let mut far = ok.clone(); far[6..8].copy_from_slice(&u16::MAX.to_le_bytes()); assert_eq!(ed25519_signer_and_message(&far), None, "public key offset out of range");
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
