package com.example.models

import java.util.UUID

case class User(
    name: String,
    age: Int
) {
    val id: String = UUID.randomUUID().toString()

    def displayName: String = {
        s"User: $name (Age: $age)"
    }

    def isAdult: Boolean = age >= 18
}
