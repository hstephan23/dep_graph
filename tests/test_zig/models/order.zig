const std = @import("std");
const User = @import("user.zig");

pub const Order = struct {
    id: u64,
    user_id: u64,
    amount: f64,

    pub fn init(id: u64, user_id: u64, amount: f64) Order {
        return Order{
            .id = id,
            .user_id = user_id,
            .amount = amount,
        };
    }

    pub fn getTotal(self: *const Order) f64 {
        return self.amount;
    }
};
