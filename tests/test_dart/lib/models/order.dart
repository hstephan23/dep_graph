import 'user.dart';

class Order {
  final int id;
  final String userId;
  final double total;

  Order(this.id, this.userId, this.total);

  String getOwner(User user) {
    return user.name;
  }

  String formatTotal() {
    return '\$${total.toStringAsFixed(2)}';
  }

  bool get isValid => total > 0.0;
}
