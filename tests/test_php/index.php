<?php

require_once 'src/Models/User.php';
require_once 'src/Models/Order.php';
require_once 'src/Services/UserService.php';
require_once 'src/Services/OrderService.php';

use App\Models\User;
use App\Models\Order;
use App\Services\UserService;
use App\Services\OrderService;

$user = new User("Alice", 30);
$userService = new UserService();
$userService->save($user);

$order = new Order(1, $user->getId(), 99.99);
$orderService = new OrderService();
$orderService->process($order);

echo "Done!\n";
?>
