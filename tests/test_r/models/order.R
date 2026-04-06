source("models/user.R")

create_order <- function(id, user_id, amount) {
    order <- list(
        id = id,
        user_id = user_id,
        amount = amount
    )
    class(order) <- "Order"
    return(order)
}

order_total <- function(order) {
    return(order$amount)
}
