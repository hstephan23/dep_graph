import Foundation
import Models
import Services

let user = User(name: "Alice", age: 30)
let service = UserService()
service.save(user: user)
print("Done!")
