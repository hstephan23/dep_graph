package com.example.services

import com.example.models.Order
import com.example.models.User
import java.time.LocalDateTime

class OrderService {
    fun process(order: Order, user: User): Boolean {
        println("Processing order ${order.id} for user ${user.name}")
        println("Total: ${order.formatTotal()}")
        return true
    }

    fun cancel(orderId: Long): Boolean {
        println("Canceling order $orderId at ${LocalDateTime.now()}")
        return true
    }

    fun getOrdersByUser(user: User): List<Order> {
        return emptyList()
    }
}
