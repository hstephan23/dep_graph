require_relative '../models/user'
require_relative '../utils/helpers'
require 'logger'

class UserService
  def initialize
    @logger = Logger.new(STDOUT)
  end

  def save(user)
    @logger.info("Saving #{user.name}")
  end

  def find_all
    []
  end
end
