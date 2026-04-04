import Foundation

enum Helpers {
    static func timestamp() -> String {
        return ISO8601DateFormatter().string(from: Date())
    }

    static func formatCurrency(_ amount: Double) -> String {
        return String(format: "$%.2f", amount)
    }
}
