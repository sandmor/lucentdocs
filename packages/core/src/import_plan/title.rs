use crate::import_plan::analysis::{parse_atx_heading, parse_setext_heading_underline};
use crate::import_plan::fence::update_fence_state;
use crate::import_plan::text::strip_inline_markdown_noise;

pub(crate) fn suggested_title_from_part(markdown: &str) -> Option<String> {
  let lines: Vec<&str> = markdown.split('\n').collect();
  if lines.is_empty() {
    return None;
  }

  let mut i = 0usize;

  if lines[0].trim() == "---" {
    i = 1;
    while i < lines.len() {
      if lines[i].trim() == "---" {
        i += 1;
        break;
      }
      i += 1;
    }
  }

  let mut in_fence = None;
  while i < lines.len() {
    let line = lines[i];
    update_fence_state(&mut in_fence, line);
    if in_fence.is_some() {
      i += 1;
      continue;
    }

    let trimmed = line.trim();
    if trimmed.is_empty() {
      i += 1;
      continue;
    }

    if let Some((_level, text)) = parse_atx_heading(trimmed) {
      let stripped = strip_inline_markdown_noise(&text);
      if !stripped.is_empty() {
        return Some(stripped);
      }
      break;
    }

    if i + 1 < lines.len() && parse_setext_heading_underline(lines[i + 1]).is_some() {
      let stripped = strip_inline_markdown_noise(trimmed);
      if !stripped.is_empty() {
        return Some(stripped);
      }
    }

    break;
  }

  None
}
