use tiktoken_rs::o200k_base_singleton;

const TOKEN_BUFFER_BPS: u64 = 1_150; // 15% buffer for encoder differences.
const TOKEN_BUFFER_SCALE: u64 = 1_000;

pub(super) fn estimate_tokens_with_buffer(text: &str) -> u64 {
  let tokenizer = o200k_base_singleton();
  let tokens = tokenizer.encode_ordinary(text).len() as u64;
  // ceil(tokens * 1.15)
  (tokens
    .saturating_mul(TOKEN_BUFFER_BPS)
    .saturating_add(TOKEN_BUFFER_SCALE - 1))
    / TOKEN_BUFFER_SCALE
}
