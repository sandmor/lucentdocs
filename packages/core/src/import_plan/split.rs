use crate::import_plan::analysis::{parse_atx_heading, parse_setext_heading_underline};
use crate::import_plan::fence::{is_fence_line, update_fence_state};

pub(crate) fn utf16_len(value: &str) -> usize {
  value.encode_utf16().count()
}

fn split_string_by_utf16_units(value: &str, max_units: usize) -> Vec<String> {
  if value.is_empty() {
    return vec![];
  }
  if max_units == 0 {
    return vec![value.to_string()];
  }

  let mut chunks: Vec<String> = Vec::new();
  let mut start_byte = 0usize;
  let mut units = 0usize;

  for (byte_index, ch) in value.char_indices() {
    let ch_units = if (ch as u32) > 0xFFFF { 2 } else { 1 };
    if units > 0 && units + ch_units > max_units {
      let chunk = value[start_byte..byte_index].trim().to_string();
      if !chunk.is_empty() {
        chunks.push(chunk);
      }
      start_byte = byte_index;
      units = 0;
    }
    units += ch_units;

    if units > max_units && start_byte == byte_index {
      // A single code point doesn't fit in the limit; still emit it as its own chunk.
      let next = byte_index + ch.len_utf8();
      let chunk = value[byte_index..next].trim().to_string();
      if !chunk.is_empty() {
        chunks.push(chunk);
      }
      start_byte = next;
      units = 0;
    }
  }

  if start_byte < value.len() {
    let chunk = value[start_byte..].trim().to_string();
    if !chunk.is_empty() {
      chunks.push(chunk);
    }
  }

  chunks
}

pub(crate) fn split_by_heading(markdown: &str, level: u32) -> Vec<String> {
  let lines: Vec<&str> = markdown.split('\n').collect();
  let mut in_fence = None;
  let mut boundaries: Vec<usize> = vec![0];

  let mut i = 0usize;
  while i < lines.len() {
    let line = lines[i];
    update_fence_state(&mut in_fence, line);
    if in_fence.is_some() {
      i += 1;
      continue;
    }

    if let Some((lvl, _)) = parse_atx_heading(line) {
      if lvl == level && i != 0 {
        boundaries.push(i);
      }
      i += 1;
      continue;
    }

    if i + 1 < lines.len() {
      let next = lines[i + 1];
      if let Some(setext_level) = parse_setext_heading_underline(next) {
        if setext_level == level && !line.trim().is_empty() && i != 0 {
          boundaries.push(i);
        }
        i += 2;
        continue;
      }
    }

    i += 1;
  }

  boundaries.push(lines.len());

  let mut parts: Vec<String> = Vec::new();
  for w in 0..boundaries.len().saturating_sub(1) {
    let start = boundaries[w];
    let end = boundaries[w + 1];
    let part = lines[start..end].join("\n").trim().to_string();
    if !part.is_empty() {
      parts.push(part);
    }
  }

  parts
}

pub(crate) fn split_by_size(markdown: &str, target_chars: u32, max_chars: u32) -> Vec<String> {
  let lines: Vec<&str> = markdown.split('\n').collect();
  let mut in_fence = None;

  let mut parts: Vec<String> = Vec::new();
  let mut start: usize = 0;
  let mut last_break: Option<usize> = None;
  let mut acc_chars: usize = 0;

  let target = target_chars as usize;
  let hard_max = max_chars as usize;

  let mut i = 0usize;
  while i < lines.len() {
    let line = lines[i];

    if is_fence_line(line).is_some() {
      update_fence_state(&mut in_fence, line);
    }

    acc_chars += utf16_len(line) + 1;
    if in_fence.is_none() && line.trim().is_empty() {
      last_break = Some(i + 1);
    }

    let over_target = acc_chars >= target;
    let over_max = acc_chars >= hard_max;

    if over_max {
      if let Some(lb) = last_break {
        if lb > start {
          let chunk = lines[start..lb].join("\n").trim().to_string();
          if !chunk.is_empty() {
            parts.push(chunk);
          }
          start = lb;
          last_break = None;
          acc_chars = 0;
          i = start;
          continue;
        }
      }

      if i > start {
        let chunk = lines[start..i].join("\n").trim().to_string();
        if !chunk.is_empty() {
          parts.push(chunk);
        }
        start = i;
        last_break = None;
        acc_chars = 0;
        i = start;
        continue;
      }

      let oversized_line = line;
      if oversized_line.is_empty() {
        let end_exclusive = i + 1;
        let chunk = lines[start..end_exclusive].join("\n").trim().to_string();
        if !chunk.is_empty() {
          parts.push(chunk);
        }
        start = end_exclusive;
        last_break = None;
        acc_chars = 0;
        i = start;
        continue;
      }

      for chunk in split_string_by_utf16_units(oversized_line, hard_max) {
        if !chunk.is_empty() {
          parts.push(chunk);
        }
      }

      start = i + 1;
      last_break = None;
      acc_chars = 0;
      i += 1;
      continue;
    }

    if over_target {
      if let Some(lb) = last_break {
        if lb > start {
          let chunk = lines[start..lb].join("\n").trim().to_string();
          if !chunk.is_empty() {
            parts.push(chunk);
          }
          start = lb;
          last_break = None;
          acc_chars = 0;
          i = start;
          continue;
        }
      }
    }

    i += 1;
  }

  if start < lines.len() {
    let chunk = lines[start..].join("\n").trim().to_string();
    if !chunk.is_empty() {
      parts.push(chunk);
    }
  }

  parts
}
