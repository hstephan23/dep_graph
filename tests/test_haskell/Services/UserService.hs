module Services.UserService
    ( saveUser
    , findAllUsers
    ) where

import Models.User

saveUser :: User -> IO ()
saveUser user = putStrLn $ "Saving user: " ++ userName user

findAllUsers :: IO [User]
findAllUsers = return []
