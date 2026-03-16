use serde_json::{json, Value};
use unicode_segmentation::UnicodeSegmentation;

use super::types::{DocumentEmbeddingProjection, DocumentProjectionRange, ProjectionBuilderState};

fn default_doc_json() -> Value {
  json!({ "type": "doc", "content": [{ "type": "paragraph" }] })
}

fn parse_content_doc(content: &str) -> Value {
  let Ok(parsed) = serde_json::from_str::<Value>(content) else {
    return default_doc_json();
  };

  if let Some(doc) = parsed.get("doc") {
    if doc.is_object() {
      return doc.clone();
    }
  }

  if parsed
    .get("type")
    .and_then(Value::as_str)
    .is_some_and(|node_type| node_type == "doc")
  {
    return parsed;
  }

  default_doc_json()
}

fn utf16_len(text: &str) -> usize {
  text.encode_utf16().count()
}

fn append_unmapped_text(state: &mut ProjectionBuilderState, text: &str) {
  if text.is_empty() {
    return;
  }
  state.parts.push(text.to_string());
  state.length += utf16_len(text);
}

fn append_mapped_text(state: &mut ProjectionBuilderState, text: &str, selection_from: usize) {
  if text.is_empty() {
    return;
  }

  let text_start = state.length;
  state.parts.push(text.to_string());
  state.length += utf16_len(text);
  state.ranges.push(DocumentProjectionRange {
    text_start,
    text_end: state.length,
    selection_from,
  });
}

fn child_separator(node_type: &str) -> &'static str {
  match node_type {
    "doc" | "blockquote" | "bullet_list" | "ordered_list" | "list_item" => "\n\n",
    _ => "",
  }
}

fn node_text(node: &Value) -> &str {
  node.get("text").and_then(Value::as_str).unwrap_or("")
}

fn node_type(node: &Value) -> &str {
  node.get("type").and_then(Value::as_str).unwrap_or("")
}

fn node_children(node: &Value) -> Vec<&Value> {
  node
    .get("content")
    .and_then(Value::as_array)
    .map(|items| items.iter().collect())
    .unwrap_or_default()
}

fn is_container_node_type(node_type: &str) -> bool {
  matches!(
    node_type,
    "doc"
      | "paragraph"
      | "heading"
      | "blockquote"
      | "bullet_list"
      | "ordered_list"
      | "list_item"
      | "code_block"
      | "table"
      | "table_row"
      | "table_cell"
      | "table_header"
  )
}

fn node_size(node: &Value) -> usize {
  let ty = node_type(node);
  if ty == "text" {
    return utf16_len(node_text(node));
  }

  if ty == "hard_break" || ty == "horizontal_rule" {
    return 1;
  }

  let has_content_field = node.get("content").is_some();
  let children = node_children(node);
  if children.is_empty() {
    // Mirror ProseMirror sizing semantics:
    // - leaf nodes have size 1
    // - non-leaf nodes contribute opening + closing tokens (size 2)
    if has_content_field {
      return 2;
    }

    // Empty block/container nodes can omit "content" in persisted JSON.
    // Keep known container node types at size 2; other leaf nodes stay size 1.
    return if is_container_node_type(ty) { 2 } else { 1 };
  }

  2 + children.into_iter().map(node_size).sum::<usize>()
}

fn append_node_text(state: &mut ProjectionBuilderState, node: &Value, position: isize) {
  let ty = node_type(node);
  if ty == "text" {
    append_mapped_text(state, node_text(node), position.max(0) as usize);
    return;
  }

  if ty == "hard_break" || ty == "horizontal_rule" {
    append_unmapped_text(state, "\n");
    return;
  }

  let separator = child_separator(ty);
  let children = node_children(node);
  let mut previous_rendered = false;
  let mut offset = 0usize;

  for child in children {
    if !separator.is_empty() && previous_rendered {
      append_unmapped_text(state, separator);
    }

    let child_position = position + (offset as isize) + 1;
    let before_length = state.length;
    append_node_text(state, child, child_position);
    let rendered = state.length > before_length;

    if !rendered && !separator.is_empty() && previous_rendered {
      if let Some(trailing) = state.parts.pop() {
        state.length = state.length.saturating_sub(utf16_len(&trailing));
      }
    }

    previous_rendered = previous_rendered || rendered;
    offset += node_size(child);
  }
}

fn build_grapheme_boundaries(text: &str) -> Vec<usize> {
  let mut boundaries = Vec::with_capacity(text.graphemes(true).count() + 1);
  boundaries.push(0);

  let mut offset = 0usize;
  for grapheme in text.graphemes(true) {
    offset += utf16_len(grapheme);
    boundaries.push(offset);
  }

  boundaries
}

pub(super) fn build_document_embedding_projection(
  title: &str,
  content: &str,
) -> Result<DocumentEmbeddingProjection, String> {
  let parsed_doc = parse_content_doc(content);
  if !parsed_doc.is_object() {
    return Err("Unable to parse document content for embedding projection.".to_string());
  }

  let mut body_state = ProjectionBuilderState {
    parts: vec![],
    length: 0,
    ranges: vec![],
  };
  append_node_text(&mut body_state, &parsed_doc, -1);

  let mut state = ProjectionBuilderState {
    parts: vec![],
    length: 0,
    ranges: vec![],
  };

  let trimmed_title = title.trim();
  if !trimmed_title.is_empty() {
    append_unmapped_text(&mut state, trimmed_title);
    if body_state.length > 0 {
      append_unmapped_text(&mut state, "\n\n");
    }
  }

  let body_offset = state.length;
  state.parts.extend(body_state.parts);
  state.length += body_state.length;
  state.ranges.extend(
    body_state
      .ranges
      .into_iter()
      .map(|range| DocumentProjectionRange {
        text_start: range.text_start + body_offset,
        text_end: range.text_end + body_offset,
        selection_from: range.selection_from,
      }),
  );

  let full_text = state.parts.join("");
  let trimmed = full_text.trim();
  if trimmed.is_empty() {
    return Ok(DocumentEmbeddingProjection {
      text: String::new(),
      ranges: vec![],
      grapheme_boundaries: vec![0],
    });
  }

  let trim_start_bytes = full_text.find(trimmed).unwrap_or(0);
  let trim_end_bytes = trim_start_bytes + trimmed.len();
  let trim_start = utf16_len(&full_text[..trim_start_bytes]);
  let trim_end = utf16_len(&full_text[..trim_end_bytes]);

  let ranges = state
    .ranges
    .into_iter()
    .filter_map(|range| {
      let clamped_start = trim_start.max(range.text_start);
      let clamped_end = trim_end.min(range.text_end);
      if clamped_end <= clamped_start {
        return None;
      }

      let start_offset = clamped_start.saturating_sub(range.text_start);
      let selection_from = range.selection_from + start_offset;

      Some(DocumentProjectionRange {
        text_start: clamped_start.saturating_sub(trim_start),
        text_end: clamped_end.saturating_sub(trim_start),
        selection_from,
      })
    })
    .collect::<Vec<_>>();

  Ok(DocumentEmbeddingProjection {
    text: trimmed.to_string(),
    ranges,
    grapheme_boundaries: build_grapheme_boundaries(trimmed),
  })
}

pub(super) fn map_projection_grapheme_range_to_selection(
  projection: &DocumentEmbeddingProjection,
  start: usize,
  end: usize,
) -> Option<(usize, usize)> {
  if end <= start {
    return None;
  }

  let code_unit_start = *projection.grapheme_boundaries.get(start)?;
  let code_unit_end = *projection.grapheme_boundaries.get(end)?;
  if code_unit_end <= code_unit_start {
    return None;
  }

  let mut mapped_from: Option<usize> = None;
  let mut mapped_to: Option<usize> = None;

  for range in &projection.ranges {
    let overlap_start = code_unit_start.max(range.text_start);
    let overlap_end = code_unit_end.min(range.text_end);
    if overlap_end <= overlap_start {
      continue;
    }

    let start_offset = overlap_start.saturating_sub(range.text_start);
    let end_offset = overlap_end.saturating_sub(range.text_start);
    let next_from = range.selection_from + start_offset;
    let next_to = range.selection_from + end_offset;

    mapped_from = Some(mapped_from.map_or(next_from, |current| current.min(next_from)));
    mapped_to = Some(mapped_to.map_or(next_to, |current| current.max(next_to)));
  }

  match (mapped_from, mapped_to) {
    (Some(from), Some(to)) if to > from => Some((from, to)),
    _ => None,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn content_from_text(text: &str) -> String {
    format!(
      "{{\"doc\":{{\"type\":\"doc\",\"content\":[{{\"type\":\"paragraph\",\"content\":[{{\"type\":\"text\",\"text\":\"{}\"}}]}}]}},\"aiDraft\":null}}",
      text
    )
  }

  #[test]
  fn defaults_when_content_is_invalid_json() {
    let projection = build_document_embedding_projection("", "not-json").unwrap();
    assert_eq!(projection.text, "");
    assert!(projection.ranges.is_empty());
    assert_eq!(projection.grapheme_boundaries, vec![0]);
  }

  #[test]
  fn includes_title_then_body_and_trims_edges() {
    let content = content_from_text("  Alpha  ");
    let projection = build_document_embedding_projection("  Title  ", &content).unwrap();

    assert_eq!(projection.text, "Title\n\n  Alpha");
  }

  #[test]
  fn maps_grapheme_ranges_to_utf16_selection_offsets() {
    let content = content_from_text("A\u{1F600}BCDEFG");
    let projection = build_document_embedding_projection("", &content).unwrap();

    let first = map_projection_grapheme_range_to_selection(&projection, 0, 4);
    let second = map_projection_grapheme_range_to_selection(&projection, 2, 6);
    let third = map_projection_grapheme_range_to_selection(&projection, 4, 8);

    assert_eq!(first, Some((1, 6)));
    assert_eq!(second, Some((4, 8)));
    assert_eq!(third, Some((6, 10)));
  }

  #[test]
  fn returns_none_for_invalid_or_unmappable_ranges() {
    let content = content_from_text("hello");
    let projection = build_document_embedding_projection("", &content).unwrap();

    assert_eq!(
      map_projection_grapheme_range_to_selection(&projection, 2, 2),
      None
    );
    assert_eq!(
      map_projection_grapheme_range_to_selection(&projection, 100, 101),
      None
    );
  }

  #[test]
  fn keeps_selection_offsets_correct_with_empty_block_before_text() {
    let content = "{\"doc\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"A\"}]}]},\"aiDraft\":null}";
    let projection = build_document_embedding_projection("", content).unwrap();

    assert_eq!(projection.text, "A");
    assert_eq!(
      map_projection_grapheme_range_to_selection(&projection, 0, 1),
      Some((3, 4))
    );
  }

  #[test]
  fn keeps_selection_offsets_correct_with_inline_leaf_between_text_nodes() {
    let content = "{\"doc\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"A\"},{\"type\":\"image\",\"attrs\":{\"src\":\"/img.png\"}},{\"type\":\"text\",\"text\":\"B\"}]}]},\"aiDraft\":null}";
    let projection = build_document_embedding_projection("", content).unwrap();

    assert_eq!(projection.text, "AB");
    assert_eq!(
      map_projection_grapheme_range_to_selection(&projection, 0, 1),
      Some((1, 2))
    );
    assert_eq!(
      map_projection_grapheme_range_to_selection(&projection, 1, 2),
      Some((3, 4))
    );
  }
}
