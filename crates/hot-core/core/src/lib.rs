#![forbid(unsafe_code)]

use aho_corasick::AhoCorasick;
use std::sync::atomic::{AtomicU32, Ordering};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScanMatch {
    pub pattern: usize,
    pub start: usize,
    pub end: usize,
}

pub struct StreamingScanner {
    automaton: AhoCorasick,
    patterns: Vec<String>,
    tail: String,
    consumed: usize,
    maximum_pattern_bytes: usize,
}

impl StreamingScanner {
    pub fn new(patterns: Vec<String>) -> Result<Self, String> {
        if patterns.iter().any(String::is_empty) {
            return Err("scanner patterns cannot be empty".to_owned());
        }
        let maximum_pattern_bytes = patterns.iter().map(String::len).max().unwrap_or(0);
        let automaton = AhoCorasick::new(&patterns).map_err(|error| error.to_string())?;
        Ok(Self {
            automaton,
            patterns,
            tail: String::new(),
            consumed: 0,
            maximum_pattern_bytes,
        })
    }

    pub fn push(&mut self, chunk: &str) -> Vec<ScanMatch> {
        let tail_bytes = self.tail.len();
        let mut window = self.tail.clone();
        window.push_str(chunk);
        let window_origin = self.consumed.saturating_sub(tail_bytes);
        let mut matches = Vec::new();
        for found in self.automaton.find_iter(&window) {
            if found.end() <= tail_bytes {
                continue;
            }
            matches.push(ScanMatch {
                pattern: found.pattern().as_usize(),
                start: window_origin + found.start(),
                end: window_origin + found.end(),
            });
        }
        self.consumed += chunk.len();
        self.tail = utf8_tail(&window, self.maximum_pattern_bytes.saturating_sub(1));
        matches
    }

    pub fn pattern(&self, index: usize) -> Option<&str> {
        self.patterns.get(index).map(String::as_str)
    }
}

fn utf8_tail(value: &str, maximum_bytes: usize) -> String {
    let mut start = value.len().saturating_sub(maximum_bytes);
    while start < value.len() && !value.is_char_boundary(start) {
        start += 1;
    }
    value[start..].to_owned()
}

pub fn digest(input: &[u8]) -> String {
    format!("blake3:{}", blake3::hash(input).to_hex())
}

pub fn chain_link(previous: Option<&str>, payload: &[u8]) -> String {
    let mut hasher = blake3::Hasher::new();
    if let Some(value) = previous {
        hasher.update(value.as_bytes());
    }
    hasher.update(payload);
    format!("blake3:{}", hasher.finalize().to_hex())
}

pub fn merkle_root(leaves: &[String]) -> String {
    if leaves.is_empty() {
        return digest(&[]);
    }
    let mut level = leaves.to_vec();
    while level.len() > 1 {
        level = level
            .chunks(2)
            .map(|pair| {
                let right = pair.get(1).unwrap_or(&pair[0]);
                chain_link(Some(&pair[0]), right.as_bytes())
            })
            .collect();
    }
    level[0].clone()
}

pub struct EpochTable {
    counters: Vec<AtomicU32>,
}

impl EpochTable {
    pub fn new(size: usize) -> Self {
        Self {
            counters: (0..size).map(|_| AtomicU32::new(0)).collect(),
        }
    }

    pub fn read(&self, index: usize) -> Option<u32> {
        self.counters
            .get(index)
            .map(|value| value.load(Ordering::Acquire))
    }

    pub fn bump(&self, index: usize) -> Option<u32> {
        self.counters
            .get(index)
            .map(|value| value.fetch_add(1, Ordering::AcqRel) + 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_patterns_across_chunks() {
        let mut scanner = StreamingScanner::new(vec!["secret".to_owned()]).unwrap();
        assert!(scanner.push("secr").is_empty());
        assert_eq!(scanner.push("et")[0].start, 0);
    }

    #[test]
    fn bumps_epochs_monotonically() {
        let table = EpochTable::new(2);
        assert_eq!(table.bump(1), Some(1));
        assert_eq!(table.bump(1), Some(2));
        assert_eq!(table.read(1), Some(2));
    }
}
