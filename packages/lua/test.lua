--[[
    GSD 읽기 (packages/lua/gsd.lua) 검사 — 명세 SPEC.md, 공용 표본 fixtures/:
      - `<이름>.gsd` 를 읽은 값이 같은 이름 `.json` 을 test/json.lua 로 읽은 값과 같다
        (빈 배열·빈 객체 표지, null 표지까지 깊은 비교)
      - `<이름>.bad.gsd` 는 오류가 나고, 오류 줄이 `.bad.line` 과 같다

        cd packages/lua && luajit test.lua
]]
package.path = "./?.lua;./test/?.lua;" .. package.path

local failures, n = 0, 0
local function check(what, ok, detail)
    n = n + 1
    if not ok then
        failures = failures + 1
        print("  X  " .. what .. (detail ~= nil and ("  (" .. tostring(detail) .. ")") or ""))
    end
end

local json = require("json")
local gsd = require("gsd")
gsd.adopt(json)

local function readFile(path)
    local f = io.open(path, "rb")
    if not f then return nil end
    local s = f:read("*a")
    f:close()
    return s
end

local function listDir(dir, pattern)
    local out = {}
    local p = io.popen('ls "' .. dir .. '" 2>/dev/null')
    for name in p:lines() do
        if name:match(pattern) then out[#out + 1] = name end
    end
    p:close()
    table.sort(out)
    return out
end

-- 깊은 비교: 값, 표지(메타테이블), null 표지, 배열 길이까지. 다르면 위치 글을 돌려준다.
local function diff(a, b, path)
    if type(a) ~= type(b) then return path .. ": 종류 " .. type(a) .. " ~= " .. type(b) end
    if type(a) ~= "table" then
        if a ~= b then return path .. ": " .. tostring(a) .. " ~= " .. tostring(b) end
        return nil
    end
    if a == json.null or b == json.null then
        if a ~= b then return path .. ": null 표지가 한쪽만" end
        return nil
    end
    if getmetatable(a) ~= getmetatable(b) then return path .. ": 배열/객체 표지가 다르다" end
    for k, v in pairs(a) do
        local d = diff(v, b[k], path .. "." .. tostring(k))
        if d then return d end
    end
    for k in pairs(b) do
        if a[k] == nil then return path .. "." .. tostring(k) .. ": 한쪽에 없다" end
    end
    return nil
end

local function compare(what, gsdPath, jsonPath)
    local g, gerr = gsd.decode(readFile(gsdPath))
    if g == nil then
        check(what, false, gerr)
        return
    end
    local want, jerr = json.decode(readFile(jsonPath))
    if want == nil then
        check(what .. " (json 읽기)", false, jerr)
        return
    end
    local d = diff(g, want, "$")
    check(what, d == nil, d)
end

------------------------------------------------------------------
-- 공용 표본

local fx = "../../fixtures"
for _, name in ipairs(listDir(fx, "%.gsd$")) do
    local base = name:gsub("%.gsd$", "")
    if base:match("%.bad$") then
        local stem = base:gsub("%.bad$", "")
        local want = tonumber((readFile(fx .. "/" .. base .. ".line") or ""):match("%d+"))
        local v, msg, err = gsd.decode(readFile(fx .. "/" .. name))
        check("bad " .. stem .. " 은 오류", v == nil, "읽혔다")
        check("bad " .. stem .. " 오류 줄", err ~= nil and err.line == want, tostring(msg) .. " / 기대 " .. tostring(want))
    else
        compare("표본 " .. base, fx .. "/" .. name, fx .. "/" .. base .. ".json")
    end
end

-- 오류가 error 를 던지지 않고 json.decode 처럼 nil, 글을 돌려준다
do
    local v, msg = gsd.decode("zzz")
    check("decode 오류는 nil, 글", v == nil and type(msg) == "string")
    check("decodeOrError 는 던진다", not pcall(gsd.decodeOrError, "zzz"))
    local ok, val = pcall(gsd.decodeOrError, "@props\na:int = 1\n")
    check("decodeOrError 정상", ok and val.a == 1 and gsd.isObject(val))
end

if failures == 0 then
    print(string.format("gsd-lua: OK (%d건)", n))
else
    print(string.format("gsd-lua: 실패 %d / %d", failures, n))
    os.exit(1)
end
