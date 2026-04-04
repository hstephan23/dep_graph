import com.example.models.User
import com.example.models.Order
import com.example.services.UserService
import com.example.services.OrderService
import kotlin.collections.List

fun main() {
    val user = User("Alice", 30)
    val userService = UserService()
    userService.save(user)

    val order = Order(1, user.id, 99.99)
    val orderService = OrderService()
    orderService.process(order)

    println("Done!")
}
