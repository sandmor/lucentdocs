pub(crate) mod fence;
pub(crate) mod html;
mod prosemirror;
pub(crate) mod text;

use crate::MarkdownRawHtmlMode;
use serde_json::Value;

/// Normalize raw markdown text for import: fix line endings, then convert HTML
/// blocks/inline elements to their markdown equivalents.
pub(crate) fn normalize(markdown: &str, raw_html_mode: MarkdownRawHtmlMode) -> String {
  let newlines_fixed = text::normalize_newlines(markdown);
  html::normalize_html_in_markdown(&newlines_fixed, raw_html_mode)
}

pub(crate) fn parse_to_prosemirror(
  markdown: &str,
  raw_html_mode: MarkdownRawHtmlMode,
) -> Result<Value, String> {
  prosemirror::parse_to_prosemirror(markdown, raw_html_mode)
}
