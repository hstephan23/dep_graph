package com.example.services

import com.example.models.User
import java.io.PrintStream

class UserService {
    private val logger = PrintStream(System.out)

    fun save(user: User) {
        logger.println("Saving user: ${user.name}")
    }

    fun findAll(): List<User> {
        return emptyList()
    }

    fun update(user: User): Boolean {
        logger.println("Updating user: ${user.name}")
        return true
    }
}
