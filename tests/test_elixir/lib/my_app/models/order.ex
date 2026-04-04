defmodule MyApp.Models.Order do
  alias MyApp.Models.User

  defstruct [:id, :user_id, :total]

  @type t :: %__MODULE__{
    id: integer(),
    user_id: String.t(),
    total: float()
  }

  def new(id, user_id, total) do
    %__MODULE__{
      id: id,
      user_id: user_id,
      total: total
    }
  end

  def get_owner(%__MODULE__{user_id: user_id}, %User{} = user) do
    user.name
  end

  def format_total(%__MODULE__{total: total}) do
    "$#{Float.to_string(total, decimals: 2)}"
  end

  def is_valid?(%__MODULE__{total: total}) do
    total > 0.0
  end
end
