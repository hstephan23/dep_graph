import 'package:intl/intl.dart';
import '../models/order.dart';
import '../models/user.dart';

class OrderService {
  bool process(Order order, User? user) {
    print('Processing order ${order.id}');
    if (user != null) {
      print('For user: ${user.name}');
    }
    print('Total: ${order.formatTotal()}');
    return true;
  }

  bool cancel(int orderId) {
    final now = DateTime.now();
    final formatter = DateFormat('yyyy-MM-dd HH:mm:ss');
    print('Canceling order $orderId at ${formatter.format(now)}');
    return true;
  }

  List<Order> getOrdersByUser(User user) {
    return [];
  }
}
