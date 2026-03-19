use unicode_segmentation::UnicodeSegmentation;

use super::types::{ChunkLevel, ChunkRange, EmbeddingChunk, Strategy};

fn create_chunk(graphemes: &[String], ordinal: usize, start: usize, end: usize) -> EmbeddingChunk {
  let text = graphemes[start..end].join("");
  EmbeddingChunk {
    ordinal,
    start,
    end,
    text,
  }
}

fn create_whole_document_chunk(graphemes: &[String]) -> Vec<EmbeddingChunk> {
  let chunk = create_chunk(graphemes, 0, 0, graphemes.len());
  if chunk.text.trim().is_empty() {
    vec![]
  } else {
    vec![chunk]
  }
}

fn range_length(range: ChunkRange) -> usize {
  range.end.saturating_sub(range.start)
}

fn is_line_break(grapheme: &str) -> bool {
  grapheme == "\n" || grapheme == "\r" || grapheme == "\r\n"
}

fn build_sentence_ranges(text: &str, total_graphemes: usize) -> Vec<ChunkRange> {
  if text.is_empty() {
    return vec![];
  }

  let mut ranges = vec![];
  let mut cursor = 0usize;

  for segment in text.split_sentence_bounds() {
    if segment.is_empty() {
      continue;
    }
    let start = cursor;
    cursor += segment.graphemes(true).count();
    if cursor > start {
      ranges.push(ChunkRange { start, end: cursor });
    }
  }

  if ranges.is_empty() {
    vec![ChunkRange {
      start: 0,
      end: total_graphemes,
    }]
  } else {
    ranges
  }
}

fn build_paragraph_ranges(text: &str, total_graphemes: usize) -> Vec<ChunkRange> {
  if text.is_empty() {
    return vec![];
  }

  let full = text.graphemes(true).collect::<Vec<_>>();
  let mut ranges = vec![];
  let mut start = 0usize;
  let mut i = 0usize;

  while i < full.len() {
    if is_line_break(full[i]) {
      let mut j = i;
      let mut break_count = 0usize;
      while j < full.len() && is_line_break(full[j]) {
        break_count += 1;
        j += 1;
      }

      if break_count >= 2 {
        if i > start {
          ranges.push(ChunkRange { start, end: i });
        }
        start = j;
      }

      i = j;
      continue;
    }

    i += 1;
  }

  if start < full.len() {
    ranges.push(ChunkRange {
      start,
      end: full.len(),
    });
  }

  if ranges.is_empty() {
    vec![ChunkRange {
      start: 0,
      end: total_graphemes,
    }]
  } else {
    ranges
  }
}

fn split_range_by_graphemes(range: ChunkRange, max_chars: usize) -> Vec<ChunkRange> {
  if range_length(range) <= max_chars {
    return vec![range];
  }

  let mut result = vec![];
  let mut current = range.start;
  while current < range.end {
    let chunk_end = (current + max_chars).min(range.end);
    result.push(ChunkRange {
      start: current,
      end: chunk_end,
    });
    current = chunk_end;
  }

  result
}

fn split_range_by_sentences(
  range: ChunkRange,
  max_chars: usize,
  graphemes: &[String],
) -> Vec<ChunkRange> {
  if range_length(range) <= max_chars {
    return vec![range];
  }

  let paragraph_text = graphemes[range.start..range.end].join("");
  let paragraph_graphemes = range.end.saturating_sub(range.start);
  let sentence_ranges = build_sentence_ranges(&paragraph_text, paragraph_graphemes)
    .into_iter()
    .map(|local| ChunkRange {
      start: range.start + local.start,
      end: range.start + local.end,
    })
    .collect::<Vec<_>>();

  let mut result = vec![];
  for sentence in sentence_ranges {
    if range_length(sentence) <= max_chars {
      result.push(sentence);
    } else {
      result.extend(split_range_by_graphemes(sentence, max_chars));
    }
  }

  if result.is_empty() {
    split_range_by_graphemes(range, max_chars)
  } else {
    result
  }
}

fn normalize_units(
  units: &[ChunkRange],
  min_chars: usize,
  max_chars: usize,
  level: ChunkLevel,
  graphemes: &[String],
) -> Vec<ChunkRange> {
  if units.is_empty() {
    return vec![];
  }

  let merge_short_units =
    |input: &[ChunkRange], max_merged_chars: Option<usize>| -> Vec<ChunkRange> {
      let mut merged = vec![];
      let mut i = 0usize;

      while i < input.len() {
        let mut current = input[i];
        while range_length(current) < min_chars && i + 1 < input.len() {
          let next = input[i + 1];
          let next_len = next.end.saturating_sub(current.start);
          if max_merged_chars.is_some_and(|limit| next_len > limit) {
            break;
          }

          i += 1;
          current.end = next.end;
        }

        merged.push(current);
        i += 1;
      }

      merged
    };

  let merged = merge_short_units(units, None);

  let mut split_units = vec![];
  for unit in merged {
    if range_length(unit) > max_chars {
      match level {
        ChunkLevel::Sentence => split_units.extend(split_range_by_graphemes(unit, max_chars)),
        ChunkLevel::Paragraph => {
          split_units.extend(split_range_by_sentences(unit, max_chars, graphemes))
        }
      }
    } else {
      split_units.push(unit);
    }
  }

  // Oversized paragraph splitting can create tiny sentence fragments.
  // Re-merge adjacent units to satisfy min_chars where possible, without
  // violating the max_chars cap.
  merge_short_units(&split_units, Some(max_chars))
}

fn dedupe_ranges(ranges: Vec<ChunkRange>) -> Vec<ChunkRange> {
  let mut deduped = vec![];
  for range in ranges {
    if deduped.last().is_some_and(|previous: &ChunkRange| {
      previous.start == range.start && previous.end == range.end
    }) {
      continue;
    }
    deduped.push(range);
  }
  deduped
}

fn build_structured_chunks(
  graphemes: &[String],
  units: Vec<ChunkRange>,
  window_size: usize,
  stride: usize,
  min_unit_chars: usize,
  max_unit_chars: usize,
  level: ChunkLevel,
) -> Vec<EmbeddingChunk> {
  if units.is_empty() {
    return create_whole_document_chunk(graphemes);
  }

  let normalized_units = normalize_units(&units, min_unit_chars, max_unit_chars, level, graphemes);
  if normalized_units.is_empty() {
    return create_whole_document_chunk(graphemes);
  }

  let mut ranges = vec![];
  let mut start_index = 0usize;
  while start_index < normalized_units.len() {
    let end_index = (start_index + window_size).min(normalized_units.len());
    ranges.push(ChunkRange {
      start: normalized_units[start_index].start,
      end: normalized_units[end_index - 1].end,
    });

    if end_index >= normalized_units.len() {
      break;
    }

    start_index += stride;
  }

  dedupe_ranges(ranges)
    .into_iter()
    .filter(|range| range.end > range.start)
    .enumerate()
    .map(|(ordinal, range)| create_chunk(graphemes, ordinal, range.start, range.end))
    .filter(|chunk| !chunk.text.trim().is_empty())
    .collect()
}

pub(super) fn build_embedding_chunks(text: &str, strategy: &Strategy) -> Vec<EmbeddingChunk> {
  if text.is_empty() {
    return vec![];
  }

  let graphemes = text
    .graphemes(true)
    .map(ToString::to_string)
    .collect::<Vec<_>>();
  if graphemes.is_empty() {
    return vec![];
  }

  match strategy {
    Strategy::WholeDocument => create_whole_document_chunk(&graphemes),
    Strategy::SlidingCharacter {
      window_size,
      stride,
    } => {
      if graphemes.len() <= *window_size {
        return create_whole_document_chunk(&graphemes);
      }

      let mut chunks = vec![];
      let mut start = 0usize;
      let mut ordinal = 0usize;
      while start < graphemes.len() {
        let end = (start + window_size).min(graphemes.len());
        let chunk = create_chunk(&graphemes, ordinal, start, end);
        if !chunk.text.is_empty() {
          chunks.push(chunk);
        }

        if end >= graphemes.len() {
          break;
        }

        start += stride;
        ordinal += 1;
      }

      chunks
    }
    Strategy::SlidingStructured {
      level,
      window_size,
      stride,
      min_unit_chars,
      max_unit_chars,
    } => {
      let units = match level {
        ChunkLevel::Sentence => build_sentence_ranges(text, graphemes.len()),
        ChunkLevel::Paragraph => build_paragraph_ranges(text, graphemes.len()),
      };

      build_structured_chunks(
        &graphemes,
        units,
        *window_size,
        *stride,
        *min_unit_chars,
        *max_unit_chars,
        *level,
      )
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn returns_empty_for_empty_string() {
    let chunks = build_embedding_chunks("", &Strategy::WholeDocument);
    assert!(chunks.is_empty());
  }

  #[test]
  fn returns_empty_for_whitespace_only_whole_document() {
    let chunks = build_embedding_chunks("   \t\n  ", &Strategy::WholeDocument);
    assert!(chunks.is_empty());
  }

  #[test]
  fn character_level_chunking_is_unicode_aware() {
    let chunks = build_embedding_chunks(
      "A\u{1F600}BCDEFG",
      &Strategy::SlidingCharacter {
        window_size: 4,
        stride: 2,
      },
    );

    assert_eq!(chunks.len(), 3);
    assert_eq!(chunks[0].start, 0);
    assert_eq!(chunks[0].end, 4);
    assert_eq!(chunks[0].text, "A\u{1F600}BC");
    assert_eq!(chunks[1].text, "BCDE");
    assert_eq!(chunks[2].text, "DEFG");
  }

  #[test]
  fn sentence_windows_overlap_as_expected() {
    let chunks = build_embedding_chunks(
      "Alpha. Beta. Gamma.",
      &Strategy::SlidingStructured {
        level: ChunkLevel::Sentence,
        window_size: 2,
        stride: 1,
        min_unit_chars: 1,
        max_unit_chars: 100,
      },
    );

    let texts = chunks
      .into_iter()
      .map(|chunk| chunk.text)
      .collect::<Vec<_>>();
    assert_eq!(texts, vec!["Alpha. Beta. ", "Beta. Gamma."]);
  }

  #[test]
  fn merges_short_sentences_to_min_unit_chars() {
    let chunks = build_embedding_chunks(
      "One. Another sentence.",
      &Strategy::SlidingStructured {
        level: ChunkLevel::Sentence,
        window_size: 1,
        stride: 1,
        min_unit_chars: 10,
        max_unit_chars: 100,
      },
    );

    let texts = chunks
      .into_iter()
      .map(|chunk| chunk.text)
      .collect::<Vec<_>>();
    assert_eq!(texts, vec!["One. Another sentence."]);
  }

  #[test]
  fn paragraph_windows_overlap_as_expected() {
    let text = "Paragraph one.\n\nParagraph two.\n\nParagraph three.\n\nParagraph four.";
    let chunks = build_embedding_chunks(
      text,
      &Strategy::SlidingStructured {
        level: ChunkLevel::Paragraph,
        window_size: 3,
        stride: 2,
        min_unit_chars: 1,
        max_unit_chars: 500,
      },
    );

    let texts = chunks
      .into_iter()
      .map(|chunk| chunk.text)
      .collect::<Vec<_>>();
    assert_eq!(
      texts,
      vec![
        "Paragraph one.\n\nParagraph two.\n\nParagraph three.",
        "Paragraph three.\n\nParagraph four.",
      ]
    );
  }

  #[test]
  fn splits_oversized_paragraphs_at_sentence_boundaries() {
    let sentence1 = "First sentence here. ";
    let sentence2 = "Second sentence here. ";
    let sentence3 = "Third sentence here.";
    let paragraph = format!("{sentence1}{sentence2}{sentence3}");
    let text = format!("{paragraph}\n\nAnother paragraph.");

    let chunks = build_embedding_chunks(
      &text,
      &Strategy::SlidingStructured {
        level: ChunkLevel::Paragraph,
        window_size: 1,
        stride: 1,
        min_unit_chars: 1,
        max_unit_chars: 40,
      },
    );

    let texts = chunks
      .into_iter()
      .map(|chunk| chunk.text)
      .collect::<Vec<_>>();
    assert_eq!(
      texts,
      vec![
        sentence1.to_string(),
        sentence2.to_string(),
        sentence3.to_string(),
        "Another paragraph.".to_string(),
      ]
    );
  }

  #[test]
  fn remixes_tiny_sentence_fragments_after_oversized_paragraph_split() {
    let paragraph = "A. ".repeat(30);

    let chunks = build_embedding_chunks(
      &paragraph,
      &Strategy::SlidingStructured {
        level: ChunkLevel::Paragraph,
        window_size: 1,
        stride: 1,
        min_unit_chars: 20,
        max_unit_chars: 40,
      },
    );

    assert!(chunks.len() < 10);
    for chunk in chunks.iter().take(chunks.len().saturating_sub(1)) {
      assert!(chunk.text.len() >= 20);
      assert!(chunk.text.len() <= 40);
    }
  }

  #[test]
  fn paragraph_split_handles_crlf_boundaries() {
    let text = "First paragraph.\r\n\r\nSecond paragraph.";
    let chunks = build_embedding_chunks(
      text,
      &Strategy::SlidingStructured {
        level: ChunkLevel::Paragraph,
        window_size: 1,
        stride: 1,
        min_unit_chars: 1,
        max_unit_chars: 500,
      },
    );

    let texts = chunks
      .into_iter()
      .map(|chunk| chunk.text)
      .collect::<Vec<_>>();
    assert_eq!(texts, vec!["First paragraph.", "Second paragraph."]);
  }

  #[test]
  fn splits_oversized_sentences_by_graphemes() {
    let long_sentence = "x".repeat(100);
    let text = format!("{long_sentence}. Another sentence.");

    let chunks = build_embedding_chunks(
      &text,
      &Strategy::SlidingStructured {
        level: ChunkLevel::Sentence,
        window_size: 1,
        stride: 1,
        min_unit_chars: 1,
        max_unit_chars: 50,
      },
    );

    assert_eq!(chunks[0].text, "x".repeat(50));
    assert_eq!(chunks[1].text, "x".repeat(50));
  }

  #[test]
  fn keeps_zwj_sequences_as_single_graphemes() {
    let family = "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}";
    let text = format!("A{family}BC");

    let chunks = build_embedding_chunks(
      &text,
      &Strategy::SlidingCharacter {
        window_size: 2,
        stride: 1,
      },
    );

    let texts = chunks
      .into_iter()
      .map(|chunk| chunk.text)
      .collect::<Vec<_>>();
    assert_eq!(
      texts,
      vec![format!("A{family}"), format!("{family}B"), "BC".to_string()]
    );
  }

  #[test]
  fn keeps_combining_characters_as_single_graphemes() {
    let e_with_acute = "e\u{0301}";
    let text = format!("A{e_with_acute}B");

    let chunks = build_embedding_chunks(
      &text,
      &Strategy::SlidingCharacter {
        window_size: 2,
        stride: 1,
      },
    );

    let texts = chunks
      .into_iter()
      .map(|chunk| chunk.text)
      .collect::<Vec<_>>();
    assert_eq!(
      texts,
      vec![format!("A{e_with_acute}"), format!("{e_with_acute}B")]
    );
  }
}
