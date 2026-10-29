//! GSD 읽기 파서. 명세는 `SPEC.md`, 기준 구현은 `packages/core/src/gsd.ts`.
//! 읽으면 JSON 과 같은 트리(`serde_json::Value`)가 나온다. 쓰기는 없다 (정규 출력은 TS 에만).
//! 게임 crate 를 의존하지 않는다 (나중에 따로 떼어 낼 수 있게).
//!
//! 수: `int` 는 안전 정수(±2^53-1)만, `num` 과 `any` 는 JS 의 수처럼 읽는다 — 소수·지수 글이어도 값이
//! 안전 범위의 정수면 정수(i64)로 낸다 (`1.0` → `1`). 그래서 JSON 에서 읽은 값과 같은 트리가 된다.

use serde::de::DeserializeOwned;
use serde_json::{Map, Number, Value};
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::rc::Rc;

/// 읽기 오류: 줄(1부터)·칸(1부터, 없을 수 있다)·한국어 메시지.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GsdError {
    pub line: usize,
    pub col: Option<usize>,
    pub message: String,
}

impl fmt::Display for GsdError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.col {
            Some(c) => write!(f, "줄 {}:칸 {} — {}", self.line, c, self.message),
            None => write!(f, "줄 {} — {}", self.line, self.message),
        }
    }
}

impl std::error::Error for GsdError {}

type R<T> = Result<T, GsdError>;

/// GSD 글을 읽어 값 트리로.
pub fn parse(text: &str) -> Result<Value, GsdError> {
    Parser::default().run(text)
}

/// GSD 글을 읽어 타입으로 (값 트리를 거쳐 `from_value`).
pub fn from_str<T: DeserializeOwned>(text: &str) -> Result<T, GsdError> {
    let v = parse(text)?;
    serde_json::from_value(v).map_err(|e| GsdError {
        line: 0,
        col: None,
        message: format!("읽은 값을 타입으로 바꾸지 못했다: {e}"),
    })
}

// ───────── 타입 모델 ─────────

#[derive(Debug)]
enum T {
    Int,
    Num,
    Str, // enum(..)·ref(..) 도 글과 같다
    Bool,
    Any,
    List(Ty),
    Rec(Vec<Field>),
    Named(String),
    Sum(Vec<Vec<Field>>),
}
type Ty = Rc<T>;

#[derive(Debug)]
struct Field {
    name: String,
    ty: Ty,
    optional: bool,
}

struct Column {
    path: Vec<String>,
    ty: Ty,
    optional: bool,
}

// ───────── 글자 분류 ─────────

fn is_sp(c: char) -> bool {
    c == ' ' || c == '\t'
}
/// JS 의 `\s`
fn is_ws(c: char) -> bool {
    c.is_whitespace() || c == '\u{feff}'
}
fn key_bad(c: char) -> bool {
    is_ws(c) || "=;{}[]\"|:.#@~()?,\\".contains(c)
}
fn type_word_bad(c: char) -> bool {
    is_ws(c) || "()[]{}:?|=\",".contains(c)
}
fn is_blank(l: &str) -> bool {
    l.chars().all(is_sp)
}
fn trim_start_ws(l: &str) -> &str {
    l.trim_start_matches(is_ws)
}
fn is_comment(l: &str) -> bool {
    trim_start_ws(l).starts_with('#')
}
fn path_text(p: &[String]) -> String {
    if p.is_empty() {
        ".".into()
    } else {
        p.join(".")
    }
}

const SAFE: u128 = 9_007_199_254_740_991;

// ───────── 커서 ─────────

struct Cur {
    s: Vec<char>,
    i: usize,
    line: usize,
}

impl Cur {
    fn new(s: &str, line: usize) -> Self {
        Cur {
            s: s.chars().collect(),
            i: 0,
            line,
        }
    }
    fn eol(&self) -> bool {
        self.i >= self.s.len()
    }
    fn peek(&self) -> Option<char> {
        self.s.get(self.i).copied()
    }
    fn at(&self, k: usize) -> Option<char> {
        self.s.get(self.i + k).copied()
    }
    fn skip(&mut self) {
        while self.i < self.s.len() && is_sp(self.s[self.i]) {
            self.i += 1;
        }
    }
    fn err(&self, msg: &str, at: usize) -> GsdError {
        GsdError {
            line: self.line,
            col: Some(at + 1),
            message: msg.to_string(),
        }
    }
    fn fail<X>(&self, msg: &str) -> R<X> {
        Err(self.err(msg, self.i))
    }
    fn fail_at<X>(&self, msg: &str, at: usize) -> R<X> {
        Err(self.err(msg, at))
    }
    fn expect(&mut self, ch: char) -> R<()> {
        if self.peek() != Some(ch) {
            return self.fail(&format!("`{ch}` 가 와야 한다"));
        }
        self.i += 1;
        Ok(())
    }
    fn starts_with(&self, w: &str) -> bool {
        w.chars().enumerate().all(|(k, ch)| self.at(k) == Some(ch))
    }
    fn slice(&self, a: usize, b: usize) -> String {
        self.s[a..b].iter().collect()
    }
}

fn read_quoted(c: &mut Cur) -> R<String> {
    let st = c.i;
    c.i += 1;
    let mut o = String::new();
    loop {
        if c.eol() {
            return c.fail_at("닫는 따옴표가 없다", st);
        }
        let ch = c.s[c.i];
        if ch == '"' {
            c.i += 1;
            return Ok(o);
        }
        if ch == '\\' {
            match c.at(1) {
                Some(e @ ('"' | '\\' | '/')) => o.push(e),
                Some('n') => o.push('\n'),
                Some('r') => o.push('\r'),
                Some('t') => o.push('\t'),
                Some('u') => {
                    let hex = |c: &Cur, k: usize| -> Option<u32> {
                        let mut v = 0u32;
                        for j in 0..4 {
                            v = v * 16 + c.at(k + j)?.to_digit(16)?;
                        }
                        Some(v)
                    };
                    let Some(u) = hex(c, 2) else {
                        return c.fail("\\u 뒤에 16진수 네 자리가 와야 한다");
                    };
                    c.i += 4;
                    if (0xD800..0xDC00).contains(&u)
                        && c.at(2) == Some('\\')
                        && c.at(3) == Some('u')
                    {
                        // 짝 서로게이트는 한 글자로 합친다
                        if let Some(lo) = hex(c, 4).filter(|l| (0xDC00..0xE000).contains(l)) {
                            let cp = 0x10000 + ((u - 0xD800) << 10) + (lo - 0xDC00);
                            o.push(char::from_u32(cp).unwrap_or('\u{fffd}'));
                            c.i += 6;
                            c.i += 2;
                            continue;
                        }
                    }
                    // 홀로 선 서로게이트는 Rust 글에 못 담아 대체 문자로
                    o.push(char::from_u32(u).unwrap_or('\u{fffd}'));
                }
                _ => return c.fail("모르는 이스케이프 (\\\" \\\\ \\n \\r \\t \\uXXXX 만)"),
            }
            c.i += 2;
            continue;
        }
        o.push(ch);
        c.i += 1;
    }
}

fn read_key(c: &mut Cur) -> R<String> {
    if c.peek() == Some('"') {
        return read_quoted(c);
    }
    let st = c.i;
    while !c.eol() && !key_bad(c.s[c.i]) {
        c.i += 1;
    }
    if c.i == st {
        return c.fail("이름이 와야 한다 (특수문자가 든 이름은 따옴표로)");
    }
    Ok(c.slice(st, c.i))
}

fn read_path(c: &mut Cur) -> R<Vec<String>> {
    if c.peek() == Some('.') {
        let n = c.at(1);
        if n.is_none() || n.is_some_and(is_sp) || n == Some(':') {
            c.i += 1;
            return Ok(vec![]);
        }
    }
    let mut segs = vec![read_key(c)?];
    while c.peek() == Some('.') {
        c.i += 1;
        segs.push(read_key(c)?);
    }
    Ok(segs)
}

// ───────── 지시문 (@enum @ref @doc) ─────────

/// 지시문이 겹쳐 선언되는지 보려고 이름만 모아 둔다.
#[derive(Default)]
struct Seen {
    enums: HashSet<String>,
    refs: HashSet<String>,
    docs: Vec<(Vec<String>, String)>,
}

/// `파일#시트경로.키열` 의 `#` 뒤 — `.키열` 은 뿌리 배열.
fn read_target(c: &mut Cur) -> R<(Vec<String>, String)> {
    if c.peek() == Some('.') {
        c.i += 1;
        return Ok((vec![], read_key(c)?));
    }
    let mut p = read_path(c)?;
    match p.pop() {
        Some(key) => Ok((p, key)),
        None => c.fail("시트 경로와 열 이름이 와야 한다"),
    }
}

fn directive(dir: &str, c: &mut Cur, seen: &mut Seen) -> R<()> {
    c.skip();
    let at = c.i;
    match dir {
        "enum" => {
            let name = read_word(c)?;
            if !seen.enums.insert(name.clone()) {
                return c.fail_at(&format!("@enum {name} 이 이미 있다"), at);
            }
            c.skip();
            c.expect('=')?;
            let mut values: Vec<String> = vec![];
            loop {
                c.skip();
                let v = if c.peek() == Some('"') {
                    read_quoted(c)?
                } else {
                    let vs = c.i;
                    while !c.eol() && c.peek() != Some('|') {
                        c.i += 1;
                    }
                    c.slice(vs, c.i).trim().to_string()
                };
                if v.is_empty() {
                    return c.fail("고를 값이 비었다");
                }
                if values.contains(&v) {
                    return c.fail(&format!("값 {v} 가 겹친다"));
                }
                values.push(v);
                c.skip();
                if c.eol() {
                    return Ok(());
                }
                if c.peek() != Some('|') {
                    return c.fail("`|` 가 와야 한다");
                }
                c.i += 1;
            }
        }
        "ref" => {
            let kind = read_word(c)?;
            if !seen.refs.insert(kind.clone()) {
                return c.fail_at(&format!("@ref {kind} 가 이미 있다"), at);
            }
            c.skip();
            c.expect('=')?;
            c.skip();
            while !c.eol() && !c.peek().is_some_and(is_sp) && c.peek() != Some('#') {
                c.i += 1;
            }
            if c.peek() != Some('#') {
                return c
                    .fail("`파일#시트경로.키열` 모양이어야 한다 (같은 파일이면 `#` 앞을 비운다)");
            }
            c.i += 1;
            read_target(c)?;
            loop {
                c.skip();
                if c.eol() {
                    return Ok(());
                }
                let oat = c.i;
                let w = read_word(c)?;
                if (w == "label" || w == "icon") && c.peek() == Some('=') {
                    c.i += 1;
                    read_key(c)?;
                } else {
                    return c.fail_at(&format!("모르는 @ref 옵션 {w}"), oat);
                }
            }
        }
        _ => {
            let tg = read_target(c)?;
            if seen.docs.contains(&tg) {
                return c.fail_at("이 열의 @doc 이 이미 있다", at);
            }
            seen.docs.push(tg);
            c.skip();
            c.expect('=')?;
            c.skip();
            let txt = if c.peek() == Some('"') {
                let t = read_quoted(c)?;
                c.skip();
                if !c.eol() {
                    return c.fail("설명 뒤에 글자가 남았다");
                }
                t
            } else {
                c.slice(c.i, c.s.len()).trim().to_string()
            };
            if txt.is_empty() {
                return c.fail("설명이 비었다");
            }
            Ok(())
        }
    }
}

// ───────── 타입 읽기 ─────────

fn read_word(c: &mut Cur) -> R<String> {
    let st = c.i;
    while !c.eol() && !type_word_bad(c.s[c.i]) {
        c.i += 1;
    }
    if c.i == st {
        return c.fail("타입이 와야 한다");
    }
    Ok(c.slice(st, c.i))
}

fn read_type(c: &mut Cur) -> R<Ty> {
    c.skip();
    match c.peek() {
        Some('[') => {
            c.i += 1;
            let of = read_type(c)?;
            c.skip();
            c.expect(']')?;
            Ok(Rc::new(T::List(of)))
        }
        Some('{') => {
            c.i += 1;
            let mut fields: Vec<Field> = vec![];
            loop {
                c.skip();
                if c.peek() == Some('}') {
                    c.i += 1;
                    break;
                }
                if c.eol() {
                    return c.fail("`}` 가 와야 한다");
                }
                let at = c.i;
                let name = read_key(c)?;
                if fields.iter().any(|f| f.name == name) {
                    return c.fail_at(&format!("레코드 타입에 같은 이름 {name}"), at);
                }
                c.skip();
                c.expect(':')?;
                let ty = read_type(c)?;
                let mut optional = false;
                if c.peek() == Some('?') {
                    c.i += 1;
                    optional = true;
                }
                fields.push(Field { name, ty, optional });
            }
            Ok(Rc::new(T::Rec(fields)))
        }
        _ => {
            let word = read_word(c)?;
            match word.as_str() {
                "enum" | "ref" => {
                    c.skip();
                    c.expect('(')?;
                    c.skip();
                    read_word(c)?;
                    c.skip();
                    c.expect(')')?;
                    Ok(Rc::new(T::Str))
                }
                "int" => Ok(Rc::new(T::Int)),
                "num" => Ok(Rc::new(T::Num)),
                "str" => Ok(Rc::new(T::Str)),
                "bool" => Ok(Rc::new(T::Bool)),
                "any" => Ok(Rc::new(T::Any)),
                _ => Ok(Rc::new(T::Named(word))),
            }
        }
    }
}

/// 열·필드 하나의 타입: 타입 뒤에 `?` 가 붙을 수 있다
fn read_col_type(c: &mut Cur) -> R<(Ty, bool)> {
    let ty = read_type(c)?;
    let mut optional = false;
    if c.peek() == Some('?') {
        c.i += 1;
        optional = true;
    }
    Ok((ty, optional))
}

fn read_type_def(c: &mut Cur) -> R<Ty> {
    let first = read_type(c)?;
    c.skip();
    if c.peek() != Some('|') {
        return Ok(first);
    }
    let mut alts = vec![first];
    while c.peek() == Some('|') {
        c.i += 1;
        alts.push(read_type(c)?);
        c.skip();
    }
    let mut variants: Vec<Vec<Field>> = vec![];
    for a in alts {
        let Ok(t) = Rc::try_unwrap(a) else {
            unreachable!()
        };
        let T::Rec(fields) = t else {
            return c.fail("합 타입의 변형은 비지 않은 레코드 {…} 여야 한다");
        };
        if fields.is_empty() {
            return c.fail("합 타입의 변형은 비지 않은 레코드 {…} 여야 한다");
        }
        if fields[0].optional {
            return c.fail("합 타입 변형의 첫 키는 ? 를 못 붙인다");
        }
        if variants.iter().any(|v| v[0].name == fields[0].name) {
            return c.fail(&format!(
                "합 타입 변형의 첫 키 {} 가 겹친다",
                fields[0].name
            ));
        }
        variants.push(fields);
    }
    Ok(Rc::new(T::Sum(variants)))
}

type Types = HashMap<String, Ty>;

fn resolve(c: &Cur, t: &Ty, types: &Types) -> R<Ty> {
    let mut t = t.clone();
    let mut n = 0;
    while let T::Named(name) = &*t {
        let Some(r) = types.get(name) else {
            return c.fail(&format!("모르는 타입 {name} (@type 을 먼저 정의해야 한다)"));
        };
        let r = r.clone();
        t = r;
        n += 1;
        if n > 64 {
            return c.fail("타입이 서로를 끝없이 가리킨다");
        }
    }
    Ok(t)
}

// ───────── 값 읽기 ─────────

#[derive(Clone, Copy)]
struct Ctx {
    nested: bool,
    ws: bool,
}
const TOP: Ctx = Ctx {
    nested: false,
    ws: false,
};
const NESTED: Ctx = Ctx {
    nested: true,
    ws: false,
};

fn at_end(c: &Cur, x: Ctx) -> bool {
    if c.eol() {
        return true;
    }
    let ch = c.s[c.i];
    if x.ws && is_sp(ch) {
        return true;
    }
    if x.nested {
        ch == ';' || ch == ']' || ch == '}'
    } else {
        ch == '|'
    }
}

fn read_bare(c: &mut Cur, x: Ctx) -> String {
    let st = c.i;
    while !at_end(c, x) {
        c.i += 1;
    }
    let mut e = c.i;
    while e > st && is_sp(c.s[e - 1]) {
        e -= 1;
    }
    c.slice(st, e)
}

/// `-?(0|[1-9]\d*)` 의 끝 위치 (없으면 None)
fn scan_int(c: &Cur) -> Option<usize> {
    let mut j = c.i;
    if c.s.get(j) == Some(&'-') {
        j += 1;
    }
    match c.s.get(j) {
        Some('0') => Some(j + 1),
        Some(d) if d.is_ascii_digit() => {
            while c.s.get(j).is_some_and(|d| d.is_ascii_digit()) {
                j += 1;
            }
            Some(j)
        }
        _ => None,
    }
}

fn digits(c: &Cur, mut j: usize) -> usize {
    while c.s.get(j).is_some_and(|d| d.is_ascii_digit()) {
        j += 1;
    }
    j
}

fn read_int(c: &mut Cur) -> R<Value> {
    let Some(end) = scan_int(c) else {
        return c.fail("정수가 와야 한다");
    };
    if matches!(c.s.get(end), Some('.' | 'e' | 'E')) {
        return c.fail("정수 칸에 소수점·지수는 못 쓴다 (num 열이어야 한다)");
    }
    let n = safe_int(c, c.i, end)?;
    c.i = end;
    Ok(Value::Number(n.into()))
}

fn safe_int(c: &Cur, a: usize, b: usize) -> R<i64> {
    let txt = c.slice(a, b);
    let (neg, d) = match txt.strip_prefix('-') {
        Some(d) => (true, d),
        None => (false, txt.as_str()),
    };
    match d.parse::<u128>() {
        Ok(v) if v <= SAFE => Ok(if neg { -(v as i64) } else { v as i64 }),
        _ => c.fail_at("정수가 안전 범위(±2^53-1)를 벗어난다", a),
    }
}

fn read_num(c: &mut Cur) -> R<Value> {
    let Some(mut end) = scan_int(c) else {
        return c.fail("수가 와야 한다");
    };
    let mut frac_exp = false;
    if c.s.get(end) == Some(&'.') && c.s.get(end + 1).is_some_and(|d| d.is_ascii_digit()) {
        end = digits(c, end + 1);
        frac_exp = true;
    }
    if matches!(c.s.get(end), Some('e' | 'E')) {
        let mut j = end + 1;
        if matches!(c.s.get(j), Some('+' | '-')) {
            j += 1;
        }
        if c.s.get(j).is_some_and(|d| d.is_ascii_digit()) {
            end = digits(c, j);
            frac_exp = true;
        }
    }
    let v = if frac_exp {
        let f: f64 = c.slice(c.i, end).parse().unwrap_or(f64::INFINITY);
        if !f.is_finite() {
            return c.fail("수가 너무 크다");
        }
        // JS 의 수처럼: 안전 범위의 정수값은 정수로 (1.0 → 1, 1e3 → 1000)
        if f.fract() == 0.0 && f.abs() <= SAFE as f64 {
            Value::Number((f as i64).into())
        } else {
            Value::Number(Number::from_f64(f).unwrap())
        }
    } else {
        Value::Number(safe_int(c, c.i, end)?.into())
    };
    c.i = end;
    Ok(v)
}

fn parse_any(c: &mut Cur) -> R<Value> {
    c.skip();
    match c.peek() {
        Some('~') => {
            c.i += 1;
            Ok(Value::Null)
        }
        Some('"') => Ok(Value::String(read_quoted(c)?)),
        Some('[') => {
            c.i += 1;
            let mut arr = vec![];
            c.skip();
            if c.peek() == Some(']') {
                c.i += 1;
                return Ok(Value::Array(arr));
            }
            loop {
                arr.push(parse_any(c)?);
                c.skip();
                if c.peek() == Some(';') {
                    c.i += 1;
                    c.skip();
                    if c.peek() == Some(']') {
                        c.i += 1;
                        return Ok(Value::Array(arr));
                    }
                    continue;
                }
                if c.peek() == Some(']') {
                    c.i += 1;
                    return Ok(Value::Array(arr));
                }
                return c.fail("`;` 또는 `]` 가 와야 한다");
            }
        }
        Some('{') => {
            c.i += 1;
            let mut o = Map::new();
            c.skip();
            if c.peek() == Some('}') {
                c.i += 1;
                return Ok(Value::Object(o));
            }
            loop {
                c.skip();
                let at = c.i;
                let k = read_key(c)?;
                if o.contains_key(&k) {
                    return c.fail_at(&format!("키 {k} 가 겹친다"), at);
                }
                c.skip();
                c.expect('=')?;
                let v = parse_any(c)?;
                o.insert(k, v);
                c.skip();
                if c.peek() == Some(';') {
                    c.i += 1;
                    c.skip();
                    if c.peek() == Some('}') {
                        c.i += 1;
                        return Ok(Value::Object(o));
                    }
                    continue;
                }
                if c.peek() == Some('}') {
                    c.i += 1;
                    return Ok(Value::Object(o));
                }
                return c.fail("`;` 또는 `}` 가 와야 한다");
            }
        }
        Some(ch) if ch == '-' || ch.is_ascii_digit() => read_num(c),
        _ => {
            let word_end = |c: &Cur, w: &str| {
                c.starts_with(w)
                    && match c.at(w.len()) {
                        None => true,
                        Some(n) => is_ws(n) || ";]}|".contains(n),
                    }
            };
            if word_end(c, "true") {
                c.i += 4;
                return Ok(Value::Bool(true));
            }
            if word_end(c, "false") {
                c.i += 5;
                return Ok(Value::Bool(false));
            }
            c.fail("any 칸에는 ~ true false 수 \"글\" [목록] {객체} 만 온다 (글은 따옴표)")
        }
    }
}

fn parse_rec_full(c: &mut Cur, t: &Ty, types: &Types) -> R<Value> {
    let open = c.i;
    c.expect('{')?;
    let mut fields: Option<&Vec<Field>> = match &**t {
        T::Rec(f) => Some(f),
        _ => None,
    };
    let mut o = Map::new();
    c.skip();
    if c.peek() == Some('}') {
        c.i += 1;
    } else {
        loop {
            c.skip();
            let at = c.i;
            let key = read_key(c)?;
            if fields.is_none() {
                let T::Sum(variants) = &**t else {
                    unreachable!()
                };
                let Some(v) = variants.iter().find(|v| v[0].name == key) else {
                    return c.fail_at(&format!("합 타입 변형 중에 첫 키가 {key} 인 것이 없다"), at);
                };
                fields = Some(v);
            }
            let Some(f) = fields.unwrap().iter().find(|f| f.name == key) else {
                return c.fail_at(&format!("모르는 키 {key}"), at);
            };
            if o.contains_key(&key) {
                return c.fail_at(&format!("키 {key} 가 겹친다"), at);
            }
            c.skip();
            c.expect('=')?;
            c.skip();
            if c.eol() || c.peek() == Some(';') || c.peek() == Some('}') {
                return c.fail("값이 없다");
            }
            let v = parse_val(c, &f.ty, NESTED, types)?;
            o.insert(key, v);
            c.skip();
            if c.peek() == Some(';') {
                c.i += 1;
                c.skip();
                if c.peek() == Some('}') {
                    c.i += 1;
                    break;
                }
                continue;
            }
            if c.peek() == Some('}') {
                c.i += 1;
                break;
            }
            return c.fail("`;` 또는 `}` 가 와야 한다");
        }
    }
    let Some(fields) = fields else {
        return c.fail_at("합 타입 레코드가 비었다", open);
    };
    for f in fields {
        if !f.optional && !o.contains_key(&f.name) {
            return c.fail_at(&format!("필수 키 {} 가 없다", f.name), open);
        }
    }
    Ok(Value::Object(o))
}

/// 합 타입의 짧은 쓰기: `gold 650`, `item wooden_sword 1` — 첫 키 이름 뒤에 값이 필드 차례로
fn parse_short(c: &mut Cur, variants: &[Vec<Field>], x: Ctx, types: &Types) -> R<Value> {
    let at = c.i;
    let key = read_key(c)?;
    let Some(v) = variants.iter().find(|v| v[0].name == key) else {
        return c.fail_at(&format!("합 타입 변형 중에 첫 키가 {key} 인 것이 없다"), at);
    };
    let mut o = Map::new();
    for (i, f) in v.iter().enumerate() {
        c.skip();
        if at_end(
            c,
            Ctx {
                nested: x.nested,
                ws: false,
            },
        ) {
            if i == 0 {
                return c.fail("값이 없다");
            }
            for r in &v[i..] {
                if !r.optional {
                    return c.fail_at(&format!("필수 값 {} 가 모자란다", r.name), at);
                }
            }
            break;
        }
        let val = parse_val(
            c,
            &f.ty,
            Ctx {
                nested: x.nested,
                ws: true,
            },
            types,
        )?;
        o.insert(f.name.clone(), val);
    }
    Ok(Value::Object(o))
}

fn is_null_at(c: &Cur) -> bool {
    if c.peek() != Some('~') {
        return false;
    }
    match c.at(1) {
        None => true,
        Some(n) => is_sp(n) || "|;]}".contains(n),
    }
}

fn parse_val(c: &mut Cur, t0: &Ty, x: Ctx, types: &Types) -> R<Value> {
    let t = resolve(c, t0, types)?;
    c.skip();
    if is_null_at(c) {
        c.i += 1;
        return Ok(Value::Null);
    }
    match &*t {
        T::Int => read_int(c),
        T::Num => read_num(c),
        T::Bool => {
            let st = c.i;
            while c.peek().is_some_and(|ch| ch.is_ascii_lowercase()) {
                c.i += 1;
            }
            match c.slice(st, c.i).as_str() {
                "true" => Ok(Value::Bool(true)),
                "false" => Ok(Value::Bool(false)),
                _ => c.fail_at("true 또는 false 가 와야 한다", st),
            }
        }
        T::Str => {
            if c.peek() == Some('"') {
                return Ok(Value::String(read_quoted(c)?));
            }
            let st = c.i;
            let s = read_bare(c, x);
            if s.is_empty() {
                return c.fail_at("빈 글은 \"\" 로 쓴다", st);
            }
            Ok(Value::String(s))
        }
        T::Any => parse_any(c),
        T::List(of) => {
            c.expect('[')?;
            let mut arr = vec![];
            c.skip();
            if c.peek() == Some(']') {
                c.i += 1;
                return Ok(Value::Array(arr));
            }
            loop {
                c.skip();
                if c.eol() || c.peek() == Some(';') || c.peek() == Some(']') {
                    return c.fail("빈 항목 (빈 글은 \"\")");
                }
                arr.push(parse_val(c, of, NESTED, types)?);
                c.skip();
                if c.peek() == Some(';') {
                    c.i += 1;
                    c.skip();
                    if c.peek() == Some(']') {
                        c.i += 1;
                        return Ok(Value::Array(arr));
                    }
                    continue;
                }
                if c.peek() == Some(']') {
                    c.i += 1;
                    return Ok(Value::Array(arr));
                }
                return c.fail("`;` 또는 `]` 가 와야 한다");
            }
        }
        T::Rec(_) => {
            if c.peek() != Some('{') {
                return c.fail("레코드는 { } 로 쓴다");
            }
            parse_rec_full(c, &t, types)
        }
        T::Sum(variants) => {
            if c.peek() == Some('{') {
                parse_rec_full(c, &t, types)
            } else {
                parse_short(c, variants, x, types)
            }
        }
        T::Named(_) => unreachable!(),
    }
}

// ───────── 읽기 ─────────

/// 시트의 줄 하나. 하위 시트 줄은 부모 줄의 `kids` 로 붙는다 (읽는 도중 부모를 다시 고쳐야 해서 따로 모아 두었다 끝에 엮는다).
#[derive(Default)]
struct Row {
    obj: Map<String, Value>,
    kids: Vec<(String, Vec<usize>)>,
    key: String,
}

struct Sheet {
    path: Vec<String>,
    /// 뿌리에 붙은 시트면 그 줄 번호들 (arena 번호). map 이면 키와 짝.
    top: Option<Top>,
    rows: Vec<usize>,
    by_key: HashMap<String, usize>,
}

struct Top {
    map_keys: Option<Vec<String>>,
}

#[derive(Default)]
struct Parser {
    arena: Vec<Row>,
    root: Option<Value>,
}

fn place(root: &mut Option<Value>, path: &[String], val: Value, c: &Cur, at: usize) -> R<()> {
    if path.is_empty() {
        if root.is_some() {
            return c.fail_at("뿌리가 이미 정해졌다", at);
        }
        *root = Some(val);
        return Ok(());
    }
    let mut cur: &mut Value = root.get_or_insert_with(|| Value::Object(Map::new()));
    for s in &path[..path.len() - 1] {
        let Some(m) = cur.as_object_mut() else {
            return c.fail_at("경로 중간이 객체가 아니다", at);
        };
        cur = m
            .entry(s.clone())
            .or_insert_with(|| Value::Object(Map::new()));
    }
    let last = &path[path.len() - 1];
    let Some(m) = cur.as_object_mut() else {
        return c.fail_at("경로 중간이 객체가 아니다", at);
    };
    if m.contains_key(last) {
        return c.fail_at(&format!("키 {} 가 이미 있다", path_text(path)), at);
    }
    m.insert(last.clone(), val);
    Ok(())
}

fn get_at_mut<'a>(v: &'a mut Value, path: &[String]) -> Option<&'a mut Value> {
    let mut cur = v;
    for s in path {
        cur = cur.as_object_mut()?.get_mut(s)?;
    }
    Some(cur)
}

fn val_key_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        o => o.to_string(),
    }
}

impl Parser {
    fn materialize(&mut self, id: usize) -> Value {
        let row = std::mem::take(&mut self.arena[id]);
        let mut o = row.obj;
        for (field, kids) in row.kids {
            let arr: Vec<Value> = kids.into_iter().map(|k| self.materialize(k)).collect();
            o.insert(field, Value::Array(arr));
        }
        Value::Object(o)
    }

    fn run(mut self, text: &str) -> R<Value> {
        let text = text.strip_prefix('\u{feff}').unwrap_or(text);
        let lines: Vec<&str> = text
            .split('\n')
            .map(|l| l.strip_suffix('\r').unwrap_or(l))
            .collect();
        let mut types: Types = HashMap::new();
        let mut sheets: Vec<Sheet> = vec![];
        let mut seen = Seen::default();
        let mut li = 0;
        while li < lines.len() {
            let line = lines[li];
            let ln = li + 1;
            li += 1;
            if is_blank(line) || is_comment(line) {
                continue;
            }
            let mut c = Cur::new(line, ln);
            c.skip();
            if c.peek() != Some('@') {
                return c.fail("블록 밖의 줄 (@type @props @sheet 로 시작해야 한다)");
            }
            c.i += 1;
            let st = c.i;
            while !c.eol() && !is_sp(c.s[c.i]) {
                c.i += 1;
            }
            let dir = c.slice(st, c.i);
            match dir.as_str() {
                "type" => {
                    c.skip();
                    let at = c.i;
                    let name = read_word(&mut c)?;
                    if types.contains_key(&name) {
                        return c.fail_at(&format!("타입 {name} 이 이미 있다"), at);
                    }
                    c.skip();
                    c.expect('=')?;
                    let def = read_type_def(&mut c)?;
                    c.skip();
                    if !c.eol() {
                        return c.fail("타입 정의 뒤에 글자가 남았다");
                    }
                    types.insert(name, def);
                }
                "props" => {
                    c.skip();
                    let bpath = if c.eol() { vec![] } else { read_path(&mut c)? };
                    c.skip();
                    if !c.eol() {
                        return c.fail("@props 줄 뒤에 글자가 남았다");
                    }
                    while li < lines.len()
                        && !is_blank(lines[li])
                        && !trim_start_ws(lines[li]).starts_with('@')
                    {
                        let l = lines[li];
                        let n2 = li + 1;
                        li += 1;
                        if is_comment(l) {
                            continue;
                        }
                        let mut e = Cur::new(l, n2);
                        e.skip();
                        let at = e.i;
                        let epath = read_path(&mut e)?;
                        e.skip();
                        e.expect(':')?;
                        let ty = read_type(&mut e)?;
                        e.skip();
                        if e.peek() == Some('?') {
                            return e.fail("props 항목은 ? 를 못 붙인다");
                        }
                        e.expect('=')?;
                        e.skip();
                        if e.eol() {
                            return e.fail("값이 없다 (빈 글은 \"\")");
                        }
                        let val = parse_val(&mut e, &ty, TOP, &types)?;
                        e.skip();
                        if !e.eol() {
                            return e.fail("값 뒤에 글자가 남았다");
                        }
                        let full: Vec<String> = bpath.iter().chain(epath.iter()).cloned().collect();
                        place(&mut self.root, &full, val, &e, at)?;
                    }
                }
                "sheet" => {
                    li = self.sheet(&mut c, &lines, li, &types, &mut sheets)?;
                }
                "enum" | "ref" | "doc" => {
                    // 읽기 전용 꼬리표 — 값 트리에는 영향이 없으니 문법만 확인하고 버린다
                    directive(dir.as_str(), &mut c, &mut seen)?;
                }
                _ => return c.fail(&format!("모르는 블록 @{dir}")),
            }
        }
        // 맨 위 시트의 줄을 트리로 엮는다
        for si in 0..sheets.len() {
            let Some(top) = &sheets[si].top else { continue };
            let map_keys = top.map_keys.clone();
            let rows = std::mem::take(&mut sheets[si].rows);
            let path = sheets[si].path.clone();
            let built = match map_keys {
                Some(keys) => {
                    let mut m = Map::new();
                    for (k, id) in keys.into_iter().zip(rows) {
                        m.insert(k, self.materialize(id));
                    }
                    Value::Object(m)
                }
                None => Value::Array(rows.into_iter().map(|id| self.materialize(id)).collect()),
            };
            if path.is_empty() {
                self.root = Some(built);
            } else if let Some(slot) = self.root.as_mut().and_then(|r| get_at_mut(r, &path)) {
                // 시트 뒤에 같은 객체(map)에 다른 키가 붙었으면 그것을 뒤에 남긴다
                if let (Value::Object(old), Value::Object(mut nw)) = (slot.take(), built.clone()) {
                    for (k, v) in old {
                        if !nw.contains_key(&k) {
                            nw.insert(k, v);
                        }
                    }
                    *slot = Value::Object(nw);
                } else {
                    *slot = built;
                }
            }
        }
        Ok(self.root.unwrap_or_else(|| Value::Object(Map::new())))
    }

    /// `@sheet` 블록 하나. 다음에 읽을 줄 번호를 돌려준다.
    fn sheet(
        &mut self,
        c: &mut Cur,
        lines: &[&str],
        mut li: usize,
        types: &Types,
        sheets: &mut Vec<Sheet>,
    ) -> R<usize> {
        c.skip();
        let spath = read_path(c)?;
        let mut key: Option<String> = None;
        let mut map = false;
        let mut opt = false;
        loop {
            c.skip();
            if c.eol() {
                break;
            }
            let at = c.i;
            let w = read_word(c)?;
            if w == "map" {
                map = true;
            } else if w == "opt" {
                opt = true;
            } else if w == "key" && c.peek() == Some('=') {
                c.i += 1;
                key = Some(read_key(c)?);
            } else {
                return c.fail_at(&format!("모르는 @sheet 옵션 {w}"), at);
            }
        }
        // 머리줄
        while li < lines.len() && is_comment(lines[li]) {
            li += 1;
        }
        if li >= lines.len() || is_blank(lines[li]) || trim_start_ws(lines[li]).starts_with('@') {
            return c.fail_at("@sheet 다음 줄에 머리줄이 와야 한다", c.s.len());
        }
        let hl = lines[li];
        let hln = li + 1;
        li += 1;
        let mut h = Cur::new(hl, hln);
        h.skip();
        // 부모 시트: 경로에서 마지막 조각을 뺀 경로의 앞선 시트
        let pi: Option<usize> = if spath.is_empty() {
            None
        } else {
            let pp = &spath[..spath.len() - 1];
            sheets.iter().rposition(|s| s.path == pp)
        };
        let mut is_child = false;
        let mut first = true;
        let mut cols: Vec<Column> = vec![];
        loop {
            h.skip();
            if h.eol() && !first {
                break;
            }
            let at = h.i;
            if first && h.peek() == Some('^') {
                h.i += 1;
                is_child = true;
            } else {
                let cpath = read_path(&mut h)?;
                if cpath.is_empty() {
                    return h.fail_at("열 이름이 와야 한다", at);
                }
                h.skip();
                h.expect(':')?;
                let (ty, optional) = read_col_type(&mut h)?;
                if first && map {
                    if !matches!(&*ty, T::Str) || optional || cpath.len() != 1 {
                        return h.fail_at("map 시트의 첫 열은 `이름:str` 이어야 한다", at);
                    }
                } else {
                    if cols.iter().any(|o| o.path == cpath) {
                        return h.fail_at(&format!("열 {} 가 겹친다", path_text(&cpath)), at);
                    }
                    cols.push(Column {
                        path: cpath,
                        ty,
                        optional,
                    });
                }
            }
            first = false;
            h.skip();
            if h.eol() {
                break;
            }
            if h.peek() != Some('|') {
                return h.fail("`|` 가 와야 한다");
            }
            h.i += 1;
        }
        if pi.is_some() && !is_child {
            return h.fail_at("하위 시트의 첫 열은 ^ 이어야 한다", 0);
        }
        if pi.is_none() && is_child {
            return h.fail_at("^ 열은 부모 시트가 있는 하위 시트에만 쓴다", 0);
        }
        if is_child && map {
            return h.fail_at("하위 시트는 map 이 아니다", 0);
        }
        if opt && !is_child {
            return h.fail_at("opt 는 하위 시트에만 쓴다", 0);
        }
        if map && key.is_some() {
            return h.fail_at("map 시트의 키는 첫 열이다 (key= 를 못 쓴다)", 0);
        }
        if let Some(k) = &key {
            if !cols.iter().any(|o| o.path.len() == 1 && &o.path[0] == k) {
                return h.fail_at(&format!("key={k} 열이 없다"), 0);
            }
        }
        let field = spath.last().cloned().unwrap_or_default();
        // 붙일 자리 마련
        match pi {
            None => place(
                &mut self.root,
                &spath,
                if map {
                    Value::Object(Map::new())
                } else {
                    Value::Array(vec![])
                },
                c,
                0,
            )?,
            Some(p) if !opt => {
                for &pr in &sheets[p].rows {
                    let kids = &mut self.arena[pr].kids;
                    match kids.iter_mut().find(|(f, _)| *f == field) {
                        Some(k) => k.1.clear(),
                        None => kids.push((field.clone(), vec![])),
                    }
                }
            }
            _ => {}
        }
        let mut sh = Sheet {
            path: spath.clone(),
            top: if pi.is_none() {
                Some(Top {
                    map_keys: if map { Some(vec![]) } else { None },
                })
            } else {
                None
            },
            rows: vec![],
            by_key: HashMap::new(),
        };
        while li < lines.len() && !is_blank(lines[li]) && !trim_start_ws(lines[li]).starts_with('@')
        {
            let l = lines[li];
            let n2 = li + 1;
            li += 1;
            if is_comment(l) {
                continue;
            }
            let mut r = Cur::new(l, n2);
            r.skip();
            let mut obj = Map::new();
            let mut parent_key: Option<String> = None;
            let mut map_key: Option<String> = None;
            // 칸 종류: 0 부모 키, 1 map 키, 2+ 열
            let mut cells: Vec<Option<usize>> = vec![];
            if is_child {
                cells.push(None);
            }
            let mut kinds: Vec<u8> = vec![];
            if is_child {
                kinds.push(0);
            }
            if map {
                kinds.push(1);
                cells.push(None);
            }
            for ci in 0..cols.len() {
                kinds.push(2);
                cells.push(Some(ci));
            }
            let mut ended = false;
            for (n, &kind) in kinds.iter().enumerate() {
                if n > 0 && !ended {
                    r.skip();
                    if r.eol() {
                        ended = true;
                    } else {
                        if r.peek() != Some('|') {
                            return r.fail("`|` 가 와야 한다");
                        }
                        r.i += 1;
                    }
                }
                let mut val: Option<Value> = None;
                if !ended {
                    r.skip();
                    if !(r.eol() || r.peek() == Some('|')) {
                        let ty = match cells[n] {
                            Some(ci) => cols[ci].ty.clone(),
                            None => Rc::new(T::Str),
                        };
                        val = Some(parse_val(&mut r, &ty, TOP, types)?);
                    }
                }
                match kind {
                    0 => match val {
                        Some(Value::String(s)) => parent_key = Some(s),
                        _ => return r.fail("^ 칸(부모 줄 키)이 비었다"),
                    },
                    1 => match val {
                        Some(Value::String(s)) => map_key = Some(s),
                        _ => return r.fail("키 칸이 비었다"),
                    },
                    _ => {
                        let col = &cols[cells[n].unwrap()];
                        // 점 경로의 가운데 객체는 칸이 비어도 만든다
                        let mut cur = &mut obj;
                        for s in &col.path[..col.path.len() - 1] {
                            let nx = cur
                                .entry(s.clone())
                                .or_insert_with(|| Value::Object(Map::new()));
                            match nx.as_object_mut() {
                                Some(m) => cur = m,
                                None => return r.fail("열 경로 중간이 객체가 아니다"),
                            }
                        }
                        match val {
                            None => {
                                if !col.optional {
                                    return r.fail_at(
                                        &format!(
                                            "열 {} 이 비었다 (필수 열; 빼려면 타입에 ? 를 붙인다)",
                                            path_text(&col.path)
                                        ),
                                        if ended { l.chars().count() } else { r.i },
                                    );
                                }
                            }
                            Some(v) => {
                                cur.insert(col.path[col.path.len() - 1].clone(), v);
                            }
                        }
                    }
                }
            }
            r.skip();
            if !r.eol() {
                return r.fail("열이 머리줄보다 많다");
            }
            // 붙이고 키 계산
            let own_key = |idx: usize, obj: &Map<String, Value>| -> R<String> {
                match &key {
                    None => Ok(idx.to_string()),
                    Some(k) => match obj.get(k) {
                        None | Some(Value::Null) => r.fail_at(&format!("키 열 {k} 가 비었다"), 0),
                        Some(v) => Ok(val_key_text(v)),
                    },
                }
            };
            let full_key: String;
            let id = self.arena.len();
            match pi {
                None => {
                    if map {
                        let mk = map_key.unwrap();
                        if sh.by_key.contains_key(&mk) {
                            return r.fail_at(&format!("map 키 {mk} 가 겹친다"), 0);
                        }
                        sh.top
                            .as_mut()
                            .unwrap()
                            .map_keys
                            .as_mut()
                            .unwrap()
                            .push(mk.clone());
                        full_key = mk;
                    } else {
                        full_key = own_key(sh.rows.len(), &obj)?;
                    }
                    self.arena.push(Row {
                        obj,
                        kids: vec![],
                        key: full_key.clone(),
                    });
                }
                Some(p) => {
                    let pk = parent_key.unwrap();
                    let Some(&pr) = sheets[p].by_key.get(&pk) else {
                        return r.fail_at(&format!("부모 줄 {pk} 가 없다"), 0);
                    };
                    let kids = &self.arena[pr].kids;
                    let cnt = kids
                        .iter()
                        .find(|(f, _)| *f == field)
                        .map_or(0, |k| k.1.len());
                    full_key = format!("{}/{}", self.arena[pr].key, own_key(cnt, &obj)?);
                    if sh.by_key.contains_key(&full_key) {
                        return r.fail_at(&format!("키 {full_key} 가 겹친다"), 0);
                    }
                    self.arena.push(Row {
                        obj,
                        kids: vec![],
                        key: full_key.clone(),
                    });
                    let kids = &mut self.arena[pr].kids;
                    match kids.iter_mut().find(|(f, _)| *f == field) {
                        Some(k) => k.1.push(id),
                        None => kids.push((field.clone(), vec![id])),
                    }
                }
            }
            if pi.is_none() && sh.by_key.contains_key(&full_key) {
                return r.fail_at(&format!("키 {full_key} 가 겹친다"), 0);
            }
            sh.by_key.insert(full_key, id);
            sh.rows.push(id);
        }
        sheets.push(sh);
        Ok(li)
    }
}
