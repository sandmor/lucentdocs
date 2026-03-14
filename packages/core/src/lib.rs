use napi::bindgen_prelude::*;
use napi_derive::napi;

pub mod import_plan;
pub mod markdown;

#[napi(string_enum)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MarkdownRawHtmlMode {
  Drop,
  CodeBlock,
}

#[napi(object)]
pub struct MarkdownParseOptions {
  pub raw_html_mode: Option<MarkdownRawHtmlMode>,
}

#[napi]
pub fn parse_markdown(
  input: String,
  options: MarkdownParseOptions,
) -> std::result::Result<String, Error> {
  let raw_html_mode = options
    .raw_html_mode
    .unwrap_or(MarkdownRawHtmlMode::CodeBlock);
  markdown::parse_to_prosemirror(&input, raw_html_mode)
    .and_then(|val| serde_json::to_string(&val).map_err(|e| e.to_string()))
    .map_err(|e| Error::new(Status::GenericFailure, e))
}
