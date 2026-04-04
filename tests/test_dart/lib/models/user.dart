import 'package:uuid/uuid.dart';

class User {
  final String id;
  final String name;
  final int age;

  User(this.name, this.age) : id = const Uuid().v4();

  String displayName() {
    return 'User: $name (Age: $age)';
  }

  bool get isAdult => age >= 18;
}
