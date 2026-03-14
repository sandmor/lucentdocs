use napi_derive::napi;
use std::collections::HashMap;

use crate::MarkdownRawHtmlMode;

mod analysis;
mod fence;
mod frontmatter;
mod html;
mod split;
mod text;
mod title;

// ── NAPI types ──────────────────────────────────────────────────────────────

#[napi(object)]
pub struct MarkdownSplitStrategy {
  #[napi(js_name = "type")]
  pub strategy_type: String,
  pub level: Option<u32>,
}

#[napi(object)]
pub struct MarkdownImportPlanOptions {
  pub max_doc_chars: u32,
  pub target_doc_chars: Option<u32>,
  pub split: MarkdownSplitStrategy,
  pub raw_html_mode: Option<MarkdownRawHtmlMode>,
}

#[napi(object)]
pub struct MarkdownImportPlanPart {
  pub markdown: String,
  pub suggested_title: Option<String>,
  pub estimated_chars: u32,
}

#[napi(object)]
pub struct MarkdownHtmlDetection {
  pub html_tag_count: u32,
  pub tags: HashMap<String, u32>,
  pub has_likely_html_blocks: bool,
}

#[napi(object)]
pub struct MarkdownImportPlanResult {
  pub normalized_markdown: String,
  pub parts: Vec<MarkdownImportPlanPart>,
  pub html: MarkdownHtmlDetection,
}

pub(crate) fn normalize_markdown_for_import(
  markdown: &str,
  raw_html_mode: MarkdownRawHtmlMode,
) -> String {
  let normalized = text::normalize_newlines(markdown);
  html::normalize_html_in_markdown(&normalized, raw_html_mode)
}

// ── Main entry point ────────────────────────────────────────────────────────

#[napi]
pub fn plan_markdown_import(
  markdown: String,
  options: MarkdownImportPlanOptions,
) -> std::result::Result<MarkdownImportPlanResult, napi::Error> {
  let normalized = text::normalize_newlines(&markdown);
  let html = analysis::detect_html_in_markdown(&normalized);
  let raw_html_mode = options
    .raw_html_mode
    .unwrap_or(MarkdownRawHtmlMode::CodeBlock);
  let with_html_handled = html::normalize_html_in_markdown(&normalized, raw_html_mode);

  let (frontmatter, body) = frontmatter::extract_yaml_frontmatter(&with_html_handled);
  let hard_max = std::cmp::max(1, options.max_doc_chars);
  let target = std::cmp::min(
    std::cmp::max(1, options.target_doc_chars.unwrap_or(hard_max)),
    hard_max,
  );

  let initial_parts = match options.split.strategy_type.as_str() {
    "none" => vec![body.trim().to_string()],
    "heading" => split::split_by_heading(&body, options.split.level.unwrap_or(1)),
    _ => split::split_by_size(&body, target, hard_max),
  };

  let mut parts_after_sizing = Vec::new();
  for part in initial_parts {
    if split::utf16_len(&part) as u32 <= hard_max {
      parts_after_sizing.push(part);
    } else {
      parts_after_sizing.extend(split::split_by_size(&part, target, hard_max));
    }
  }

  let mut final_parts = Vec::new();
  for (index, part) in parts_after_sizing.iter().enumerate() {
    let with_frontmatter = if index == 0 && !frontmatter.is_empty() {
      format!("{}{}", frontmatter, part)
    } else {
      part.to_string()
    };
    let trimmed = with_frontmatter.trim().to_string();
    if !trimmed.is_empty() {
      final_parts.push(MarkdownImportPlanPart {
        markdown: trimmed.clone(),
        suggested_title: title::suggested_title_from_part(&trimmed),
        estimated_chars: split::utf16_len(&trimmed) as u32,
      });
    }
  }

  Ok(MarkdownImportPlanResult {
    normalized_markdown: with_html_handled,
    parts: final_parts,
    html,
  })
}
