import 'package:logging/logging.dart';
import '../models/user.dart';

class UserService {
  final Logger _logger = Logger('UserService');

  void save(User user) {
    _logger.info('Saving user: ${user.name}');
  }

  List<User> findAll() {
    return [];
  }

  bool update(User user) {
    _logger.info('Updating user: ${user.name}');
    return true;
  }
}
