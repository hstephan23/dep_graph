defmodule MyApp.Services.OrderService do
  alias MyApp.Models.Order
  alias MyApp.Models.User
  require Logger

  def process(%Order{} = order, %User{} = user) do
    IO.puts("Processing order #{order.id} for user #{user.name}")
    IO.puts("Total: #{Order.format_total(order)}")
    true
  end

  def cancel(order_id) do
    now = DateTime.utc_now() |> DateTime.to_string()
    IO.puts("Canceling order #{order_id} at #{now}")
    true
  end

  def get_orders_by_user(%User{} = user) do
    []
  end
end
