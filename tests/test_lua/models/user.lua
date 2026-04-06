local User = {}
User.__index = User

function User.new(name, age)
    local self = setmetatable({}, User)
    self.id = math.random(1000)
    self.name = name
    self.age = age
    return self
end

function User:getName()
    return self.name
end

return User
