defmodule MyApp.Services.OrderService do
  alias MyApp.Models.Order

  def process(%Order{} = order) do
    {:ok, order}
  end
end
