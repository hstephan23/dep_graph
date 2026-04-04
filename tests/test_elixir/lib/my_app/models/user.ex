defmodule MyApp.Models.User do
  defstruct [:id, :name, :age]

  @type t :: %__MODULE__{
    id: String.t(),
    name: String.t(),
    age: integer()
  }

  def new(name, age) do
    %__MODULE__{
      id: UUID.uuid4(),
      name: name,
      age: age
    }
  end

  def display_name(%__MODULE__{name: name, age: age}) do
    "User: #{name} (Age: #{age})"
  end

  def is_adult?(%__MODULE__{age: age}) do
    age >= 18
  end
end
