//! accounts: [0]=target program, [1..]=accounts handed to the CPI (the vault PDA may appear more than once).
//! data: n u8 | n flag bytes (bit0 signer, bit1 writable) | instruction data for the target.
//! The vault PDA (seeds ["mock-vault"]) is marked signer in the CPI wherever it appears, like a Squads vault.
use solana_program::{account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, instruction::{AccountMeta, Instruction}, program::invoke_signed, program_error::ProgramError, pubkey::Pubkey};
entrypoint!(process);
fn process(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let (target, rest) = accounts.split_first().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let n = *data.first().ok_or(ProgramError::InvalidInstructionData)? as usize;
    if data.len() < 1 + n || rest.len() < n { return Err(ProgramError::InvalidInstructionData); }
    let (flags, payload) = data[1..].split_at(n);
    let (vault, bump) = Pubkey::find_program_address(&[b"mock-vault"], program_id);
    let metas: Vec<AccountMeta> = rest.iter().take(n).zip(flags).map(|(a, f)| AccountMeta { pubkey: *a.key, is_signer: f & 1 == 1 || *a.key == vault, is_writable: f & 2 == 2 }).collect();
    // The full slice, not `rest`: the CPI needs the target program's AccountInfo too.
    invoke_signed(&Instruction { program_id: *target.key, accounts: metas, data: payload.to_vec() }, accounts, &[&[b"mock-vault", &[bump]]])
}
