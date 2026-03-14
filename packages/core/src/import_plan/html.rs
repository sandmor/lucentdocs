use crate::import_plan::fence::{is_fence_line, update_fence_state};
use crate::import_plan::text::{
  choose_backtick_fence, collapse_triple_newlines, escape_markdown_label,
  escape_markdown_link_destination, escape_markdown_title,
};
use crate::MarkdownRawHtmlMode;
use scraper::{Html, Node};

fn is_likely_html_block_line(line: &str) -> bool {
  let trimmed_start = line.trim_start();
  if !trimmed_start.starts_with('<') {
    return false;
  }
  if !trimmed_start.contains('>') {
    return false;
  }
  let collapsed = trimmed_start.trim();
  if collapsed.starts_with("<!--") && collapsed.contains("-->") {
    return true;
  }

  let tag = match parse_html_tag_name(collapsed) {
    Some(name) => name,
    None => return false,
  };

  let is_common_block =
    matches!(
      tag.as_str(),
      "p"
        | "div"
        | "table"
        | "thead"
        | "tbody"
        | "tfoot"
        | "tr"
        | "td"
        | "th"
        | "ul"
        | "ol"
        | "li"
        | "blockquote"
        | "pre"
        | "code"
        | "img"
        | "a"
        | "section"
        | "article"
        | "details"
        | "summary"
        | "figure"
        | "figcaption"
    ) || (tag.starts_with('h') && tag.len() == 2 && matches!(tag.as_bytes()[1], b'1'..=b'6'));

  if is_common_block {
    return true;
  }

  collapsed.ends_with('>')
}

fn parse_html_tag_name(input: &str) -> Option<String> {
  let s = input.trim_start();
  let mut chars = s.chars();
  if chars.next()? != '<' {
    return None;
  }

  let mut i = 1usize;
  let chars: Vec<char> = s.chars().collect();
  while i < chars.len() && (chars[i].is_whitespace() || chars[i] == '/') {
    i += 1;
  }
  if i >= chars.len() || !chars[i].is_ascii_alphabetic() {
    return None;
  }
  let start = i;
  i += 1;
  while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '-') {
    i += 1;
  }
  Some(chars[start..i].iter().collect::<String>().to_lowercase())
}

fn choose_non_colliding_marker(haystack: &str, base: &str) -> String {
  if !haystack.contains(base) {
    return base.to_string();
  }
  for i in 0..50 {
    let marker = format!("{base}_{i}");
    if !haystack.contains(&marker) {
      return marker;
    }
  }
  let mut counter = 0usize;
  loop {
    let marker = format!("{base}_{counter}");
    if !haystack.contains(&marker) {
      return marker;
    }
    counter += 1;
  }
}

fn protect_inline_code_spans(input: &str) -> (String, impl Fn(&str) -> String) {
  let marker = choose_non_colliding_marker(input, "@@LUCENT_CODE_SPAN@@");
  let mut replacements: Vec<(String, String)> = Vec::new();
  let chars: Vec<char> = input.chars().collect();
  let mut out = String::with_capacity(input.len());

  let mut i = 0usize;
  let mut index = 0usize;
  while i < chars.len() {
    if chars[i] != '`' {
      out.push(chars[i]);
      i += 1;
      continue;
    }

    let run_len = chars[i..].iter().take_while(|&&c| c == '`').count();
    let start = i;
    let mut j = i + run_len;

    let mut found_end = None;
    while j < chars.len() {
      if chars[j] != '`' {
        j += 1;
        continue;
      }
      let close_len = chars[j..].iter().take_while(|&&c| c == '`').count();
      if close_len == run_len {
        found_end = Some(j + close_len);
        break;
      }
      j += close_len.max(1);
    }

    if let Some(end) = found_end {
      let original: String = chars[start..end].iter().collect();
      let token = format!("{marker}{index}{marker}");
      index += 1;
      replacements.push((token.clone(), original));
      out.push_str(&token);
      i = end;
    } else {
      out.push('`');
      i += 1;
    }
  }

  let restore = move |value: &str| -> String {
    let mut restored = value.to_string();
    for (token, original) in &replacements {
      restored = restored.replace(token, original);
    }
    restored
  };

  (out, restore)
}

fn is_autolink_value(value: &str) -> bool {
  if value.contains(char::is_whitespace) {
    return false;
  }
  let lower = value.to_lowercase();
  if lower.starts_with("mailto:") {
    return true;
  }
  if lower.contains("://") {
    return true;
  }
  value.contains('@')
}

fn protect_markdown_autolinks(input: &str) -> (String, impl Fn(&str) -> String) {
  let marker = choose_non_colliding_marker(input, "@@LUCENT_AUTOLINK@@");
  let mut replacements: Vec<(String, String)> = Vec::new();
  let chars: Vec<char> = input.chars().collect();
  let mut out = String::with_capacity(input.len());

  let mut i = 0usize;
  let mut index = 0usize;
  while i < chars.len() {
    if chars[i] != '<' {
      out.push(chars[i]);
      i += 1;
      continue;
    }

    let start = i;
    let mut j = i + 1;
    while j < chars.len() && chars[j] != '>' {
      j += 1;
    }
    if j >= chars.len() {
      out.push('<');
      i += 1;
      continue;
    }

    let inner: String = chars[start + 1..j].iter().collect();
    if is_autolink_value(inner.trim()) {
      let original: String = chars[start..=j].iter().collect();
      let token = format!("{marker}{index}{marker}");
      index += 1;
      replacements.push((token.clone(), original));
      out.push_str(&token);
      i = j + 1;
      continue;
    }

    out.push('<');
    i += 1;
  }

  let restore = move |value: &str| -> String {
    let mut restored = value.to_string();
    for (token, original) in &replacements {
      restored = restored.replace(token, original);
    }
    restored
  };

  (out, restore)
}

fn has_html_tag_like(line: &str) -> bool {
  if !(line.contains('<') && line.contains('>')) {
    return false;
  }
  let chars: Vec<char> = line.chars().collect();
  let mut i = 0usize;
  while i < chars.len() {
    if chars[i] != '<' {
      i += 1;
      continue;
    }
    i += 1;
    while i < chars.len() && chars[i].is_whitespace() {
      i += 1;
    }
    if i < chars.len() && chars[i] == '/' {
      i += 1;
      while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
      }
    }
    if i < chars.len() && chars[i].is_ascii_alphabetic() {
      return true;
    }
  }
  false
}

fn render_inline_from_html_node(node: ego_tree::NodeRef<Node>) -> String {
  match node.value() {
    Node::Text(text) => text.text.to_string(),
    Node::Element(el) => {
      let tag = el.name().to_lowercase();
      let children: Vec<String> = node.children().map(render_inline_from_html_node).collect();
      let children_text = children.join("");

      match tag.as_str() {
        "br" => "\\\n".to_string(),
        "strong" | "b" => format!("**{}**", children_text),
        "em" | "i" => format!("*{}*", children_text),
        "code" => format!("`{}`", children_text),
        "a" => {
          let href = el.attr("href").or_else(|| el.attr("data-href"));
          let text = children_text.trim().to_string();
          match href {
            Some(h) => {
              let label = escape_markdown_label(if text.is_empty() { h } else { &text });
              let dest = escape_markdown_link_destination(h);
              format!("[{}]({})", label, dest)
            }
            None => text,
          }
        }
        "img" => {
          let src = el.attr("src").or_else(|| el.attr("data-src"));
          match src {
            Some(s) => {
              let alt = el.attr("alt").unwrap_or("");
              let title = el.attr("title");
              let title_suffix = match title {
                Some(t) => format!(" \"{}\"", escape_markdown_title(t)),
                None => String::new(),
              };
              format!(
                "![{}]({}{})",
                escape_markdown_label(alt),
                escape_markdown_link_destination(s),
                title_suffix
              )
            }
            None => String::new(),
          }
        }
        _ => children_text,
      }
    }
    _ => node
      .children()
      .map(render_inline_from_html_node)
      .collect::<Vec<_>>()
      .join(""),
  }
}

fn is_unsafe_or_unsupported_html_container(tag: &str) -> bool {
  matches!(
    tag,
    "table"
      | "thead"
      | "tbody"
      | "tfoot"
      | "tr"
      | "td"
      | "th"
      | "details"
      | "summary"
      | "iframe"
      | "script"
      | "style"
      | "object"
      | "embed"
  )
}

fn node_to_html(node: ego_tree::NodeRef<Node>) -> String {
  let mut html = String::new();
  match node.value() {
    Node::Element(el) => {
      html.push_str(&format!("<{}", el.name()));
      for (k, v) in el.attrs() {
        html.push_str(&format!(" {}=\"{}\"", k, v.replace('"', "&quot;")));
      }
      html.push('>');
      for child in node.children() {
        html.push_str(&node_to_html(child));
      }
      html.push_str(&format!("</{}>", el.name()));
    }
    Node::Text(t) => html.push_str(&t.text),
    _ => {
      for child in node.children() {
        html.push_str(&node_to_html(child));
      }
    }
  }
  html
}

fn text_content(node: ego_tree::NodeRef<Node>) -> String {
  match node.value() {
    Node::Text(t) => t.text.to_string(),
    _ => node
      .children()
      .map(text_content)
      .collect::<Vec<_>>()
      .join(""),
  }
}

fn render_block_from_html_node(
  node: ego_tree::NodeRef<Node>,
  indent: &str,
  raw_html_mode: MarkdownRawHtmlMode,
) -> String {
  if let Node::Text(text) = node.value() {
    return text.text.to_string();
  }

  let tag = match node.value() {
    Node::Element(el) => el.name().to_lowercase(),
    _ => String::new(),
  };

  if !tag.is_empty() && is_unsafe_or_unsupported_html_container(&tag) {
    if raw_html_mode == MarkdownRawHtmlMode::Drop {
      let text = text_content(node).trim().to_string();
      return if text.is_empty() {
        String::new()
      } else {
        format!("{indent}{text}\n\n")
      };
    }
    let html = node_to_html(node);
    let fence = choose_backtick_fence(&html, 3);
    return format!("{indent}{fence}html\n{html}\n{indent}{fence}\n\n");
  }

  if tag == "pre" {
    let mut language: Option<String> = None;
    let mut code_node = None;
    for child in node.children() {
      if let Node::Element(el) = child.value() {
        if el.name().to_lowercase() == "code" {
          code_node = Some(child);
          if let Some(class_attr) = el.attr("class") {
            let lower = class_attr.to_lowercase();
            for part in lower.split_whitespace() {
              if let Some(lang) = part.strip_prefix("language-") {
                if !lang.is_empty() {
                  language = Some(lang.to_string());
                }
                break;
              }
            }
          }
          break;
        }
      }
    }
    let code_text = match code_node {
      Some(n) => text_content(n),
      None => text_content(node),
    };
    let fence = choose_backtick_fence(&code_text, 3);
    let info = language.unwrap_or_default();
    let code_trimmed = code_text.strip_suffix('\n').unwrap_or(&code_text);
    return format!("{indent}{fence}{info}\n{code_trimmed}\n{indent}{fence}\n\n");
  }

  if tag == "img" {
    let inline = render_inline_from_html_node(node).trim().to_string();
    return if inline.is_empty() {
      String::new()
    } else {
      format!("{indent}{inline}\n\n")
    };
  }

  if tag == "blockquote" {
    let inner = node
      .children()
      .map(|c| render_block_from_html_node(c, indent, raw_html_mode))
      .collect::<Vec<_>>()
      .join("")
      .trim()
      .to_string();
    let quoted = inner
      .split('\n')
      .map(|line| {
        if line.is_empty() {
          ">".to_string()
        } else {
          format!("> {line}")
        }
      })
      .collect::<Vec<_>>()
      .join("\n");
    return format!("{indent}{quoted}\n\n");
  }

  if tag.len() == 2 && tag.starts_with('h') && matches!(tag.as_bytes()[1], b'1'..=b'6') {
    let level = (tag.as_bytes()[1] - b'0') as usize;
    let hashes = "#".repeat(level.clamp(1, 6));
    let text = node
      .children()
      .map(render_inline_from_html_node)
      .collect::<Vec<_>>()
      .join("")
      .trim()
      .to_string();
    return format!("{indent}{hashes} {text}\n\n");
  }

  if tag == "hr" {
    return format!("{indent}---\n\n");
  }

  if tag == "ul" || tag == "ol" {
    let is_ordered = tag == "ol";
    let mut lines: Vec<String> = Vec::new();
    let mut item_index = 0usize;
    for child in node.children() {
      let is_li = matches!(child.value(), Node::Element(el) if el.name().to_lowercase() == "li");
      if !is_li {
        continue;
      }
      item_index += 1;
      let bullet = if is_ordered {
        format!("{item_index}.")
      } else {
        "-".to_string()
      };

      let mut text_parts: Vec<String> = Vec::new();
      let mut nested_blocks: Vec<String> = Vec::new();
      for li_child in child.children() {
        let is_nested_list = matches!(
            li_child.value(),
            Node::Element(el) if {
                let t = el.name().to_lowercase();
                t == "ul" || t == "ol"
            }
        );
        if is_nested_list {
          nested_blocks.push(
            render_block_from_html_node(li_child, &format!("{indent}  "), raw_html_mode)
              .trim_end()
              .to_string(),
          );
        } else {
          text_parts.push(render_inline_from_html_node(li_child));
        }
      }
      let line = format!("{indent}{bullet} {}", text_parts.join("").trim());
      lines.push(line.trim_end().to_string());
      if !nested_blocks.is_empty() {
        let nested = nested_blocks
          .join("\n")
          .split('\n')
          .map(|l| {
            if l.is_empty() {
              l.to_string()
            } else {
              format!("{indent}  {l}")
            }
          })
          .collect::<Vec<_>>()
          .join("\n");
        lines.push(nested);
      }
    }
    return format!("{}\n\n", lines.join("\n"));
  }

  if matches!(
    tag.as_str(),
    "p" | "div" | "section" | "article" | "header" | "footer" | "main" | "aside"
  ) {
    let text = node
      .children()
      .map(render_inline_from_html_node)
      .collect::<Vec<_>>()
      .join("")
      .trim()
      .to_string();
    return if text.is_empty() {
      String::new()
    } else {
      format!("{indent}{text}\n\n")
    };
  }

  if matches!(tag.as_str(), "html" | "head" | "body") {
    return node
      .children()
      .map(|c| render_block_from_html_node(c, indent, raw_html_mode))
      .collect::<Vec<_>>()
      .join("");
  }

  let as_inline = node
    .children()
    .map(render_inline_from_html_node)
    .collect::<Vec<_>>()
    .join("")
    .trim()
    .to_string();
  if as_inline.is_empty() {
    String::new()
  } else {
    format!("{indent}{as_inline}\n\n")
  }
}

fn html_to_markdown_block(html: &str, raw_html_mode: MarkdownRawHtmlMode) -> String {
  let fragment = Html::parse_fragment(html);
  let rendered = fragment
    .tree
    .root()
    .children()
    .map(|n| render_block_from_html_node(n, "", raw_html_mode))
    .collect::<Vec<_>>()
    .join("");
  collapse_triple_newlines(&rendered).trim().to_string()
}

fn html_to_markdown_inline(html: &str) -> String {
  let fragment = Html::parse_fragment(html);
  fragment
    .tree
    .root()
    .children()
    .map(render_inline_from_html_node)
    .collect::<Vec<_>>()
    .join("")
}

fn convert_html_blocks_to_plain_text(markdown: &str, raw_html_mode: MarkdownRawHtmlMode) -> String {
  let lines: Vec<&str> = markdown.split('\n').collect();
  let mut in_fence = None;
  let mut out: Vec<String> = Vec::new();

  let mut html_block: Option<Vec<String>> = None;
  let flush = |out: &mut Vec<String>, html_block: &mut Option<Vec<String>>| {
    let Some(block) = html_block.take() else {
      return;
    };
    if block.is_empty() {
      return;
    }
    let joined = block.join("\n");
    let converted = html_to_markdown_block(&joined, raw_html_mode);
    if !converted.is_empty() {
      out.push(converted);
    }
  };

  for line in lines {
    if is_fence_line(line).is_some() {
      flush(&mut out, &mut html_block);
      update_fence_state(&mut in_fence, line);
      out.push(line.to_string());
      continue;
    }

    if in_fence.is_some() {
      flush(&mut out, &mut html_block);
      out.push(line.to_string());
      continue;
    }

    let trimmed = line.trim();
    if trimmed.is_empty() {
      flush(&mut out, &mut html_block);
      out.push(line.to_string());
      continue;
    }

    if is_likely_html_block_line(line) {
      html_block
        .get_or_insert_with(Vec::new)
        .push(line.to_string());
      continue;
    }

    flush(&mut out, &mut html_block);

    if has_html_tag_like(line) {
      let (protected_code, restore_code) = protect_inline_code_spans(line);
      let (protected_links, restore_links) = protect_markdown_autolinks(&protected_code);
      let converted = html_to_markdown_inline(&protected_links);
      out.push(restore_code(&restore_links(&converted)));
      continue;
    }

    out.push(line.to_string());
  }

  flush(&mut out, &mut html_block);
  out.join("\n")
}

pub(crate) fn normalize_html_in_markdown(
  markdown: &str,
  raw_html_mode: MarkdownRawHtmlMode,
) -> String {
  convert_html_blocks_to_plain_text(markdown, raw_html_mode)
}
