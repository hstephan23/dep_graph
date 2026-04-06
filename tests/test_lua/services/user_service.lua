local User = require("models.user")

local UserService = {}
UserService.__index = UserService

function UserService.new()
    local self = setmetatable({}, UserService)
    self.users = {}
    return self
end

function UserService:save(user)
    table.insert(self.users, user)
    print("Saved user: " .. user:getName())
end

function UserService:findAll()
    return self.users
end

return UserService
