require_relative 'models/user'
require_relative 'models/order'
require_relative 'services/user_service'
require 'json'

user = User.new("Alice", 30)
service = UserService.new
service.save(user)
puts "Done!"
