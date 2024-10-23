local a = 1
local b = 0

while true do
    a = a + 1
    b = a % 2 == 0 and 1 or 2
    print("LOL", b)
end