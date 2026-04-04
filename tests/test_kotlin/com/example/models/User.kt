package com.example.models

data class User(
    val name: String,
    val age: Int
) {
    val id: String = java.util.UUID.randomUUID().toString()

    fun displayName(): String {
        return "User: $name (Age: $age)"
    }
}
