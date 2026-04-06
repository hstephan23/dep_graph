local Order = require("models.order")
local User = require("models.user")

local OrderService = {}
OrderService.__index = OrderService

function OrderService.new()
    local self = setmetatable({}, OrderService)
    self.orders = {}
    return self
end

function OrderService:process(order)
    table.insert(self.orders, order)
    print("Processing order: " .. order.id)
end

return OrderService
