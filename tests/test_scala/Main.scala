import com.example.models.User
import com.example.models.Order
import com.example.services.UserService
import com.example.services.OrderService
import scala.collection.mutable

object Main {
  def main(args: Array[String]): Unit = {
    val user = User("Alice", 30)
    val userService = new UserService()
    userService.save(user)

    val order = Order(1L, user.id, 99.99)
    val orderService = new OrderService()
    orderService.process(order)

    println("Done!")
  }
}
