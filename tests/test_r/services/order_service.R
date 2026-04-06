source("models/order.R")
source("models/user.R")

process_order <- function(order) {
    cat(sprintf("Processing order: %d\n", order$id))
}

find_all_orders <- function() {
    return(list())
}
