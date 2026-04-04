require_relative '../utils/helpers'

class Order
  attr_reader :id, :user_id, :total

  def initialize(id, user_id, total)
    @id = id
    @user_id = user_id
    @total = total
  end

  def formatted_total
    Helpers.format_currency(total)
  end
end
