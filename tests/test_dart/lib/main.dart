import 'dart:async';
import 'models/user.dart';
import 'models/order.dart';
import 'services/user_service.dart';
import 'services/order_service.dart';

void main() async {
  final user = User('Alice', 30);
  final userService = UserService();
  userService.save(user);

  final order = Order(1, user.id, 99.99);
  final orderService = OrderService();
  orderService.process(order);

  print('Done!');
}
