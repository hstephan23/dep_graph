local User = require("models.user")
local Order = require("models.order")
local UserService = require("services.user_service")
local OrderService = require("services.order_service")
local json = require("cjson")

local function main()
    local user = User.new("Alice", 30)
    local userService = UserService.new()
    userService:save(user)

    local order = Order.new(1, user.id, 99.99)
    local orderService = OrderService.new()
    orderService:process(order)

    print("Done!")
end

main()
