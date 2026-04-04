package com.example.services

import com.example.models.User
import scala.io.Source

class UserService {
    def save(user: User): Unit = {
        println(s"Saving user: ${user.name}")
    }

    def findAll: List[User] = {
        List.empty[User]
    }

    def update(user: User): Boolean = {
        println(s"Updating user: ${user.name}")
        true
    }
}
