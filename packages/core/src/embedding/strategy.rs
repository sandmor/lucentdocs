use serde_json::{Map, Value};

use super::types::{ChunkLevel, Strategy};

pub(super) fn parse_strategy(strategy_json: &str) -> Result<Strategy, String> {
  let value: Value = serde_json::from_str(strategy_json)
    .map_err(|e| format!("Invalid embedding strategy JSON: {e}"))?;

  let Some(strategy_type) = value.get("type").and_then(Value::as_str) else {
    return Err("Embedding strategy is missing required field 'type'.".to_string());
  };

  if strategy_type == "whole_document" {
    return Ok(Strategy::WholeDocument);
  }

  if strategy_type != "sliding_window" {
    return Err(format!(
      "Unsupported embedding strategy type: {strategy_type}"
    ));
  }

  let Some(properties) = value.get("properties").and_then(Value::as_object) else {
    return Err("Sliding-window strategy is missing required field 'properties'.".to_string());
  };

  let Some(level) = properties.get("level").and_then(Value::as_str) else {
    return Err(
      "Sliding-window strategy is missing required field 'properties.level'.".to_string(),
    );
  };

  let window_size = read_positive_usize(properties, "windowSize")?;
  let stride = read_positive_usize(properties, "stride")?;

  match level {
    "character" => Ok(Strategy::SlidingCharacter {
      window_size,
      stride,
    }),
    "sentence" | "paragraph" => {
      let min_unit_chars = read_positive_usize(properties, "minUnitChars")?;
      let max_unit_chars = read_positive_usize(properties, "maxUnitChars")?;
      if min_unit_chars > max_unit_chars {
        return Err(
          "Sliding-window strategy must satisfy minUnitChars <= maxUnitChars.".to_string(),
        );
      }
      Ok(Strategy::SlidingStructured {
        level: if level == "sentence" {
          ChunkLevel::Sentence
        } else {
          ChunkLevel::Paragraph
        },
        window_size,
        stride,
        min_unit_chars,
        max_unit_chars,
      })
    }
    _ => Err(format!("Unsupported sliding-window level: {level}")),
  }
}

fn read_positive_usize(properties: &Map<String, Value>, key: &str) -> Result<usize, String> {
  let Some(raw) = properties.get(key).and_then(Value::as_u64) else {
    return Err(format!(
      "Sliding-window strategy is missing numeric field '{key}'."
    ));
  };
  let value = raw as usize;
  if value == 0 {
    return Err(format!(
      "Sliding-window strategy field '{key}' must be >= 1."
    ));
  }
  Ok(value)
}
