local User = require("models.user")

local Order = {}
Order.__index = Order

function Order.new(id, userId, amount)
    local self = setmetatable({}, Order)
    self.id = id
    self.userId = userId
    self.amount = amount
    return self
end

function Order:getTotal()
    return self.amount
end

return Order
