package com.example.services

import com.example.models.{Order, User}
import java.time.LocalDateTime

class OrderService {
    def process(order: Order, user: User): Boolean = {
        println(s"Processing order ${order.id} for user ${user.name}")
        println(s"Total: ${order.formatTotal}")
        true
    }

    def cancel(orderId: Long): Boolean = {
        println(s"Canceling order $orderId at ${LocalDateTime.now()}")
        true
    }

    def getOrdersByUser(user: User): List[Order] = {
        List.empty[Order]
    }
}
