const std = @import("std");
const User = @import("models/user.zig");
const Order = @import("models/order.zig");
const UserService = @import("services/user_service.zig");
const OrderService = @import("services/order_service.zig");

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    var user = User.init("Alice", 30);
    var service = UserService.init();
    service.save(&user);

    var order = Order.init(1, user.id, 99.99);
    var orderService = OrderService.init();
    orderService.process(&order);

    try stdout.print("Done!\n", .{});
}
