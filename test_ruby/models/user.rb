require_relative '../utils/helpers'

class User
  attr_reader :name, :age

  def initialize(name, age)
    @name = name
    @age = age
  end

  def to_s
    Helpers.format_name(name)
  end
end
