defmodule MyApp.Services.UserService do
  alias MyApp.Models.User
  require Logger

  def save(%User{} = user) do
    Logger.info("Saving user: #{user.name}")
  end

  def find_all do
    []
  end

  def update(%User{} = user) do
    Logger.info("Updating user: #{user.name}")
    true
  end
end
