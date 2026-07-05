/// Port of `packages/builder/src/memory/parse.ts` to Rust.
///
/// Implements:
///   - `parse_memory_markdown(text) -> Value`  (array of ImportedMemoryItem)
///   - `memory_graph(items) -> Value`           (MemoryGraph with nodes + edges)
///
/// The logic is a faithful, line-for-line port of the TypeScript original; the fixture
/// `fixtures/ports/memory-cases.json` pins parity against the live TS implementation.
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::OnceLock;

// ─── Regex helpers ─────────────────────────────────────────────────────────────

/// `[[Target]]` or `[[Target|alias]]` — capture target (group 1) and optional alias (group 2).
fn wikilink_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[\[([^\]\[|]+)(?:\|([^\]\[]+))?\]\]").unwrap())
}

/// A #tag: starts after start/whitespace/(, letters/digits/_/-/ (not a markdown heading "# ").
fn tag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?:^|[\s(])#([A-Za-z][\w/-]*)").unwrap())
}

// ─── Kind classification (mirrors KIND_PREFIX + STRIP_PREFIX) ─────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Fact,
    Decision,
    Preference,
    Milestone,
    Episodic,
}

impl Kind {
    fn as_str(self) -> &'static str {
        match self {
            Kind::Fact => "fact",
            Kind::Decision => "decision",
            Kind::Preference => "preference",
            Kind::Milestone => "milestone",
            Kind::Episodic => "episodic",
        }
    }
}

/// Matches the TS KIND_PREFIX array (case-insensitive, optional `[!` prefix, colon or `]`).
fn kind_prefix_re() -> &'static [(Regex, Kind)] {
    static PAIRS: OnceLock<Vec<(Regex, Kind)>> = OnceLock::new();
    PAIRS.get_or_init(|| {
        vec![
            (
                Regex::new(r"(?i)^\s*(?:\[!)?decision[\]:]").unwrap(),
                Kind::Decision,
            ),
            (
                Regex::new(r"(?i)^\s*(?:\[!)?preference[\]:]").unwrap(),
                Kind::Preference,
            ),
            (
                Regex::new(r"(?i)^\s*(?:\[!)?milestone[\]:]").unwrap(),
                Kind::Milestone,
            ),
            (
                Regex::new(r"(?i)^\s*(?:\[!)?(?:episodic|session|log)[\]:]").unwrap(),
                Kind::Episodic,
            ),
            (
                Regex::new(r"(?i)^\s*(?:\[!)?fact[\]:]").unwrap(),
                Kind::Fact,
            ),
        ]
    })
}

/// Strip a recognized leading prefix: a callout `[!kind]` or a bare `Kind`, then an optional `:`.
fn strip_prefix_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\s*(?:\[!?[A-Za-z]+\]|[A-Za-z]+)\s*:?\s*").unwrap())
}

/// Classify a line by its explicit prefix (else fact), stripping the prefix from the text.
fn classify(line: &str) -> (Kind, String) {
    for (re, kind) in kind_prefix_re() {
        if re.is_match(line) {
            let text = strip_prefix_re().replace(line, "").trim().to_string();
            return (*kind, text);
        }
    }
    (Kind::Fact, line.trim().to_string())
}

// ─── dedupe helper ─────────────────────────────────────────────────────────────

fn dedupe(values: impl Iterator<Item = String>) -> Vec<String> {
    let mut result: Vec<String> = Vec::new();
    let mut seen_set: std::collections::HashSet<String> = std::collections::HashSet::new();
    for v in values {
        let v = v.trim().to_string();
        if !v.is_empty() && seen_set.insert(v.clone()) {
            result.push(v);
        }
    }
    result
}

// ─── parseMemoryText ──────────────────────────────────────────────────────────

fn parse_memory_text(text: &str) -> (Vec<String>, Vec<String>) {
    let entities = dedupe(
        wikilink_re()
            .captures_iter(text)
            .map(|c| c.get(1).map(|m| m.as_str().to_string()).unwrap_or_default()),
    );
    let tags = dedupe(
        tag_re()
            .captures_iter(text)
            .map(|c| c.get(1).map(|m| m.as_str().to_string()).unwrap_or_default()),
    );
    (entities, tags)
}

// ─── parseMemoryMarkdown ──────────────────────────────────────────────────────

/// Port of TS `parseMemoryMarkdown`.
///
/// Splits a markdown/plain-text document into structured memory items.
/// Returns a JSON array of `{ text, kind, entities, tags }`.
pub fn parse_memory_markdown(md: &str) -> Value {
    let heading_re = Regex::new(r"^#{1,6}\s").unwrap();
    let bullet_re = Regex::new(r"^[-*+]\s+").unwrap();
    let numbered_re = Regex::new(r"^\d+\.\s+").unwrap();

    let mut items: Vec<Value> = Vec::new();

    for raw in md.split('\n') {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if heading_re.is_match(line) {
            continue; // markdown heading — context, not a fact
        }
        let body = bullet_re.replace(line, "").to_string();
        let body = numbered_re.replace(&body, "").to_string();
        if body.is_empty() {
            continue;
        }
        let (kind, text) = classify(&body);
        if text.is_empty() {
            continue;
        }
        let (entities, tags) = parse_memory_text(&text);
        items.push(json!({
            "text": text,
            "kind": kind.as_str(),
            "entities": entities,
            "tags": tags
        }));
    }

    Value::Array(items)
}

// ─── stripMemoryMarkup ────────────────────────────────────────────────────────

/// Port of TS `stripMemoryMarkup`.
///
/// Renders `[[Target]]`/`[[Target|alias]]` to names and removes #tags.
fn strip_memory_markup(text: &str) -> String {
    // Replace wikilinks: [[Target]] → Target, [[Target|alias]] → alias
    let result = wikilink_re().replace_all(text, |caps: &regex::Captures| {
        let alias = caps.get(2).map(|m| m.as_str().trim().to_string());
        let name = caps
            .get(1)
            .map(|m| m.as_str().trim().to_string())
            .unwrap_or_default();
        alias.unwrap_or(name)
    });

    // Remove #tags — mirror TS: if match starts with whitespace/paren, keep that char; else empty
    let result = tag_re().replace_all(&result, |caps: &regex::Captures| {
        let full_match = caps.get(0).map(|m| m.as_str()).unwrap_or("");
        if full_match.starts_with(|c: char| c.is_whitespace() || c == '(') {
            full_match[..1].to_string()
        } else {
            String::new()
        }
    });

    // Collapse multiple spaces/tabs to one
    let multi_space = Regex::new(r"[ \t]{2,}").unwrap();
    let result = multi_space.replace_all(&result, " ");

    // Remove space before punctuation
    let punct_space = Regex::new(r"\s+([.,;:!?])").unwrap();
    let result = punct_space.replace_all(&result, "$1");

    result.trim().to_string()
}

// ─── memoryGraph ──────────────────────────────────────────────────────────────

/// Port of TS `memoryGraph`.
///
/// `items` is a JSON array of `{ id?, text, kind? }` (MemoryGraphInput).
/// Returns `{ nodes: MemoryGraphNode[], edges: MemoryGraphEdge[] }`.
pub fn memory_graph(items: &Value) -> Value {
    // nodes: insertion-ordered map id → node
    let mut node_order: Vec<String> = Vec::new();
    let mut nodes: HashMap<String, Value> = HashMap::new();
    let mut edges: Vec<Value> = Vec::new();
    let mut seen_edge: std::collections::HashSet<String> = std::collections::HashSet::new();

    let ensure = |id: &str,
                  label: &str,
                  node_type: &str,
                  kind: Option<&str>,
                  node_order: &mut Vec<String>,
                  nodes: &mut HashMap<String, Value>| {
        if !nodes.contains_key(id) {
            let mut node = json!({
                "id": id,
                "label": label,
                "type": node_type,
                "degree": 0
            });
            if let Some(k) = kind {
                node["kind"] = json!(k);
            }
            node_order.push(id.to_string());
            nodes.insert(id.to_string(), node);
        }
    };

    let arr = match items.as_array() {
        Some(a) => a,
        None => return json!({"nodes": [], "edges": []}),
    };

    for (i, item) in arr.iter().enumerate() {
        let id = item["id"]
            .as_str()
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("m{i}"));
        let text = item["text"].as_str().unwrap_or("");
        let kind = item["kind"].as_str();

        // Build display label: strip markup, truncate at 48 chars
        let display = strip_memory_markup(text);
        let label = if display.chars().count() > 48 {
            let truncated: String = display.chars().take(47).collect();
            format!("{truncated}\u{2026}") // …
        } else {
            display.clone()
        };

        let mem_id = format!("mem:{id}");
        ensure(
            &mem_id,
            &label,
            "memory",
            Some(kind.unwrap_or("fact")),
            &mut node_order,
            &mut nodes,
        );

        let (entities, tags) = parse_memory_text(text);

        for e in &entities {
            let ent_id = format!("ent:{}", e.to_lowercase());
            ensure(&ent_id, e, "entity", None, &mut node_order, &mut nodes);
            let edge_key = format!("{mem_id} {ent_id}");
            if !seen_edge.contains(&edge_key) {
                seen_edge.insert(edge_key);
                edges.push(json!({"source": &mem_id, "target": &ent_id}));
                nodes.get_mut(&mem_id).unwrap()["degree"] =
                    json!(nodes[&mem_id]["degree"].as_i64().unwrap_or(0) + 1);
                nodes.get_mut(&ent_id).unwrap()["degree"] =
                    json!(nodes[&ent_id]["degree"].as_i64().unwrap_or(0) + 1);
            }
        }

        for t in &tags {
            let tag_id = format!("tag:{}", t.to_lowercase());
            let tag_label = format!("#{t}");
            ensure(
                &tag_id,
                &tag_label,
                "tag",
                None,
                &mut node_order,
                &mut nodes,
            );
            let edge_key = format!("{mem_id} {tag_id}");
            if !seen_edge.contains(&edge_key) {
                seen_edge.insert(edge_key);
                edges.push(json!({"source": &mem_id, "target": &tag_id}));
                nodes.get_mut(&mem_id).unwrap()["degree"] =
                    json!(nodes[&mem_id]["degree"].as_i64().unwrap_or(0) + 1);
                nodes.get_mut(&tag_id).unwrap()["degree"] =
                    json!(nodes[&tag_id]["degree"].as_i64().unwrap_or(0) + 1);
            }
        }
    }

    // Return nodes in insertion order
    let ordered_nodes: Vec<Value> = node_order.iter().map(|id| nodes[id].clone()).collect();

    json!({
        "nodes": ordered_nodes,
        "edges": edges
    })
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_memory_markdown_skips_headings() {
        let result = parse_memory_markdown("# Heading\n- a bullet fact\n## Sub");
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["text"], "a bullet fact");
        assert_eq!(arr[0]["kind"], "fact");
    }

    #[test]
    fn parse_memory_markdown_blank_input() {
        let result = parse_memory_markdown("");
        assert_eq!(result.as_array().unwrap().len(), 0);
    }

    #[test]
    fn parse_memory_markdown_classifies_kind_prefixes() {
        let md = "Decision: use Postgres\nPreference: dark mode\nplain fact";
        let result = parse_memory_markdown(md);
        let arr = result.as_array().unwrap();
        assert_eq!(arr[0]["kind"], "decision");
        assert_eq!(arr[1]["kind"], "preference");
        assert_eq!(arr[2]["kind"], "fact");
    }

    #[test]
    fn parse_memory_markdown_extracts_entities_and_tags() {
        let result = parse_memory_markdown("chose [[Postgres]] over [[MySQL]] #db");
        let arr = result.as_array().unwrap();
        assert_eq!(arr[0]["entities"], json!(["Postgres", "MySQL"]));
        assert_eq!(arr[0]["tags"], json!(["db"]));
    }

    #[test]
    fn memory_graph_clusters_shared_entities() {
        let items = json!([
            {"id": "a", "text": "chose [[Postgres]] #db", "kind": "decision"},
            {"id": "b", "text": "[[Postgres]] tuning #db #perf", "kind": "fact"}
        ]);
        let g = memory_graph(&items);
        let nodes = g["nodes"].as_array().unwrap();
        let pg = nodes.iter().find(|n| n["id"] == "ent:postgres").unwrap();
        assert_eq!(pg["degree"], 2);
        // No duplicate edges
        let edges = g["edges"].as_array().unwrap();
        let edge_keys: std::collections::HashSet<String> = edges
            .iter()
            .map(|e| format!("{} {}", e["source"], e["target"]))
            .collect();
        assert_eq!(edge_keys.len(), edges.len());
    }

    #[test]
    fn memory_graph_empty_items() {
        let g = memory_graph(&json!([]));
        assert_eq!(g["nodes"].as_array().unwrap().len(), 0);
        assert_eq!(g["edges"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn strip_memory_markup_replaces_wikilinks_removes_tags() {
        let result =
            strip_memory_markup("standardized on [[Postgres]] over [[MongoDB]] #db #infra");
        assert_eq!(result, "standardized on Postgres over MongoDB");
    }

    #[test]
    fn strip_memory_markup_alias() {
        let result = strip_memory_markup("see [[Auth-Service|the auth service]] for #security");
        assert_eq!(result, "see the auth service for");
    }
}
