pub(crate) fn extract_yaml_frontmatter(markdown: &str) -> (String, String) {
  if !markdown.starts_with("---\n") && markdown.trim() != "---" {
    return ("".to_string(), markdown.to_string());
  }
  let lines: Vec<&str> = markdown.split('\n').collect();
  if lines.is_empty() || lines[0].trim() != "---" {
    return ("".to_string(), markdown.to_string());
  }
  for (i, line) in lines.iter().enumerate().skip(1) {
    if line.trim() == "---" {
      let frontmatter = lines[0..=i].join("\n") + "\n";
      let body = lines[i + 1..].join("\n");
      return (frontmatter, body);
    }
  }
  ("".to_string(), markdown.to_string())
}
