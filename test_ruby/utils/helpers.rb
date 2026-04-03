class Helpers
  def self.format_name(name)
    name.strip.capitalize
  end

  def self.format_currency(amount)
    "$#{'%.2f' % amount}"
  end

  def self.timestamp
    Time.now.iso8601
  end
end
