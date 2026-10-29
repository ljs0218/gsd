--[[
    GSD 읽기. 순수 Lua 5.1 (LuaJIT 호환). 명세는 SPEC.md, 기준 구현은 packages/core/src/gsd.ts.
    게임 코드를 require 하지 않는다 (나중에 따로 떼어 낼 수 있게). 쓰기는 없다.

        local gsd = require("gsd")
        local value, err = gsd.decode(text)   -- 틀리면 nil, "N줄 C칸: 까닭", { line=, col=, message= }

    ## 값 트리

    읽어 만든 트리는 JSON 읽기와 같은 모양이다. json.lua (test/json.lua 같은 순수 Lua JSON) 와 바꿔 끼울 수 있게:
      - null 은 `null` 표지 표 (nil 이면 칸이 사라진다), 객체 안의 null 도 표지로 남는다.
      - 배열에는 배열 표지, 객체(빈 `{}` 포함)에는 객체 표지 메타테이블을 붙인다.
    표지는 기본으로 이 파일의 것을 쓴다. json.lua 와 같은 표지를 쓰려면 `gsd.adopt(json)` 을
    한 번 부른다 — 그러면 json.null 과 json 이 붙이는 메타테이블을 그대로 쓴다 (isArray·isObject 가 서로 통한다).

    ## 오류

    error 를 던지지 않는다 (decodeOrError 만 던진다). 틀린 글이면 nil 과 "N줄 C칸: 까닭" 글, 그리고
    셋째로 { line=, col=, message= } 표. 시험은 줄 번호만 본다 (칸은 구현마다 달라도 된다).
]]

local M = {}

local byte, sub, find, format, char = string.byte, string.sub, string.find, string.format, string.char
local concat = table.concat
local setmetatable, getmetatable, rawget, type, tonumber, tostring = setmetatable, getmetatable, rawget, type, tonumber, tostring
local floor, abs, huge = math.floor, math.abs, math.huge

-- 표지 -----------------------------------------------------------------

local NULL = setmetatable({}, { __tostring = function() return "null" end })
local AM = { __jsontype = "array" }
local OM = { __jsontype = "object" }
M.null = NULL

--- json.lua 와 같은 표지를 쓴다. 읽기 전에 한 번.
function M.adopt(json)
    NULL = json.null
    AM = getmetatable(json.decode("[]"))
    OM = getmetatable(json.decode("{}"))
    M.null = NULL
end

function M.isArray(v) return type(v) == "table" and getmetatable(v) == AM end
function M.isObject(v) return type(v) == "table" and getmetatable(v) == OM end

-- 커서 (줄 하나를 읽는 동안의 상태) ------------------------------------------
-- S 는 지금 읽는 줄, I 는 1부터 세는 자리, LN 은 줄 번호. 한 번에 한 줄만 읽으므로 모듈 상태로 둔다.

local S, I, LN = "", 1, 0
local TYPES = {}

local function fail(msg, at, ln)
    error({ gsd = true, line = ln or LN, col = at or I, message = msg }, 0)
end

local function setCur(line, ln)
    S, I, LN = line, 1, ln
end

local function eol() return I > #S end

local function skip()
    local b = byte(S, I)
    if b == 32 or b == 9 then
        I = find(S, "[^ \t]", I) or (#S + 1)
    end
end

local function expect(code, ch)
    if byte(S, I) ~= code then fail("`" .. ch .. "` 가 와야 한다") end
    I = I + 1
end

local function utf8(code)
    if code < 0x80 then
        return char(code)
    elseif code < 0x800 then
        return char(0xC0 + floor(code / 0x40), 0x80 + code % 0x40)
    elseif code < 0x10000 then
        return char(0xE0 + floor(code / 0x1000), 0x80 + floor(code / 0x40) % 0x40, 0x80 + code % 0x40)
    end
    return char(
        0xF0 + floor(code / 0x40000),
        0x80 + floor(code / 0x1000) % 0x40,
        0x80 + floor(code / 0x40) % 0x40,
        0x80 + code % 0x40
    )
end

local ESC = { [34] = '"', [92] = "\\", [47] = "/", [110] = "\n", [114] = "\r", [116] = "\t" }

local function readQuoted()
    local st = I
    local start = I + 1
    local pos = start
    local parts
    while true do
        local p = find(S, '["\\]', pos)
        if not p then fail("닫는 따옴표가 없다", st) end
        if byte(S, p) == 34 then
            I = p + 1
            if not parts then return sub(S, start, p - 1) end
            parts[#parts + 1] = sub(S, start, p - 1)
            return concat(parts)
        end
        -- 역슬래시
        parts = parts or {}
        parts[#parts + 1] = sub(S, start, p - 1)
        local e = byte(S, p + 1)
        local lit = ESC[e]
        if lit then
            parts[#parts + 1] = lit
            pos = p + 2
        elseif e == 117 then
            local h = sub(S, p + 2, p + 5)
            if not find(h, "^%x%x%x%x$") then fail("\\u 뒤에 16진수 네 자리가 와야 한다", p) end
            local code = tonumber(h, 16)
            pos = p + 6
            -- 서로게이트 짝은 한 글자로 (UTF-16 으로 읽은 것과 같은 글이 되게)
            if code >= 0xD800 and code <= 0xDBFF and sub(S, pos, pos + 1) == "\\u" then
                local h2 = sub(S, pos + 2, pos + 5)
                if find(h2, "^%x%x%x%x$") then
                    local low = tonumber(h2, 16)
                    if low >= 0xDC00 and low <= 0xDFFF then
                        code = 0x10000 + (code - 0xD800) * 0x400 + (low - 0xDC00)
                        pos = pos + 6
                    end
                end
            end
            parts[#parts + 1] = utf8(code)
        else
            fail('모르는 이스케이프 (\\" \\\\ \\n \\r \\t \\uXXXX 만)', p)
        end
        start = pos
    end
end

local KEYPAT = '^[^%s=;{}%[%]"|:%.#@~()?,\\]+'

local function readKey()
    if byte(S, I) == 34 then return readQuoted() end
    local _, e = find(S, KEYPAT, I)
    if not e then fail("이름이 와야 한다 (특수문자가 든 이름은 따옴표로)") end
    local k = sub(S, I, e)
    I = e + 1
    return k
end

local function readPath()
    if byte(S, I) == 46 then
        local n = byte(S, I + 1)
        if n == nil or n == 32 or n == 9 or n == 58 then
            I = I + 1
            return {}
        end
    end
    local segs = { readKey() }
    while byte(S, I) == 46 do
        I = I + 1
        segs[#segs + 1] = readKey()
    end
    return segs
end

-- 타입 읽기 -------------------------------------------------------------

local BUILTIN = { int = true, num = true, str = true, bool = true, any = true }
local WORDPAT = '^[^%s%(%)%[%]{}:%?|=",]+'

local function readWord()
    local _, e = find(S, WORDPAT, I)
    if not e then fail("타입이 와야 한다") end
    local w = sub(S, I, e)
    I = e + 1
    return w
end

local function readType()
    skip()
    local ch = byte(S, I)
    if ch == 91 then -- [
        I = I + 1
        local of = readType()
        skip()
        expect(93, "]")
        return { k = "list", of = of }
    end
    if ch == 123 then -- {
        I = I + 1
        local fields = {}
        while true do
            skip()
            if byte(S, I) == 125 then
                I = I + 1
                break
            end
            if eol() then fail("`}` 가 와야 한다") end
            local at = I
            local name = readKey()
            for _, f in ipairs(fields) do
                if f.name == name then fail("레코드 타입에 같은 이름 " .. name, at) end
            end
            skip()
            expect(58, ":")
            local ty = readType()
            local optional = false
            if byte(S, I) == 63 then
                I = I + 1
                optional = true
            end
            fields[#fields + 1] = { name = name, type = ty, optional = optional }
        end
        return { k = "rec", fields = fields }
    end
    local word = readWord()
    if word == "enum" or word == "ref" then
        skip()
        expect(40, "(")
        skip()
        local name = readWord()
        skip()
        expect(41, ")")
        return { k = word, name = name }
    end
    if BUILTIN[word] then return { k = word } end
    return { k = "named", name = word }
end

-- 열·필드 하나의 타입: 타입 뒤에 ? 가 붙을 수 있다
local function readColType()
    local ty = readType()
    local optional = false
    if byte(S, I) == 63 then
        I = I + 1
        optional = true
    end
    return ty, optional
end

local function readTypeDef()
    local first = readType()
    skip()
    if byte(S, I) ~= 124 then return first end
    local alts = { first }
    while byte(S, I) == 124 do
        I = I + 1
        alts[#alts + 1] = readType()
        skip()
    end
    local variants = {}
    for _, a in ipairs(alts) do
        if a.k ~= "rec" or #a.fields == 0 then fail("합 타입의 변형은 비지 않은 레코드 {…} 여야 한다") end
        if a.fields[1].optional then fail("합 타입 변형의 첫 키는 ? 를 못 붙인다") end
        for _, v in ipairs(variants) do
            if v[1].name == a.fields[1].name then fail("합 타입 변형의 첫 키 " .. a.fields[1].name .. " 가 겹친다") end
        end
        variants[#variants + 1] = a.fields
    end
    return { k = "sum", variants = variants }
end

local function resolve(t)
    local n = 0
    while t.k == "named" do
        local r = TYPES[t.name]
        if not r then fail("모르는 타입 " .. t.name .. " (@type 을 먼저 정의해야 한다)") end
        t = r
        n = n + 1
        if n > 64 then fail("타입이 서로를 끝없이 가리킨다") end
    end
    return t
end

-- 값 읽기 ---------------------------------------------------------------
-- nested: 목록·레코드 안 (끝은 ; ] }), 아니면 칸 하나 (끝은 |). ws: 공백도 끝 (합 타입의 짧은 쓰기).

local END_TOP, END_TOP_WS, END_NESTED, END_NESTED_WS = "|", "[ \t|]", "[;%]}]", "[ \t;%]}]"

local function atEnd(nested, ws)
    local b = byte(S, I)
    if not b then return true end
    if ws and (b == 32 or b == 9) then return true end
    if nested then return b == 59 or b == 93 or b == 125 end
    return b == 124
end

local function readBare(nested, ws)
    local pat
    if nested then pat = ws and END_NESTED_WS or END_NESTED else pat = ws and END_TOP_WS or END_TOP end
    local st = I
    local e = find(S, pat, st) or (#S + 1)
    I = e
    while e > st do
        local b = byte(S, e - 1)
        if b ~= 32 and b ~= 9 then break end
        e = e - 1
    end
    return sub(S, st, e - 1)
end

local SAFE = 9007199254740991

local function scanInt()
    local _, e = find(S, "^-?0", I)
    if not e then _, e = find(S, "^-?[1-9]%d*", I) end
    return e
end

local function readInt()
    local e = scanInt()
    if not e then fail("정수가 와야 한다") end
    local nx = byte(S, e + 1)
    if nx == 46 or nx == 101 or nx == 69 then fail("정수 칸에 소수점·지수는 못 쓴다 (num 열이어야 한다)") end
    local n = tonumber(sub(S, I, e))
    if abs(n) > SAFE then fail("정수가 안전 범위(±2^53-1)를 벗어난다") end
    I = e + 1
    if n == 0 then return 0 end
    return n
end

local function readNum()
    local e = scanInt()
    if not e then fail("수가 와야 한다") end
    local isFloat = false
    local _, f = find(S, "^%.%d+", e + 1)
    if f then
        e = f
        isFloat = true
    end
    local _, x = find(S, "^[eE][+-]?%d+", e + 1)
    if x then
        e = x
        isFloat = true
    end
    local n = tonumber(sub(S, I, e))
    if n == huge or n == -huge then fail("수가 너무 크다") end
    if not isFloat and abs(n) > SAFE then fail("정수가 안전 범위(±2^53-1)를 벗어난다") end
    I = e + 1
    return n
end

local function isWordEnd(b)
    -- true/false 뒤: 끝, 공백, ; ] } |
    return b == nil or b == 32 or b == 9 or b == 10 or b == 11 or b == 12 or b == 13 or b == 59 or b == 93 or b == 125 or b == 124
end

local function parseAny()
    skip()
    local ch = byte(S, I)
    if ch == 126 then -- ~
        I = I + 1
        return NULL
    end
    if ch == 34 then return readQuoted() end
    if ch == 91 then -- [
        I = I + 1
        local arr = setmetatable({}, AM)
        skip()
        if byte(S, I) == 93 then
            I = I + 1
            return arr
        end
        local n = 0
        while true do
            n = n + 1
            arr[n] = parseAny()
            skip()
            local b = byte(S, I)
            if b == 59 then
                I = I + 1
                skip()
                if byte(S, I) == 93 then
                    I = I + 1
                    return arr
                end
            elseif b == 93 then
                I = I + 1
                return arr
            else
                fail("`;` 또는 `]` 가 와야 한다")
            end
        end
    end
    if ch == 123 then -- {
        I = I + 1
        local o = setmetatable({}, OM)
        skip()
        if byte(S, I) == 125 then
            I = I + 1
            return o
        end
        while true do
            skip()
            local at = I
            local k = readKey()
            if rawget(o, k) ~= nil then fail("키 " .. k .. " 가 겹친다", at) end
            skip()
            expect(61, "=")
            o[k] = parseAny()
            skip()
            local b = byte(S, I)
            if b == 59 then
                I = I + 1
                skip()
                if byte(S, I) == 125 then
                    I = I + 1
                    return o
                end
            elseif b == 125 then
                I = I + 1
                return o
            else
                fail("`;` 또는 `}` 가 와야 한다")
            end
        end
    end
    if ch == 45 or (ch and ch >= 48 and ch <= 57) then return readNum() end
    if sub(S, I, I + 3) == "true" and isWordEnd(byte(S, I + 4)) then
        I = I + 4
        return true
    end
    if sub(S, I, I + 4) == "false" and isWordEnd(byte(S, I + 5)) then
        I = I + 5
        return false
    end
    fail('any 칸에는 ~ true false 수 "글" [목록] {객체} 만 온다 (글은 따옴표)')
end

local parseVal

local function parseRecFull(t)
    local open = I
    expect(123, "{")
    local fields = t.k == "rec" and t.fields or nil
    local o = setmetatable({}, OM)
    skip()
    if byte(S, I) == 125 then
        I = I + 1
    else
        while true do
            skip()
            local at = I
            local key = readKey()
            if fields == nil then
                for _, vv in ipairs(t.variants) do
                    if vv[1].name == key then
                        fields = vv
                        break
                    end
                end
                if not fields then fail("합 타입 변형 중에 첫 키가 " .. key .. " 인 것이 없다", at) end
            end
            local f
            for _, ff in ipairs(fields) do
                if ff.name == key then
                    f = ff
                    break
                end
            end
            if not f then fail("모르는 키 " .. key, at) end
            if rawget(o, key) ~= nil then fail("키 " .. key .. " 가 겹친다", at) end
            skip()
            expect(61, "=")
            skip()
            local b = byte(S, I)
            if b == nil or b == 59 or b == 125 then fail("값이 없다") end
            o[key] = parseVal(f.type, true, false)
            skip()
            b = byte(S, I)
            if b == 59 then
                I = I + 1
                skip()
                if byte(S, I) == 125 then
                    I = I + 1
                    break
                end
            elseif b == 125 then
                I = I + 1
                break
            else
                fail("`;` 또는 `}` 가 와야 한다")
            end
        end
    end
    if fields == nil then fail("합 타입 레코드가 비었다", open) end
    for _, f in ipairs(fields) do
        if not f.optional and rawget(o, f.name) == nil then fail("필수 키 " .. f.name .. " 가 없다", open) end
    end
    return o
end

-- 합 타입의 짧은 쓰기: `gold 650`, `item wooden_sword 1` — 첫 키 이름 뒤에 값이 필드 차례로
local function parseShort(t, nested)
    local at = I
    local key = readKey()
    local v
    for _, vv in ipairs(t.variants) do
        if vv[1].name == key then
            v = vv
            break
        end
    end
    if not v then fail("합 타입 변형 중에 첫 키가 " .. key .. " 인 것이 없다", at) end
    local o = setmetatable({}, OM)
    for i = 1, #v do
        local f = v[i]
        skip()
        if atEnd(nested, false) then
            if i == 1 then fail("값이 없다") end
            for j = i, #v do
                if not v[j].optional then fail("필수 값 " .. v[j].name .. " 가 모자란다", at) end
            end
            break
        end
        o[f.name] = parseVal(f.type, nested, true)
    end
    return o
end

local function isNullAt()
    if byte(S, I) ~= 126 then return false end
    local n = byte(S, I + 1)
    return n == nil or n == 32 or n == 9 or n == 124 or n == 59 or n == 93 or n == 125
end

parseVal = function(t0, nested, ws)
    local t = t0
    if t.k == "named" then t = resolve(t) end
    skip()
    if isNullAt() then
        I = I + 1
        return NULL
    end
    local k = t.k
    if k == "str" or k == "enum" or k == "ref" then
        if byte(S, I) == 34 then return readQuoted() end
        local st = I
        local s = readBare(nested, ws)
        if s == "" then fail('빈 글은 "" 로 쓴다', st) end
        return s
    elseif k == "int" then
        return readInt()
    elseif k == "num" then
        return readNum()
    elseif k == "bool" then
        local st = I
        local _, e = find(S, "^[a-z]*", I)
        local w = sub(S, st, e)
        I = e + 1
        if w == "true" then return true end
        if w == "false" then return false end
        fail("true 또는 false 가 와야 한다", st)
    elseif k == "any" then
        return parseAny()
    elseif k == "list" then
        expect(91, "[")
        local arr = setmetatable({}, AM)
        skip()
        if byte(S, I) == 93 then
            I = I + 1
            return arr
        end
        local n = 0
        local of = t.of
        while true do
            skip()
            local b = byte(S, I)
            if b == nil or b == 59 or b == 93 then fail('빈 항목 (빈 글은 "")') end
            n = n + 1
            arr[n] = parseVal(of, true, false)
            skip()
            b = byte(S, I)
            if b == 59 then
                I = I + 1
                skip()
                if byte(S, I) == 93 then
                    I = I + 1
                    return arr
                end
            elseif b == 93 then
                I = I + 1
                return arr
            else
                fail("`;` 또는 `]` 가 와야 한다")
            end
        end
    elseif k == "rec" then
        if byte(S, I) ~= 123 then fail("레코드는 { } 로 쓴다") end
        return parseRecFull(t)
    elseif k == "sum" then
        if byte(S, I) == 123 then return parseRecFull(t) end
        return parseShort(t, nested)
    end
    fail("내부 오류: 타입")
end

-- 읽기 ------------------------------------------------------------------

local function pathEq(a, b)
    if #a ~= #b then return false end
    for i = 1, #a do
        if a[i] ~= b[i] then return false end
    end
    return true
end

local function pathText(p) return concat(p, ".") end

local function isPlain(v) return type(v) == "table" and getmetatable(v) == OM end

local function getAt(v, path)
    local cur = v
    for _, s in ipairs(path) do
        if not isPlain(cur) then return nil end
        cur = rawget(cur, s)
        if cur == nil then return nil end
    end
    return cur
end

local function splitLines(text)
    if sub(text, 1, 3) == "\239\187\191" then text = sub(text, 4) end
    local lines, n, pos = {}, 0, 1
    while true do
        local nl = find(text, "\n", pos, true)
        local l
        if nl then l = sub(text, pos, nl - 1) else l = sub(text, pos) end
        if byte(l, #l) == 13 then l = sub(l, 1, #l - 1) end
        n = n + 1
        lines[n] = l
        if not nl then break end
        pos = nl + 1
    end
    return lines, n
end

-- 줄의 첫 공백 아닌 글자: nil = 빈 줄, 64 = @ (블록 머리), 35 = # (주석)
local function firstByte(l)
    local p = find(l, "[^ \t]")
    if not p then return nil end
    return byte(l, p)
end

local STR = { k = "str" }

-- 지시문 (@enum @ref @doc) ----------------------------------------------
-- 읽기 전용 꼬리표 — 값 트리에는 영향이 없으니 문법만 확인하고 버린다.

-- `파일#시트경로.키열` 의 `#` 뒤. `.키열` 은 뿌리 배열.
local function readTarget()
    if byte(S, I) == 46 then
        I = I + 1
        return {}, readKey()
    end
    local p = readPath()
    if #p == 0 then fail("시트 경로와 열 이름이 와야 한다") end
    local key = p[#p]
    p[#p] = nil
    return p, key
end

local function directive(dir, seen)
    skip()
    local at = I
    if dir == "enum" then
        local name = readWord()
        if seen.enums[name] then fail("@enum " .. name .. " 이 이미 있다", at) end
        seen.enums[name] = true
        skip()
        expect(61, "=")
        local values = {}
        while true do
            skip()
            local v
            if byte(S, I) == 34 then
                v = readQuoted()
            else
                local vs = I
                while not eol() and byte(S, I) ~= 124 do I = I + 1 end
                v = (sub(S, vs, I - 1):gsub("^%s+", ""):gsub("%s+$", ""))
            end
            if v == "" then fail("고를 값이 비었다") end
            if values[v] then fail("값 " .. v .. " 가 겹친다") end
            values[v] = true
            skip()
            if eol() then return end
            if byte(S, I) ~= 124 then fail("`|` 가 와야 한다") end
            I = I + 1
        end
    elseif dir == "ref" then
        local kind = readWord()
        if seen.refs[kind] then fail("@ref " .. kind .. " 가 이미 있다", at) end
        seen.refs[kind] = true
        skip()
        expect(61, "=")
        skip()
        while not eol() do
            local b = byte(S, I)
            if b == 32 or b == 9 or b == 35 then break end
            I = I + 1
        end
        if byte(S, I) ~= 35 then
            fail("`파일#시트경로.키열` 모양이어야 한다 (같은 파일이면 `#` 앞을 비운다)")
        end
        I = I + 1
        readTarget()
        while true do
            skip()
            if eol() then return end
            local oat = I
            local w = readWord()
            if (w == "label" or w == "icon") and byte(S, I) == 61 then
                I = I + 1
                readKey()
            else
                fail("모르는 @ref 옵션 " .. w, oat)
            end
        end
    else
        local sheet, col = readTarget()
        for _, d in ipairs(seen.docs) do
            if d.col == col and pathEq(d.sheet, sheet) then fail("이 열의 @doc 이 이미 있다", at) end
        end
        seen.docs[#seen.docs + 1] = { sheet = sheet, col = col }
        skip()
        expect(61, "=")
        skip()
        local txt
        if byte(S, I) == 34 then
            txt = readQuoted()
            skip()
            if not eol() then fail("설명 뒤에 글자가 남았다") end
        else
            txt = (sub(S, I):gsub("^%s+", ""):gsub("%s+$", ""))
        end
        if txt == "" then fail("설명이 비었다") end
    end
end

local function run(text)
    local lines, nlines = splitLines(text)
    TYPES = {}
    local seen = { enums = {}, refs = {}, docs = {} }
    local blocks = {} -- 블록 번호 -> { path = ... } (시트만)
    local rowsOf = {}
    local lookups = {}
    local root

    local function place(path, val, ln, at)
        if #path == 0 then
            if root ~= nil then fail("뿌리가 이미 정해졌다", at, ln) end
            root = val
            return
        end
        if root == nil then root = setmetatable({}, OM) end
        local cur = root
        for i = 1, #path - 1 do
            local s = path[i]
            if not isPlain(cur) then fail("경로 중간이 객체가 아니다", at, ln) end
            local nx = rawget(cur, s)
            if nx == nil then
                nx = setmetatable({}, OM)
                cur[s] = nx
            end
            cur = nx
        end
        local last = path[#path]
        if not isPlain(cur) then fail("경로 중간이 객체가 아니다", at, ln) end
        if rawget(cur, last) ~= nil then fail("키 " .. pathText(path) .. " 가 이미 있다", at, ln) end
        cur[last] = val
    end

    local li = 1
    while li <= nlines do
        local line = lines[li]
        local ln = li
        li = li + 1
        local fb = firstByte(line)
        if fb == nil or fb == 35 then
            -- 빈 줄·주석
        else
            setCur(line, ln)
            skip()
            if byte(S, I) ~= 64 then fail("블록 밖의 줄 (@type @props @sheet 로 시작해야 한다)") end
            I = I + 1
            local st = I
            local _, de = find(S, "^[^ \t]*", I)
            local dir = sub(S, st, de)
            I = de + 1
            if dir == "type" then
                skip()
                local at = I
                local name = readWord()
                if TYPES[name] then fail("타입 " .. name .. " 이 이미 있다", at) end
                skip()
                expect(61, "=")
                local def = readTypeDef()
                skip()
                if not eol() then fail("타입 정의 뒤에 글자가 남았다") end
                TYPES[name] = def
            elseif dir == "props" then
                skip()
                local bpath = eol() and {} or readPath()
                skip()
                if not eol() then fail("@props 줄 뒤에 글자가 남았다") end
                blocks[#blocks + 1] = false
                rowsOf[#blocks] = {}
                while li <= nlines do
                    local l = lines[li]
                    local f2 = firstByte(l)
                    if f2 == nil or f2 == 64 then break end
                    local n2 = li
                    li = li + 1
                    if f2 ~= 35 then
                        setCur(l, n2)
                        skip()
                        local at = I
                        local epath = readPath()
                        skip()
                        expect(58, ":")
                        local ty = readType()
                        skip()
                        if byte(S, I) == 63 then fail("props 항목은 ? 를 못 붙인다") end
                        expect(61, "=")
                        skip()
                        if eol() then fail('값이 없다 (빈 글은 "")') end
                        local val = parseVal(ty, false, false)
                        skip()
                        if not eol() then fail("값 뒤에 글자가 남았다") end
                        local full = {}
                        for _, s in ipairs(bpath) do full[#full + 1] = s end
                        for _, s in ipairs(epath) do full[#full + 1] = s end
                        place(full, val, n2, at)
                    end
                end
            elseif dir == "sheet" then
                skip()
                local spath = readPath()
                local key, map, opt
                while true do
                    skip()
                    if eol() then break end
                    local at = I
                    local w = readWord()
                    if w == "map" then
                        map = true
                    elseif w == "opt" then
                        opt = true
                    elseif w == "key" and byte(S, I) == 61 then
                        I = I + 1
                        key = readKey()
                    else
                        fail("모르는 @sheet 옵션 " .. w, at)
                    end
                end
                -- 머리줄
                while li <= nlines and firstByte(lines[li]) == 35 do li = li + 1 end
                if li > nlines then fail("@sheet 다음 줄에 머리줄이 와야 한다", #line + 1, ln) end
                local hfb = firstByte(lines[li])
                if hfb == nil or hfb == 64 then fail("@sheet 다음 줄에 머리줄이 와야 한다", #line + 1, ln) end
                local hln = li
                setCur(lines[li], hln)
                li = li + 1
                skip()
                local bi = #blocks + 1
                blocks[bi] = { path = spath }
                -- 부모 시트 찾기: 경로에서 마지막 조각을 뺀 경로의 앞선 시트
                local pi = -1
                if #spath > 0 then
                    local pp = {}
                    for i = 1, #spath - 1 do pp[i] = spath[i] end
                    for j = bi - 1, 1, -1 do
                        local o = blocks[j]
                        if o and pathEq(o.path, pp) then
                            pi = j
                            break
                        end
                    end
                end
                local isChild = false
                local first = true
                local cols = {}
                local cells = {}
                while true do
                    skip()
                    if eol() and not first then break end
                    local at = I
                    if first and byte(S, I) == 94 then
                        I = I + 1
                        isChild = true
                        cells[#cells + 1] = { kind = 1, type = STR }
                    else
                        local cpath = readPath()
                        if #cpath == 0 then fail("열 이름이 와야 한다", at) end
                        skip()
                        expect(58, ":")
                        local ty, optional = readColType()
                        if first and map then
                            if ty.k ~= "str" or optional or #cpath ~= 1 then fail("map 시트의 첫 열은 `이름:str` 이어야 한다", at) end
                            cells[#cells + 1] = { kind = 2, type = STR }
                        else
                            for _, o in ipairs(cols) do
                                if pathEq(o.path, cpath) then fail("열 " .. pathText(cpath) .. " 가 겹친다", at) end
                            end
                            local col = { path = cpath, type = ty, optional = optional, kind = 3, last = cpath[#cpath] }
                            if #cpath > 1 then
                                local mids = {}
                                for i = 1, #cpath - 1 do mids[i] = cpath[i] end
                                col.mids = mids
                            end
                            cols[#cols + 1] = col
                            cells[#cells + 1] = col
                        end
                    end
                    first = false
                    skip()
                    if eol() then break end
                    if byte(S, I) ~= 124 then fail("`|` 가 와야 한다") end
                    I = I + 1
                end
                if pi >= 1 and not isChild then fail("하위 시트의 첫 열은 ^ 이어야 한다", 1) end
                if pi < 1 and isChild then fail("^ 열은 부모 시트가 있는 하위 시트에만 쓴다", 1) end
                if isChild and map then fail("하위 시트는 map 이 아니다", 1) end
                if opt and not isChild then fail("opt 는 하위 시트에만 쓴다", 1) end
                if map and key ~= nil then fail("map 시트의 키는 첫 열이다 (key= 를 못 쓴다)", 1) end
                if key ~= nil then
                    local found = false
                    for _, o in ipairs(cols) do
                        if #o.path == 1 and o.path[1] == key then found = true end
                    end
                    if not found then fail("key=" .. key .. " 열이 없다", 1) end
                end
                local rows = {}
                rowsOf[bi] = rows
                local nrows = 0
                local field = spath[#spath]
                -- 붙일 자리 마련
                if pi < 1 then
                    place(spath, setmetatable({}, map and OM or AM), ln, 1)
                elseif not opt then
                    for _, pr in ipairs(rowsOf[pi]) do pr.obj[field] = setmetatable({}, AM) end
                end
                local container = (pi < 1) and getAt(root, spath) or nil
                if #spath == 0 then container = root end
                local byKey = {}
                local ncell = #cells
                local parentLookup = isChild and lookups[pi] or nil
                while li <= nlines do
                    local l = lines[li]
                    local f2 = firstByte(l)
                    if f2 == nil or f2 == 64 then break end
                    local n2 = li
                    li = li + 1
                    if f2 ~= 35 then
                        setCur(l, n2)
                        skip()
                        local obj = setmetatable({}, OM)
                        local parentKey, mapKey
                        local ended = false
                        for ci = 1, ncell do
                            local cell = cells[ci]
                            if ci > 1 and not ended then
                                skip()
                                if I > #S then
                                    ended = true
                                else
                                    if byte(S, I) ~= 124 then fail("`|` 가 와야 한다") end
                                    I = I + 1
                                end
                            end
                            local val
                            if not ended then
                                skip()
                                local b = byte(S, I)
                                if b and b ~= 124 then val = parseVal(cell.type, false, false) end
                            end
                            local kind = cell.kind
                            if kind == 3 then
                                local cur = obj
                                local mids = cell.mids
                                if mids then
                                    for i = 1, #mids do
                                        local s = mids[i]
                                        local nx = rawget(cur, s)
                                        if nx == nil then
                                            nx = setmetatable({}, OM)
                                            cur[s] = nx
                                        end
                                        cur = nx
                                    end
                                end
                                if val == nil then
                                    if not cell.optional then
                                        fail("열 " .. pathText(cell.path) .. " 이 비었다 (필수 열; 빼려면 타입에 ? 를 붙인다)", ended and (#l + 1) or I)
                                    end
                                else
                                    cur[cell.last] = val
                                end
                            elseif kind == 1 then
                                if type(val) ~= "string" then fail("^ 칸(부모 줄 키)이 비었다") end
                                parentKey = val
                            else
                                if type(val) ~= "string" then fail("키 칸이 비었다") end
                                mapKey = val
                            end
                        end
                        skip()
                        if not eol() then fail("열이 머리줄보다 많다") end
                        -- 붙이고 키 계산
                        local function ownKey(idx)
                            if key == nil then return format("%d", idx) end
                            local kv = rawget(obj, key)
                            if kv == nil or kv == NULL then fail("키 열 " .. key .. " 가 비었다", 1) end
                            return tostring(kv)
                        end
                        local fullKey
                        if not isChild then
                            if map then
                                if rawget(container, mapKey) ~= nil then fail("map 키 " .. mapKey .. " 가 겹친다", 1) end
                                container[mapKey] = obj
                                fullKey = mapKey
                            else
                                container[#container + 1] = obj
                                fullKey = ownKey(nrows)
                            end
                        else
                            local pr = parentLookup[parentKey]
                            if not pr then fail("부모 줄 " .. parentKey .. " 가 없다", 1) end
                            local arr = rawget(pr.obj, field)
                            if arr == nil then
                                arr = setmetatable({}, AM)
                                pr.obj[field] = arr
                            end
                            fullKey = pr.key .. "/" .. ownKey(#arr)
                            arr[#arr + 1] = obj
                        end
                        if byKey[fullKey] then fail("키 " .. fullKey .. " 가 겹친다", 1) end
                        local info = { obj = obj, key = fullKey }
                        byKey[fullKey] = info
                        nrows = nrows + 1
                        rows[nrows] = info
                    end
                end
                lookups[bi] = byKey
            elseif dir == "enum" or dir == "ref" or dir == "doc" then
                directive(dir, seen)
            else
                fail("모르는 블록 @" .. dir)
            end
        end
    end
    if root == nil then return setmetatable({}, OM) end
    return root
end

--- 글을 읽어 값을 돌려준다. 틀리면 nil, "N줄 C칸: 까닭", { line=, col=, message= }.
function M.decode(text)
    if type(text) ~= "string" then return nil, "글이 아니다" end
    local ok, res = pcall(run, text)
    if ok then return res end
    if type(res) == "table" and res.gsd then
        return nil, format("%d줄 %d칸: %s", res.line, res.col, res.message), { line = res.line, col = res.col, message = res.message }
    end
    error(res, 0)
end

--- 틀리면 { line=, col=, message= } 표를 던진다 (tostring 하면 "N줄 C칸: 까닭").
local errMeta = {
    __tostring = function(e) return format("%d줄 %d칸: %s", e.line, e.col, e.message) end,
}
function M.decodeOrError(text)
    local value, msg, err = M.decode(text)
    if value == nil then
        if err then error(setmetatable(err, errMeta), 0) end
        error(msg, 0)
    end
    return value
end

return M
