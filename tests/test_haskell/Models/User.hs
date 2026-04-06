module Models.User
    ( User(..)
    , mkUser
    , userId
    , userName
    ) where

data User = User
    { userId   :: Int
    , userName :: String
    , userAge  :: Int
    } deriving (Show, Eq)

mkUser :: String -> Int -> User
mkUser name age = User
    { userId = 0
    , userName = name
    , userAge = age
    }
