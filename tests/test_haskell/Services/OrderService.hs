module Services.OrderService
    ( processOrder
    , findAllOrders
    ) where

import Models.Order
import Models.User

processOrder :: Order -> IO ()
processOrder order = putStrLn $ "Processing order: " ++ show (orderId order)

findAllOrders :: IO [Order]
findAllOrders = return []
