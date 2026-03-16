pub(crate) mod document;
pub(crate) mod fence;
pub(crate) mod html;
pub(crate) mod text;

use crate::MarkdownRawHtmlMode;
pub(crate) use document::ParsedMarkdownDocument;

/// Normalize raw markdown text for import: fix line endings, then convert HTML
/// blocks/inline elements to their markdown equivalents.
pub(crate) fn normalize(markdown: &str, raw_html_mode: MarkdownRawHtmlMode) -> String {
  let newlines_fixed = text::normalize_newlines(markdown);
  html::normalize_html_in_markdown(&newlines_fixed, raw_html_mode)
}
