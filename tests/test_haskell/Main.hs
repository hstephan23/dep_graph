module Main where

import Data.List
import System.IO
import Models.User
import Models.Order
import Services.UserService
import Services.OrderService

main :: IO ()
main = do
    let user = mkUser "Alice" 30
    let saved = saveUser user
    let order = mkOrder 1 (userId user) 99.99
    let processed = processOrder order
    putStrLn "Done!"
