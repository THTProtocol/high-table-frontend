use anyhow::Result;
use blake2::{Blake2b, Digest as Blake2Digest};
use blake2::digest::consts::U32;
use hmac::{Hmac, Mac};
use secp256k1::{Secp256k1, SecretKey, PublicKey};
use sha2::{Sha512, Digest};
use crate::types::*;

/// Kaspa address prefix for testnet-12
const TN12_PREFIX: &str = "kaspatest";
/// Kaspa address prefix for mainnet
const MAINNET_PREFIX: &str = "kaspa";

/// BIP44 derivation path for Kaspa: m/44'/111111'/0'/0/0
/// We apply HMAC-SHA512 child derivation for each level.
const BIP44_INDICES: &[(u32, bool)] = &[
    (44,     true),   // purpose  (hardened)
    (111111, true),   // coin_type Kaspa (hardened)
    (0,      true),   // account 0 (hardened)
    (0,      false),  // change = external
    (0,      false),  // address_index 0
];

type HmacSha512 = Hmac<Sha512>;

/// Derive a child key from a parent key + chain code using BIP32 HMAC-SHA512.
fn derive_child(
    parent_key: &[u8; 32],
    chain_code: &[u8; 32],
    index: u32,
    hardened: bool,
) -> Result<([u8; 32], [u8; 32])> {
    let secp = Secp256k1::new();
    let mut mac = HmacSha512::new_from_slice(chain_code)
        .map_err(|e| anyhow::anyhow!("HMAC init failed: {}", e))?;
    if hardened {
        let idx = index | 0x80000000;
        mac.update(&[0x00]);
        mac.update(parent_key);
        mac.update(&idx.to_be_bytes());
    } else {
        let parent_sk = SecretKey::from_slice(parent_key)
            .map_err(|e| anyhow::anyhow!("Invalid parent key: {}", e))?;
        let parent_pk = PublicKey::from_secret_key(&secp, &parent_sk);
        mac.update(&parent_pk.serialize());
        mac.update(&index.to_be_bytes());
    }
    let result = mac.finalize().into_bytes();
    let il = &result[..32];
    let ir = &result[32..];

    // child_key = parse256(IL) + parent_key  (mod n)
    let mut child_sk = SecretKey::from_slice(il)
        .map_err(|e| anyhow::anyhow!("Derived IL invalid: {}", e))?;
    let parent_sk = SecretKey::from_slice(parent_key)
        .map_err(|e| anyhow::anyhow!("Parent key invalid: {}", e))?;
    child_sk = child_sk.add_tweak(&parent_sk.into())
        .map_err(|e| anyhow::anyhow!("Key addition failed: {}", e))?;

    let mut child_key = [0u8; 32];
    let mut child_cc  = [0u8; 32];
    child_key.copy_from_slice(&child_sk.secret_bytes());
    child_cc.copy_from_slice(ir);
    Ok((child_key, child_cc))
}

/// Derive a Kaspa address from a BIP39 mnemonic.
///
/// Uses proper BIP32 HD key derivation with secp256k1 for path m/44'/111111'/0'/0/0.
/// Returns the address (BLAKE2b-256 hashed public key) and hex-encoded public key.
pub fn derive_from_mnemonic(req: &MnemonicRequest) -> Result<WalletResponse> {
    let network = req.network.as_deref().unwrap_or("testnet-12");
    let prefix = if network.contains("main") { MAINNET_PREFIX } else { TN12_PREFIX };

    // Validate mnemonic word count
    let words: Vec<&str> = req.mnemonic.split_whitespace().collect();
    if words.len() != 12 && words.len() != 24 {
        anyhow::bail!("Mnemonic must be 12 or 24 words, got {}", words.len());
    }

    // Parse and validate BIP39 mnemonic
    let mnemonic = bip39::Mnemonic::parse_normalized(&req.mnemonic)
        .map_err(|e| anyhow::anyhow!("Invalid BIP39 mnemonic: {}", e))?;

    // BIP39 seed (64 bytes) from mnemonic, no passphrase
    let seed = mnemonic.to_seed("");

    // BIP32 master key: HMAC-SHA512("Bitcoin seed", seed)
    let mut mac = HmacSha512::new_from_slice(b"Bitcoin seed")
        .map_err(|e| anyhow::anyhow!("HMAC init: {}", e))?;
    mac.update(&seed);
    let master = mac.finalize().into_bytes();

    let mut key = [0u8; 32];
    let mut cc  = [0u8; 32];
    key.copy_from_slice(&master[..32]);
    cc.copy_from_slice(&master[32..]);

    // Derive through BIP44 path: m/44'/111111'/0'/0/0
    for &(index, hardened) in BIP44_INDICES {
        let (child_key, child_cc) = derive_child(&key, &cc, index, hardened)?;
        key = child_key;
        cc  = child_cc;
    }

    // Derive secp256k1 public key (compressed, 33 bytes)
    let secp = Secp256k1::new();
    let secret_key = SecretKey::from_slice(&key)
        .map_err(|e| anyhow::anyhow!("Derived key invalid: {}", e))?;
    let public_key = PublicKey::from_secret_key(&secp, &secret_key);
    let pubkey_bytes = public_key.serialize(); // 33 bytes compressed
    let pubkey_hex = hex::encode(&pubkey_bytes);

    // Kaspa P2PK address: BLAKE2b-256 of the compressed public key → hex-encoded
    // Address format: {prefix}:q{bech32(pubkey_hash)}
    // Simplified: use hex-encoded BLAKE2b hash as address payload
    let mut hasher = <Blake2b<U32>>::new();
    hasher.update(&pubkey_bytes);
    let pubkey_hash = hasher.finalize();
    let addr_payload = hex::encode(&pubkey_hash);
    let address = format!("{}:qz{}", prefix, &addr_payload[..40]);

    Ok(WalletResponse {
        address,
        public_key: pubkey_hex,
    })
}

/// Fetch the balance for a Kaspa address via the REST API.
pub async fn fetch_balance(address: &str, api_base: &str) -> Result<BalanceResponse> {
    let client = reqwest::Client::new();

    // Fetch balance
    let balance_url = format!("{}/addresses/{}/balance", api_base, address);
    let balance_resp = client.get(&balance_url)
        .send()
        .await?
        .json::<KaspaBalanceResponse>()
        .await?;
    let balance = balance_resp.balance.unwrap_or(0);
    let balance_kas = format!("{:.8}", balance as f64 / 100_000_000.0);

    // Fetch UTXO count from /addresses/{addr}/utxos
    let utxo_url = format!("{}/addresses/{}/utxos", api_base, address);
    let utxo_count = match client.get(&utxo_url).send().await {
        Ok(resp) => {
            resp.json::<Vec<serde_json::Value>>().await
                .map(|v| v.len() as u64)
                .unwrap_or(0)
        }
        Err(_) => 0,
    };

    Ok(BalanceResponse {
        balance,
        balance_kas,
        utxo_count,
    })
}
