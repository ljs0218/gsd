--[[
    JSON 읽기와 쓰기. 순수 Lua 5.1.

    LÖVE 에는 JSON 이 안 들어 있다. 맵 파일을 읽고, 서버와 주고받는 메시지를
    싸고 푸는 데 필요한 만큼만 둔다.

    ## null

    Lua 표에 nil 을 넣으면 그 칸이 사라진다. `[1, null, 3]` 을 그냥 읽으면
    길이가 1 이나 3 으로 나오고, 뒤 칸이 앞으로 당겨져 보이기도 한다. 타일
    배열이라면 그 뒤 타일이 전부 한 칸씩 밀린다. 그래서 null 은 `M.null`
    이라는 표지로 남긴다 — 칸 수가 그대로고, 읽는 쪽이 "null 이다" 를 알아챈다.

    ## 배열과 객체

    빈 `[]` 와 빈 `{}` 는 Lua 에서 똑같은 빈 표다. 배열에는 `M.isArray` 로 알 수
    있는 표지를 붙여 둔다. 배열이어야 할 자리에 객체가 오면 거부할 수 있게.

    ## 거부하는 것

    틀린 문법, 뒤에 붙은 찌꺼기, 한 객체 안에 겹친 열쇠. 겹친 열쇠는 JSON
    규격상 허용이지만 어느 쪽을 믿을지 읽는 쪽마다 다르므로 받지 않는다.
]]

local M = {}

--- null 자리 표지. 다른 값과 헷갈리지 않게 표 하나로 둔다.
M.null = setmetatable({}, {
    __tostring = function() return "null" end,
})

local arrayMeta = { __jsontype = "array" }
local objectMeta = { __jsontype = "object" }

function M.isArray(value)
    return type(value) == "table" and getmetatable(value) == arrayMeta
end

function M.isObject(value)
    return type(value) == "table" and getmetatable(value) == objectMeta
end

local byte, sub, find, char = string.byte, string.sub, string.find, string.char

local function lineCol(text, pos)
    local line, col = 1, 1
    for i = 1, pos - 1 do
        if byte(text, i) == 10 then
            line = line + 1
            col = 1
        else
            col = col + 1
        end
    end
    return line, col
end

local function fail(text, pos, message)
    local line, col = lineCol(text, pos)
    error({ json = true, message = string.format("%d줄 %d칸: %s", line, col, message) }, 0)
end

local function skipSpace(text, pos)
    -- JSON 공백은 넷뿐이다. %s 는 \v \f 까지 받으므로 안 쓴다.
    local _, last = find(text, "^[ \t\r\n]*", pos)
    return last + 1
end

local function utf8(code)
    if code < 0x80 then
        return char(code)
    elseif code < 0x800 then
        return char(0xC0 + math.floor(code / 0x40), 0x80 + code % 0x40)
    elseif code < 0x10000 then
        return char(
            0xE0 + math.floor(code / 0x1000),
            0x80 + math.floor(code / 0x40) % 0x40,
            0x80 + code % 0x40
        )
    end
    return char(
        0xF0 + math.floor(code / 0x40000),
        0x80 + math.floor(code / 0x1000) % 0x40,
        0x80 + math.floor(code / 0x40) % 0x40,
        0x80 + code % 0x40
    )
end

local escapes = {
    [34] = '"', [92] = "\\", [47] = "/",
    [98] = "\b", [102] = "\f", [110] = "\n", [114] = "\r", [116] = "\t",
}

local function readHex4(text, pos)
    local hex = sub(text, pos, pos + 3)
    if not find(hex, "^%x%x%x%x$") then
        fail(text, pos, "\\u 뒤에 16진 네 자리가 와야 한다")
    end
    return tonumber(hex, 16)
end

local function parseString(text, pos)
    -- pos 는 여는 따옴표 다음 칸.
    local parts = {}
    local start = pos
    while true do
        local c = byte(text, pos)
        if not c then
            fail(text, start - 1, "문자열이 안 닫혔다")
        elseif c == 34 then
            parts[#parts + 1] = sub(text, start, pos - 1)
            return table.concat(parts), pos + 1
        elseif c == 92 then
            parts[#parts + 1] = sub(text, start, pos - 1)
            local e = byte(text, pos + 1)
            if e == 117 then
                local code = readHex4(text, pos + 2)
                pos = pos + 6
                -- BMP 밖 글자(이모지 등)는 \u 두 개로 쪼개져 온다(서로게이트 짝).
                if code >= 0xD800 and code <= 0xDBFF then
                    if sub(text, pos, pos + 1) ~= "\\u" then
                        fail(text, pos, "짝이 없는 서로게이트")
                    end
                    local low = readHex4(text, pos + 2)
                    if low < 0xDC00 or low > 0xDFFF then
                        fail(text, pos, "짝이 없는 서로게이트")
                    end
                    code = 0x10000 + (code - 0xD800) * 0x400 + (low - 0xDC00)
                    pos = pos + 6
                elseif code >= 0xDC00 and code <= 0xDFFF then
                    fail(text, pos - 6, "짝이 없는 서로게이트")
                end
                parts[#parts + 1] = utf8(code)
            elseif e and escapes[e] then
                parts[#parts + 1] = escapes[e]
                pos = pos + 2
            else
                fail(text, pos, "모르는 이스케이프")
            end
            start = pos
        elseif c < 32 then
            fail(text, pos, "문자열 안에 제어 문자")
        else
            pos = pos + 1
        end
    end
end

local function parseNumber(text, pos)
    -- JSON 문법 그대로: 앞의 0 금지, 소수점 뒤 숫자 필수, + 부호 금지.
    local _, last = find(text, "^-?0", pos)
    if not last then
        _, last = find(text, "^-?[1-9]%d*", pos)
    end
    if not last then
        fail(text, pos, "숫자가 아니다")
    end
    local _, fracLast = find(text, "^%.%d+", last + 1)
    if fracLast then
        last = fracLast
    elseif sub(text, last + 1, last + 1) == "." then
        fail(text, last + 1, "소수점 뒤에 숫자가 없다")
    end
    local _, expLast = find(text, "^[eE][-+]?%d+", last + 1)
    if expLast then
        last = expLast
    elseif find(text, "^[eE]", last + 1) then
        fail(text, last + 1, "지수가 비었다")
    end
    -- 01 처럼 0 뒤에 숫자가 이어지면 위에서 "-?0" 만 먹고 끝나므로 여기서 잡힌다.
    if find(text, "^[%d]", last + 1) then
        fail(text, pos, "앞에 0 을 붙인 숫자")
    end
    return tonumber(sub(text, pos, last)), last + 1
end

local parseValue

local function parseArray(text, pos)
    local result = setmetatable({}, arrayMeta)
    local n = 0
    pos = skipSpace(text, pos)
    if byte(text, pos) == 93 then
        return result, pos + 1
    end
    while true do
        local value
        value, pos = parseValue(text, pos)
        n = n + 1
        -- nil 이 오는 일은 없다. null 도 표지로 들어온다. 그래서 칸이 안 밀린다.
        result[n] = value
        pos = skipSpace(text, pos)
        local c = byte(text, pos)
        if c == 93 then
            return result, pos + 1
        elseif c ~= 44 then
            fail(text, pos, "배열에서 , 나 ] 가 와야 한다")
        end
        pos = pos + 1
    end
end

local function parseObject(text, pos)
    local result = setmetatable({}, objectMeta)
    pos = skipSpace(text, pos)
    if byte(text, pos) == 125 then
        return result, pos + 1
    end
    while true do
        pos = skipSpace(text, pos)
        if byte(text, pos) ~= 34 then
            fail(text, pos, "객체 열쇠는 문자열이어야 한다")
        end
        local keyPos = pos
        local key
        key, pos = parseString(text, pos + 1)
        pos = skipSpace(text, pos)
        if byte(text, pos) ~= 58 then
            fail(text, pos, "열쇠 뒤에 : 가 와야 한다")
        end
        local value
        value, pos = parseValue(text, pos + 1)
        if result[key] ~= nil then
            fail(text, keyPos, "열쇠가 겹친다: " .. key)
        end
        result[key] = value
        pos = skipSpace(text, pos)
        local c = byte(text, pos)
        if c == 125 then
            return result, pos + 1
        elseif c ~= 44 then
            fail(text, pos, "객체에서 , 나 } 가 와야 한다")
        end
        pos = pos + 1
    end
end

parseValue = function(text, pos)
    pos = skipSpace(text, pos)
    local c = byte(text, pos)
    if c == 123 then
        return parseObject(text, pos + 1)
    elseif c == 91 then
        return parseArray(text, pos + 1)
    elseif c == 34 then
        return parseString(text, pos + 1)
    elseif c == 45 or (c and c >= 48 and c <= 57) then
        return parseNumber(text, pos)
    elseif sub(text, pos, pos + 3) == "true" then
        return true, pos + 4
    elseif sub(text, pos, pos + 4) == "false" then
        return false, pos + 5
    elseif sub(text, pos, pos + 3) == "null" then
        return M.null, pos + 4
    elseif not c then
        fail(text, pos, "값이 와야 하는데 끝났다")
    end
    fail(text, pos, "모르는 값")
end

--[[
    글을 읽어 값을 돌려준다. 틀리면 nil 과 까닭.

    error 를 던지지 않는다. 맵 파일 하나가 틀렸다고 게임이 통째로 죽으면 안
    되고, 부르는 쪽이 까닭을 보여 줄 수 있어야 한다.
]]
function M.decode(text)
    if type(text) ~= "string" then
        return nil, "글이 아니다"
    end
    local ok, value, pos = pcall(parseValue, text, 1)
    if not ok then
        if type(value) == "table" and value.json then
            return nil, value.message
        end
        error(value, 0)
    end
    pos = skipSpace(text, pos)
    if pos <= #text then
        local _, message = pcall(fail, text, pos, "값 뒤에 찌꺼기가 있다")
        return nil, message.message
    end
    return value
end

--[[
    값을 JSON 글로. 메시지를 싸는 데 쓴다.

    `M.isArray` 표지가 붙은 표와, 1..n 으로 빈틈없이 찬 표는 배열로 쓴다. 나머지
    표는 객체다. 빈 표는 객체(`{}`)로 쓴다 — 메시지에 빈 배열이 나올 일이 없다.
    객체 열쇠는 정렬해서 쓴다. 같은 값이면 늘 같은 글이 나와야 비교하기 쉽다.

    NaN, 무한대, 함수, 문자열이 아닌 객체 열쇠는 쓰지 않고 error 를 낸다.
    조용히 null 로 바꾸면 서버가 엉뚱한 값을 받는다.
]]
local encodeValue

local function encodeString(value)
    return '"' .. value:gsub('[%c"\\]', function(c)
        if c == '"' then return '\\"' end
        if c == "\\" then return "\\\\" end
        if c == "\n" then return "\\n" end
        if c == "\t" then return "\\t" end
        if c == "\r" then return "\\r" end
        return string.format("\\u%04x", byte(c))
    end) .. '"'
end

local function isSequence(value)
    local n = 0
    for _ in pairs(value) do n = n + 1 end
    if n == 0 then return false end
    for i = 1, n do
        if value[i] == nil then return false end
    end
    return true
end

encodeValue = function(value, out)
    local kind = type(value)
    if value == M.null or value == nil then
        out[#out + 1] = "null"
    elseif kind == "boolean" then
        out[#out + 1] = value and "true" or "false"
    elseif kind == "number" then
        if value ~= value or value == math.huge or value == -math.huge then
            error("JSON 에 못 쓰는 수: " .. tostring(value), 0)
        end
        if value == math.floor(value) and math.abs(value) < 2 ^ 53 then
            out[#out + 1] = string.format("%d", value)
        else
            out[#out + 1] = string.format("%.17g", value)
        end
    elseif kind == "string" then
        out[#out + 1] = encodeString(value)
    elseif kind == "table" then
        if M.isArray(value) or isSequence(value) then
            out[#out + 1] = "["
            for i = 1, #value do
                if i > 1 then out[#out + 1] = "," end
                encodeValue(value[i], out)
            end
            out[#out + 1] = "]"
        else
            local keys = {}
            for k in pairs(value) do
                if type(k) ~= "string" then
                    error("JSON 객체 열쇠가 문자열이 아니다: " .. tostring(k), 0)
                end
                keys[#keys + 1] = k
            end
            table.sort(keys)
            out[#out + 1] = "{"
            for i, k in ipairs(keys) do
                if i > 1 then out[#out + 1] = "," end
                out[#out + 1] = encodeString(k)
                out[#out + 1] = ":"
                encodeValue(value[k], out)
            end
            out[#out + 1] = "}"
        end
    else
        error("JSON 에 못 쓰는 값: " .. kind, 0)
    end
end

function M.encode(value)
    local out = {}
    encodeValue(value, out)
    return table.concat(out)
end

return M
