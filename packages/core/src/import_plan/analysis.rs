use super::MarkdownHtmlDetection;
use crate::import_plan::fence::update_fence_state;
use std::collections::HashMap;

pub(crate) fn parse_atx_heading(line: &str) -> Option<(u32, String)> {
  let trimmed = line.trim();
  if !trimmed.starts_with('#') {
    return None;
  }

  let hashes = trimmed.chars().take_while(|&c| c == '#').count();
  if hashes == 0 || hashes > 6 {
    return None;
  }

  let after_hashes = trimmed[hashes..].trim_start();
  if after_hashes.is_empty() {
    return None;
  }

  let text = after_hashes
    .trim_end()
    .trim_end_matches('#')
    .trim_end()
    .to_string();

  Some((hashes as u32, text))
}

pub(crate) fn parse_setext_heading_underline(line: &str) -> Option<u32> {
  let trimmed = line.trim();
  if trimmed.is_empty() {
    return None;
  }
  if trimmed.chars().all(|c| c == '=') {
    return Some(1);
  }
  if trimmed.chars().all(|c| c == '-') {
    return Some(2);
  }
  None
}

pub(crate) fn detect_html_in_markdown(markdown: &str) -> MarkdownHtmlDetection {
  let lines: Vec<&str> = markdown.split('\n').collect();
  let mut in_fence = None;

  let mut html_tag_count: u32 = 0;
  let mut tags: HashMap<String, u32> = HashMap::new();
  let mut has_likely_html_blocks = false;

  for line in lines {
    update_fence_state(&mut in_fence, line);
    if in_fence.is_some() {
      continue;
    }

    let trimmed = line.trim();
    if trimmed.starts_with('<') && trimmed.ends_with('>') && trimmed.len() >= 3 {
      has_likely_html_blocks = true;
    }

    for tag in extract_html_tag_names(trimmed) {
      html_tag_count += 1;
      *tags.entry(tag).or_insert(0) += 1;
    }
  }

  MarkdownHtmlDetection {
    html_tag_count,
    tags,
    has_likely_html_blocks,
  }
}

fn extract_html_tag_names(input: &str) -> Vec<String> {
  let mut names = Vec::new();
  let chars: Vec<char> = input.chars().collect();
  let mut i = 0usize;

  while i < chars.len() {
    if chars[i] != '<' {
      i += 1;
      continue;
    }

    i += 1;
    while i < chars.len() && chars[i].is_whitespace() {
      i += 1;
    }
    if i < chars.len() && chars[i] == '/' {
      i += 1;
      while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
      }
    }

    if i >= chars.len() || !chars[i].is_ascii_alphabetic() {
      continue;
    }

    let start = i;
    i += 1;
    while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '-') {
      i += 1;
    }

    let name: String = chars[start..i].iter().collect();
    if !name.is_empty() {
      names.push(name.to_lowercase());
    }
  }

  names
}
