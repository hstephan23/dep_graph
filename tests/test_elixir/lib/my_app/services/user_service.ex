defmodule MyApp.Services.UserService do
  alias MyApp.Models.User

  def save(%User{} = user) do
    {:ok, user}
  end
end
