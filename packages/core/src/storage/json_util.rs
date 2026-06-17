use serde_json::{Map, Value};

pub fn to_json_field(value: Option<&Map<String, Value>>) -> Option<String> {
  value.map(|map| Value::Object(map.clone()).to_string())
}

pub fn from_json_field(value: Option<String>) -> Option<Map<String, Value>> {
  let raw = value?;
  let parsed: Value = serde_json::from_str(&raw).ok()?;
  parsed.as_object().cloned()
}

pub fn to_optional_json_field(
  value: &Option<Option<Map<String, Value>>>,
) -> Option<Option<String>> {
  match value {
    None => None,
    Some(None) => Some(None),
    Some(Some(map)) => Some(Some(Value::Object(map.clone()).to_string())),
  }
}

pub fn ids_json(ids: &[String]) -> String {
  serde_json::to_string(ids).unwrap_or_else(|_| "[]".to_string())
}
