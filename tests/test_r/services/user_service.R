source("models/user.R")

save_user <- function(user) {
    cat(sprintf("Saving user: %s\n", user$name))
}

find_all_users <- function() {
    return(list())
}
