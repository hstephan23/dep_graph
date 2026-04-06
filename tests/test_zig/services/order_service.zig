const std = @import("std");
const Order = @import("../models/order.zig");
const User = @import("../models/user.zig");

pub const OrderService = struct {
    pub fn init() OrderService {
        return OrderService{};
    }

    pub fn process(self: *OrderService, order: *const Order.Order) void {
        _ = self;
        std.debug.print("Processing order: {d}\n", .{order.id});
    }
};
