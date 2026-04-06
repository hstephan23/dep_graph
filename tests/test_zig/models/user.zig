const std = @import("std");

pub const User = struct {
    id: u64,
    name: []const u8,
    age: u32,

    pub fn init(name: []const u8, age: u32) User {
        return User{
            .id = 0,
            .name = name,
            .age = age,
        };
    }

    pub fn getName(self: *const User) []const u8 {
        return self.name;
    }
};
