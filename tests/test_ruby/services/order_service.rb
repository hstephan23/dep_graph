require_relative '../models/order'

class OrderService
  def process(order)
    puts "Processing order #{order.id}"
  end
end
