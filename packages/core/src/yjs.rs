use std::collections::HashMap;
use std::sync::Arc;

use serde_json::{Map, Value};
use yrs::types::{Attrs, Delta};
use yrs::{
  Any, Doc, In, ReadTxn, StateVector, Text, Transact, WriteTxn, Xml, XmlElementPrelim, XmlFragment,
  XmlTextPrelim,
};

use crate::markdown::document::ContentNode;

pub(crate) fn encode_content_tree_as_update(root: &ContentNode) -> Vec<u8> {
  let ydoc = Doc::new();
  let mut txn = ydoc.transact_mut();
  let fragment = txn.get_or_insert_xml_fragment("prosemirror");
  append_pm_children(&fragment, &mut txn, root);

  txn.encode_state_as_update_v1(&StateVector::default())
}

fn append_pm_children<T: XmlFragment>(
  parent: &T,
  txn: &mut yrs::TransactionMut<'_>,
  node: &ContentNode,
) {
  if node.children.is_empty() {
    return;
  }

  let children = &node.children;

  let mut i = 0;
  while i < children.len() {
    if is_text_node(&children[i]) {
      let start = i;
      while i < children.len() && is_text_node(&children[i]) {
        i += 1;
      }

      let text = parent.push_back(txn, XmlTextPrelim::new(""));
      let delta = build_text_delta(&children[start..i]);
      text.apply_delta(txn, delta);
      continue;
    }

    append_element_node(parent, txn, &children[i]);
    i += 1;
  }
}

fn append_element_node<T: XmlFragment>(
  parent: &T,
  txn: &mut yrs::TransactionMut<'_>,
  node: &ContentNode,
) {
  let element = parent.push_back(txn, XmlElementPrelim::empty(node.type_name.as_str()));

  for (key, value) in &node.attrs {
    if value.is_null() {
      continue;
    }
    element.insert_attribute(txn, key.as_str(), json_value_to_any(value));
  }

  append_pm_children(&element, txn, node);
}

fn build_text_delta(nodes: &[ContentNode]) -> Vec<Delta<In>> {
  let mut delta = Vec::with_capacity(nodes.len());

  for node in nodes {
    let text = node.text.as_deref().unwrap_or("");

    let attributes = marks_to_attrs(&node.marks);
    delta.push(Delta::Inserted(In::Any(Any::from(text)), attributes));
  }

  delta
}

fn marks_to_attrs(marks: &[Value]) -> Option<Box<Attrs>> {
  if marks.is_empty() {
    return None;
  }

  let mut attrs: Attrs = HashMap::new();
  for mark in marks {
    let Some(mark_obj) = mark.as_object() else {
      continue;
    };
    let Some(mark_type) = mark.get("type").and_then(Value::as_str) else {
      continue;
    };

    if mark_type == "ychange" {
      continue;
    }

    let mark_attrs = mark_obj
      .get("attrs")
      .cloned()
      .unwrap_or_else(|| Value::Object(Map::new()));
    attrs.insert(Arc::<str>::from(mark_type), json_value_to_any(&mark_attrs));
  }

  if attrs.is_empty() {
    None
  } else {
    Some(Box::new(attrs))
  }
}

fn json_value_to_any(value: &Value) -> Any {
  serde_json::from_value(value.clone()).unwrap_or(Any::Null)
}

fn is_text_node(node: &ContentNode) -> bool {
  node.type_name == "text"
}
