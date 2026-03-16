use pulldown_cmark::{Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use serde_json::{json, Map, Value};

use crate::MarkdownRawHtmlMode;

pub(crate) struct ParsedMarkdownDocument {
  root: ContentNode,
}

impl ParsedMarkdownDocument {
  pub(crate) fn parse(markdown: &str, raw_html_mode: MarkdownRawHtmlMode) -> Result<Self, String> {
    let root = parse_to_content_tree(markdown, raw_html_mode)?;
    Ok(Self { root })
  }

  pub(crate) fn code_block_fallback(markdown: &str) -> Self {
    Self {
      root: build_code_block_tree(markdown),
    }
  }

  pub(crate) fn to_prosemirror_json(&self) -> Value {
    self.root.to_json()
  }

  pub(crate) fn to_yjs_update(&self) -> Vec<u8> {
    crate::yjs::encode_content_tree_as_update(&self.root)
  }
}

fn build_code_block_tree(markdown: &str) -> ContentNode {
  let mut root = ContentNode::new("doc");
  let mut code_block = ContentNode::new("code_block");
  code_block.push_child(ContentNode::text(
    markdown.replace("\r\n", "\n").replace('\r', "\n"),
  ));
  root.push_child(code_block);
  root
}

fn parse_to_content_tree(
  markdown: &str,
  raw_html_mode: MarkdownRawHtmlMode,
) -> Result<ContentNode, String> {
  let normalized = super::normalize(markdown, raw_html_mode);
  let mut opts = Options::empty();
  opts.insert(Options::ENABLE_SMART_PUNCTUATION);
  let parser = Parser::new_ext(&normalized, opts);

  let root = ContentNode::new("doc");
  let mut stack: Vec<ContentNode> = vec![root];
  let mut active_marks: Vec<Value> = vec![];

  for event in parser {
    match event {
      Event::Start(tag) => {
        if is_mark(&tag) {
          active_marks.push(tag_to_mark(&tag));
        } else {
          stack.push(tag_to_node(&tag));
        }
      }
      Event::End(tag_end) => {
        let is_m = matches!(tag_end, TagEnd::Emphasis | TagEnd::Strong | TagEnd::Link);
        if is_m {
          active_marks.pop();
        } else {
          let mut node = stack.pop().ok_or("Unbalanced tags")?;

          match tag_end {
            TagEnd::Image => {
              let alt_text: String = node
                .children
                .iter()
                .filter_map(|c| c.text.clone())
                .collect();
              node.attrs.insert("alt".to_string(), json!(alt_text));
              node.children.clear();
            }
            TagEnd::Item => {
              let mut new_children = vec![];
              let mut current_para = None;
              for child in node.children.drain(..) {
                let is_inline = child.type_name == "text"
                  || child.type_name == "image"
                  || child.type_name == "hard_break"
                  || !child.marks.is_empty();
                if is_inline {
                  if current_para.is_none() {
                    current_para = Some(ContentNode::new("paragraph"));
                  }
                  current_para
                    .as_mut()
                    .expect("paragraph set")
                    .push_child(child);
                } else {
                  if let Some(p) = current_para.take() {
                    new_children.push(p);
                  }
                  new_children.push(child);
                }
              }
              if let Some(p) = current_para.take() {
                new_children.push(p);
              }
              if new_children.is_empty() {
                new_children.push(ContentNode::new("paragraph"));
              }
              node.children = new_children;
            }
            TagEnd::CodeBlock => {
              if let Some(last) = node.children.last_mut() {
                if last.type_name == "text" {
                  if let Some(ref mut text) = last.text {
                    if text.ends_with("\n") {
                      text.pop();
                    }
                  }
                }
              }
            }
            _ => {}
          }

          if let Some(parent) = stack.last_mut() {
            parent.push_child(node);
          } else {
            return Err("Root popped too early".into());
          }
        }
      }
      Event::Text(text) => {
        if let Some(parent) = stack.last_mut() {
          let mut text_node = ContentNode::text(text.into_string());
          text_node.marks = active_marks.clone();
          parent.push_child(text_node);
        }
      }
      Event::Html(html) => {
        if raw_html_mode == MarkdownRawHtmlMode::Drop {
          continue;
        }
        if let Some(parent) = stack.last_mut() {
          if parent.type_name == "paragraph" {
            let mut text_node = ContentNode::text(html.into_string());
            let mut marks = active_marks.clone();
            marks.push(json!({ "type": "code" }));
            text_node.marks = marks;
            parent.push_child(text_node);
          } else {
            let mut node = ContentNode::new("code_block");
            node.push_child(ContentNode::text(html.into_string()));
            parent.push_child(node);
          }
        }
      }
      Event::InlineHtml(html) => {
        if raw_html_mode == MarkdownRawHtmlMode::Drop {
          continue;
        }
        if let Some(parent) = stack.last_mut() {
          let mut text_node = ContentNode::text(html.into_string());
          let mut marks = active_marks.clone();
          marks.push(json!({ "type": "code" }));
          text_node.marks = marks;
          parent.push_child(text_node);
        }
      }
      Event::Code(code) => {
        if let Some(parent) = stack.last_mut() {
          let mut text_node = ContentNode::text(code.into_string());
          let mut marks = active_marks.clone();
          marks.push(json!({ "type": "code" }));
          text_node.marks = marks;
          parent.push_child(text_node);
        }
      }
      Event::SoftBreak => {
        if let Some(parent) = stack.last_mut() {
          let mut text_node = ContentNode::text(" ".to_string());
          text_node.marks = active_marks.clone();
          parent.push_child(text_node);
        }
      }
      Event::HardBreak => {
        if let Some(parent) = stack.last_mut() {
          parent.push_child(ContentNode::new("hard_break"));
        }
      }
      Event::Rule => {
        if let Some(parent) = stack.last_mut() {
          parent.push_child(ContentNode::new("horizontal_rule"));
        }
      }
      _ => {}
    }
  }

  let mut final_root = stack.pop().ok_or("No root found")?;
  if final_root.children.is_empty() {
    final_root.push_child(ContentNode::new("paragraph"));
  }

  Ok(final_root)
}

#[derive(Debug, Clone)]
pub(crate) struct ContentNode {
  pub type_name: String,
  pub attrs: Map<String, Value>,
  pub children: Vec<ContentNode>,
  pub text: Option<String>,
  pub marks: Vec<Value>,
}

impl ContentNode {
  pub(crate) fn new(type_name: &str) -> Self {
    Self {
      type_name: type_name.to_string(),
      attrs: Map::new(),
      children: Vec::new(),
      text: None,
      marks: Vec::new(),
    }
  }

  pub(crate) fn text(text: String) -> Self {
    Self {
      type_name: "text".to_string(),
      attrs: Map::new(),
      children: Vec::new(),
      text: Some(text),
      marks: Vec::new(),
    }
  }

  pub(crate) fn push_child(&mut self, child: ContentNode) {
    if child.type_name == "text" {
      if let Some(last) = self.children.last_mut() {
        if last.type_name == "text" && last.marks == child.marks {
          if let (Some(last_text), Some(child_text)) = (&mut last.text, &child.text) {
            last_text.push_str(child_text);
            return;
          }
        }
      }
    }
    self.children.push(child);
  }

  pub(crate) fn to_json(&self) -> Value {
    let mut obj = Map::new();
    obj.insert("type".to_string(), json!(self.type_name));

    if let Some(text) = &self.text {
      obj.insert("text".to_string(), json!(text));
    }

    if !self.attrs.is_empty() {
      obj.insert("attrs".to_string(), Value::Object(self.attrs.clone()));
    }

    if !self.marks.is_empty() {
      obj.insert("marks".to_string(), json!(self.marks));
    }

    if !self.children.is_empty() {
      let content: Vec<Value> = self.children.iter().map(|c| c.to_json()).collect();
      obj.insert("content".to_string(), json!(content));
    }

    Value::Object(obj)
  }
}

fn is_mark(tag: &Tag) -> bool {
  matches!(tag, Tag::Emphasis | Tag::Strong | Tag::Link { .. })
}

fn tag_to_mark(tag: &Tag) -> Value {
  match tag {
    Tag::Emphasis => json!({ "type": "em" }),
    Tag::Strong => json!({ "type": "strong" }),
    Tag::Link {
      dest_url, title, ..
    } => {
      let mut attrs = Map::new();
      attrs.insert("href".to_string(), json!(dest_url.as_ref()));
      if !title.is_empty() {
        attrs.insert("title".to_string(), json!(title.as_ref()));
      }
      json!({ "type": "link", "attrs": attrs })
    }
    _ => json!({}),
  }
}

fn tag_to_node(tag: &Tag) -> ContentNode {
  match tag {
    Tag::Paragraph => ContentNode::new("paragraph"),
    Tag::Heading { level, .. } => {
      let mut node = ContentNode::new("heading");
      let lvl = match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
      };
      node.attrs.insert("level".to_string(), json!(lvl));
      node
    }
    Tag::BlockQuote(_) => ContentNode::new("blockquote"),
    Tag::CodeBlock(pulldown_cmark::CodeBlockKind::Fenced(info)) => {
      let mut node = ContentNode::new("code_block");
      let params = info.as_ref();
      if !params.is_empty() {
        node.attrs.insert("params".to_string(), json!(params));
      }
      node
    }
    Tag::CodeBlock(pulldown_cmark::CodeBlockKind::Indented) => ContentNode::new("code_block"),
    Tag::List(Some(start)) => {
      let mut node = ContentNode::new("ordered_list");
      node.attrs.insert("order".to_string(), json!(start));
      node.attrs.insert("tight".to_string(), json!(true));
      node
    }
    Tag::List(None) => {
      let mut node = ContentNode::new("bullet_list");
      node.attrs.insert("tight".to_string(), json!(true));
      node
    }
    Tag::Item => ContentNode::new("list_item"),
    Tag::Image {
      dest_url, title, ..
    } => {
      let mut node = ContentNode::new("image");
      node
        .attrs
        .insert("src".to_string(), json!(dest_url.as_ref()));
      if !title.is_empty() {
        node
          .attrs
          .insert("title".to_string(), json!(title.as_ref()));
      }
      node
    }
    _ => ContentNode::new("paragraph"),
  }
}
