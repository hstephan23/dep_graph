import Foundation
import Utils

struct Order {
    let id: Int
    let userId: Int
    let total: Double

    func formatted() -> String {
        return Helpers.formatCurrency(total)
    }
}
