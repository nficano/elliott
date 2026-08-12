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
    pattern_character_lengths: Vec<usize>,
    tail: String,
    consumed_characters: usize,
    maximum_pattern_bytes: usize,
}

impl StreamingScanner {
    pub fn new(patterns: Vec<String>) -> Result<Self, String> {
        if patterns.iter().any(String::is_empty) {
            return Err("scanner patterns cannot be empty".to_owned());
        }
        let maximum_pattern_bytes = patterns.iter().map(String::len).max().unwrap_or(0);
        let pattern_character_lengths = patterns
            .iter()
            .map(|pattern| pattern.chars().count())
            .collect();
        let automaton = AhoCorasick::new(&patterns).map_err(|error| error.to_string())?;
        Ok(Self {
            automaton,
            patterns,
            pattern_character_lengths,
            tail: String::new(),
            consumed_characters: 0,
            maximum_pattern_bytes,
        })
    }

    pub fn push(&mut self, chunk: &str) -> Vec<ScanMatch> {
        let tail_bytes = self.tail.len();
        let tail_characters = self.tail.chars().count();
        let mut window = self.tail.clone();
        window.push_str(chunk);
        let window_origin = self.consumed_characters.saturating_sub(tail_characters);
        let mut byte_matches = Vec::new();
        for found in self.automaton.find_overlapping_iter(&window) {
            if found.end() <= tail_bytes {
                continue;
            }
            byte_matches.push((found.pattern().as_usize(), found.end()));
        }
        byte_matches.sort_by_key(|found| (found.1, found.0));
        let mut byte_offset = 0;
        let mut character_offset = 0;
        let mut matches = Vec::with_capacity(byte_matches.len());
        for (pattern, end_byte) in byte_matches {
            while byte_offset < end_byte {
                let character = window[byte_offset..]
                    .chars()
                    .next()
                    .expect("match byte offset must be within the scan window");
                byte_offset += character.len_utf8();
                character_offset += 1;
            }
            let end = window_origin + character_offset;
            let pattern_length = self.pattern_character_lengths[pattern];
            matches.push(ScanMatch {
                pattern,
                start: end.saturating_sub(pattern_length),
                end,
            });
        }
        self.consumed_characters += chunk.chars().count();
        self.tail = utf8_tail(&window, self.maximum_pattern_bytes.saturating_sub(1));
        matches
    }

    pub fn reset(&mut self) {
        self.tail.clear();
        self.consumed_characters = 0;
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
    fn reports_overlapping_patterns_in_stream_order() {
        let mut scanner =
            StreamingScanner::new(vec!["aba".to_owned(), "ba".to_owned(), "a".to_owned()]).unwrap();
        assert_eq!(
            scanner.push("ababa"),
            vec![
                ScanMatch {
                    pattern: 2,
                    start: 0,
                    end: 1,
                },
                ScanMatch {
                    pattern: 0,
                    start: 0,
                    end: 3,
                },
                ScanMatch {
                    pattern: 1,
                    start: 1,
                    end: 3,
                },
                ScanMatch {
                    pattern: 2,
                    start: 2,
                    end: 3,
                },
                ScanMatch {
                    pattern: 0,
                    start: 2,
                    end: 5,
                },
                ScanMatch {
                    pattern: 1,
                    start: 3,
                    end: 5,
                },
                ScanMatch {
                    pattern: 2,
                    start: 4,
                    end: 5,
                },
            ]
        );
    }

    #[test]
    fn uses_unicode_scalar_offsets_and_resets() {
        let mut scanner = StreamingScanner::new(vec!["💥é".to_owned()]).unwrap();
        assert!(scanner.push("a💥").is_empty());
        assert_eq!(
            scanner.push("é"),
            vec![ScanMatch {
                pattern: 0,
                start: 1,
                end: 3,
            }]
        );
        scanner.reset();
        assert_eq!(scanner.push("💥é")[0].end, 2);
    }

    #[test]
    fn scans_match_dense_input_without_recounting_prefixes() {
        let input = "a".repeat(16_384);
        let mut scanner = StreamingScanner::new(vec!["a".to_owned()]).unwrap();
        assert_eq!(scanner.push(&input).len(), input.len());
    }

    #[test]
    fn bumps_epochs_monotonically() {
        let table = EpochTable::new(2);
        assert_eq!(table.bump(1), Some(1));
        assert_eq!(table.bump(1), Some(2));
        assert_eq!(table.read(1), Some(2));
    }
}
