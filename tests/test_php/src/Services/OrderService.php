<?php

namespace App\Services;

use App\Models\Order;
use App\Models\User;
use DateTime;

class OrderService {
    public function process(Order $order, User $user = null) {
        echo "Processing order " . $order->getId() . "\n";
        if ($user) {
            echo "For user: " . $user->getName() . "\n";
        }
        echo "Total: " . $order->formatTotal() . "\n";
        return true;
    }

    public function cancel($orderId) {
        $now = new DateTime();
        echo "Canceling order $orderId at " . $now->format('Y-m-d H:i:s') . "\n";
        return true;
    }

    public function getOrdersByUser(User $user) {
        return array();
    }
}
?>
