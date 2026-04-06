const std = @import("std");
const User = @import("../models/user.zig");

pub const UserService = struct {
    pub fn init() UserService {
        return UserService{};
    }

    pub fn save(self: *UserService, user: *const User.User) void {
        _ = self;
        std.debug.print("Saving user: {s}\n", .{user.name});
    }
};
