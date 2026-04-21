# Overnight swarm cleanup

## Must do before cargo build
1. Fix src/main.rs: move `mod wasm;` out of `#[cfg(target_arch="wasm32")]`
   OR add `extern crate alloc;` at crate root
2. In all src/wasm/*.rs files, replace:
   `use alloc::vec::Vec;` -> delete line (Vec is in prelude)
   `use alloc::string::String;` -> delete line (String is in prelude)
3. Add to Cargo.toml [dependencies] if missing:
   blake2 = "0.10"
   sha2 = "0.10"
   hex = "0.4"
4. Run: cargo check -p htp-rust-backend

## Validate
- cargo check passes
- ls htp-rust-backend/src/wasm/ shows 9 .rs files
- git log on main shows all AGENT X DONE commits
