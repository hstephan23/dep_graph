module Models.Order
    ( Order(..)
    , mkOrder
    , orderTotal
    ) where

import Models.User

data Order = Order
    { orderId     :: Int
    , orderUserId :: Int
    , orderAmount :: Double
    } deriving (Show, Eq)

mkOrder :: Int -> Int -> Double -> Order
mkOrder oid uid amount = Order
    { orderId = oid
    , orderUserId = uid
    , orderAmount = amount
    }

orderTotal :: Order -> Double
orderTotal = orderAmount
