import Foundation
import Models
import Utils

class UserService {
    func save(user: User) {
        let log = Helpers.timestamp()
        print("\(log): Saving \(user.name)")
    }

    func findAll() -> [User] {
        return []
    }
}
