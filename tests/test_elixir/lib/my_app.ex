defmodule MyApp do
  alias MyApp.Models.User
  alias MyApp.Models.Order
  alias MyApp.Services.UserService
  alias MyApp.Services.OrderService

  def main do
    user = %User{name: "Alice", age: 30}
    UserService.save(user)

    order = %Order{id: 1, user_id: user.id, total: 99.99}
    OrderService.process(order)

    IO.puts("Done!")
  end
end
