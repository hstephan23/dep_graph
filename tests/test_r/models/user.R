create_user <- function(name, age) {
    user <- list(
        id = sample(1:1000, 1),
        name = name,
        age = age
    )
    class(user) <- "User"
    return(user)
}

print.User <- function(user) {
    cat(sprintf("User(%s, age=%d)\n", user$name, user$age))
}
