//! 공용 표본 (fixtures/) 과 content 왕복 시험.

use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

fn sorted(dir: &Path, suffix: &str) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.file_name().unwrap().to_string_lossy().ends_with(suffix))
        .collect();
    v.sort();
    v
}

#[test]
fn good_fixtures_match_json() {
    let mut n = 0;
    for p in sorted(&fixtures(), ".gsd") {
        let name = p.file_name().unwrap().to_string_lossy().to_string();
        if name.ends_with(".bad.gsd") {
            continue;
        }
        let text = fs::read_to_string(&p).unwrap();
        let want: Value =
            serde_json::from_str(&fs::read_to_string(p.with_extension("json")).unwrap()).unwrap();
        let got = gsd::parse(&text).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(got, want, "{name}");
        n += 1;
    }
    assert!(n >= 10, "표본이 너무 적다: {n}");
}

#[test]
fn bad_fixtures_fail_on_line() {
    let mut n = 0;
    for p in sorted(&fixtures(), ".bad.gsd") {
        let name = p.file_name().unwrap().to_string_lossy().to_string();
        let text = fs::read_to_string(&p).unwrap();
        let want: usize = fs::read_to_string(p.with_extension("line"))
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        match gsd::parse(&text) {
            Ok(_) => panic!("{name}: 오류가 나야 한다"),
            Err(e) => assert_eq!(e.line, want, "{name}: {e}"),
        }
        n += 1;
    }
    assert!(n >= 10, "틀린 표본이 너무 적다: {n}");
}

#[test]
fn from_str_typed() {
    #[derive(serde::Deserialize, PartialEq, Debug)]
    struct Row {
        id: i64,
        name: String,
    }
    let rows: Vec<Row> = gsd::from_str("@sheet .\nid:int | name:str\n1 | a\n2 | b c\n").unwrap();
    assert_eq!(
        rows,
        vec![
            Row {
                id: 1,
                name: "a".into()
            },
            Row {
                id: 2,
                name: "b c".into()
            }
        ]
    );
    assert!(gsd::from_str::<Vec<Row>>("@props\n.: [int] = [1]\n").is_err());
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    for e in fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() {
            walk(&p, out);
        } else if p.extension().is_some_and(|x| x == "gsd") {
            out.push(p);
        }
    }
}

/// JSON 과 같은 트리인가 — 객체 키 차례는 무시하고, 값이 같은 i64/f64 는 같다고 본다 (JS 의 수와 같게).
/// 정수 꼴 실수만 다른 곳은 `soft` 로 센다.
fn same(a: &Value, b: &Value, soft: &mut usize) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            if x == y {
                true
            } else if x.as_f64() == y.as_f64() {
                *soft += 1;
                true
            } else {
                false
            }
        }
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same(p, q, soft))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(k, v)| y.get(k).is_some_and(|w| same(v, w, soft)))
        }
        _ => a == b,
    }
}

/// `GSD_ROUNDTRIP_DIR` (node tools/gsd-roundtrip.mjs --out <폴더> 로 뽑은 .gsd 들) 이 있을 때만:
/// 각 .gsd 를 읽어 content 의 같은 이름 .json 과 견준다. `GSD_CONTENT_DIR` 로 content 위치를 바꾼다.
#[test]
fn content_roundtrip() {
    let Ok(dir) = std::env::var("GSD_ROUNDTRIP_DIR") else {
        return;
    };
    let content = std::env::var("GSD_CONTENT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../content"));
    let mut files = vec![];
    walk(Path::new(&dir), &mut files);
    files.sort();
    assert!(!files.is_empty(), "{dir} 에 .gsd 가 없다");
    let (mut ok, mut soft) = (0, 0);
    let mut bad = vec![];
    let (mut t_gsd, mut t_json) = (std::time::Duration::ZERO, std::time::Duration::ZERO);
    let (mut b_gsd, mut b_json) = (0usize, 0usize);
    for f in &files {
        let rel = f.strip_prefix(&dir).unwrap();
        let text = fs::read_to_string(f).unwrap();
        let raw = fs::read_to_string(content.join(rel).with_extension("json")).unwrap();
        let t = std::time::Instant::now();
        let got = gsd::parse(&text);
        t_gsd += t.elapsed();
        let t = std::time::Instant::now();
        let want: Value = serde_json::from_str(&raw).unwrap();
        t_json += t.elapsed();
        b_gsd += text.len();
        b_json += raw.len();
        match got {
            Ok(g) if same(&g, &want, &mut soft) => ok += 1,
            Ok(_) => bad.push(format!("{}: 트리가 다르다", rel.display())),
            Err(e) => bad.push(format!("{}: {e}", rel.display())),
        }
    }
    println!(
        "content 왕복: {}개 중 통과 {ok}, 틀림 {} (정수꼴 실수 차이 {soft}곳)\n  GSD {b_gsd}B 읽기 {t_gsd:?} / JSON {b_json}B 읽기 {t_json:?}",
        files.len(),
        bad.len()
    );
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}
