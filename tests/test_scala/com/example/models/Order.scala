package com.example.models

case class Order(
    id: Long,
    userId: String,
    total: Double
) {
    def getOwner(user: User): String = {
        user.name
    }

    def formatTotal: String = {
        f"$$${total}%.2f"
    }

    def isValid: Boolean = total > 0.0
}
