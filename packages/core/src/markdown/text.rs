pub(crate) fn normalize_newlines(input: &str) -> String {
  input.replace("\r\n", "\n").replace('\r', "\n")
}

/// Strip inline markdown formatting from text for title extraction.
pub(crate) fn strip_inline_markdown_noise(text: &str) -> String {
  let mut result = String::with_capacity(text.len());
  let chars: Vec<char> = text.chars().collect();
  let len = chars.len();
  let mut i = 0;

  while i < len {
    match chars[i] {
      '`' => {
        let tick_count = chars[i..].iter().take_while(|&&c| c == '`').count();
        let start = i + tick_count;
        if let Some(end) = find_backtick_close(&chars, start, tick_count) {
          for &c in &chars[start..end] {
            result.push(c);
          }
          i = end + tick_count;
        } else {
          result.push(chars[i]);
          i += 1;
        }
      }
      '*' | '_' => {
        let mark = chars[i];
        let mark_count = chars[i..].iter().take_while(|&&c| c == mark).count();
        let start = i + mark_count;
        if let Some(end) = find_marker_close(&chars, start, mark, mark_count) {
          for &c in &chars[start..end] {
            result.push(c);
          }
          i = end + mark_count;
        } else {
          for _ in 0..mark_count {
            result.push(mark);
          }
          i += mark_count;
        }
      }
      c => {
        result.push(c);
        i += 1;
      }
    }
  }

  result.trim().to_string()
}

fn find_backtick_close(chars: &[char], start: usize, count: usize) -> Option<usize> {
  let mut i = start;
  while i + count <= chars.len() {
    if chars[i..i + count].iter().all(|&c| c == '`')
      && (i + count >= chars.len() || chars[i + count] != '`')
    {
      return Some(i);
    }
    i += 1;
  }
  None
}

fn find_marker_close(chars: &[char], start: usize, mark: char, count: usize) -> Option<usize> {
  let mut i = start;
  while i + count <= chars.len() {
    if chars[i..i + count].iter().all(|&c| c == mark)
      && (i + count >= chars.len() || chars[i + count] != mark)
      && (i == 0 || chars[i - 1] != mark)
    {
      return Some(i);
    }
    i += 1;
  }
  None
}

/// Find the shortest backtick fence that doesn't collide with content.
pub(crate) fn choose_backtick_fence(content: &str, min_length: usize) -> String {
  let mut max_run = 0;
  let mut current_run = 0;
  for c in content.chars() {
    if c == '`' {
      current_run += 1;
      if current_run > max_run {
        max_run = current_run;
      }
    } else {
      current_run = 0;
    }
  }
  "`".repeat(std::cmp::max(min_length, max_run + 1))
}

pub(crate) fn escape_markdown_label(text: &str) -> String {
  let mut out = String::with_capacity(text.len());
  for c in text.chars() {
    if c == '[' || c == ']' || c == '\\' {
      out.push('\\');
    }
    out.push(c);
  }
  out
}

pub(crate) fn escape_markdown_link_destination(url: &str) -> String {
  let trimmed = url.trim();
  let mut out = String::with_capacity(trimmed.len());
  let mut last_was_ws = false;
  for c in trimmed.chars() {
    if c.is_whitespace() {
      if !last_was_ws {
        out.push_str("%20");
      }
      last_was_ws = true;
    } else {
      last_was_ws = false;
      if c == '(' || c == ')' || c == '\\' {
        out.push('\\');
      }
      out.push(c);
    }
  }
  out
}

pub(crate) fn escape_markdown_title(title: &str) -> String {
  let mut out = String::with_capacity(title.len());
  for c in title.chars() {
    match c {
      '\r' => {}
      '\n' => {
        if !out.ends_with(' ') {
          out.push(' ');
        }
      }
      '\\' => out.push_str("\\\\"),
      '"' => out.push_str("\\\""),
      _ => out.push(c),
    }
  }
  out.trim().to_string()
}

/// Collapse runs of 3+ newlines down to 2.
pub(crate) fn collapse_triple_newlines(s: &str) -> String {
  let mut out = String::with_capacity(s.len());
  let mut newline_count = 0;
  for c in s.chars() {
    if c == '\n' {
      newline_count += 1;
      if newline_count <= 2 {
        out.push(c);
      }
    } else {
      newline_count = 0;
      out.push(c);
    }
  }
  out
}
