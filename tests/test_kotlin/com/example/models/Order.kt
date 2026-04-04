package com.example.models

import com.example.models.User

data class Order(
    val id: Long,
    val userId: String,
    val total: Double
) {
    fun getOwner(user: User): String {
        return user.name
    }

    fun formatTotal(): String {
        return String.format("$%.2f", total)
    }
}
