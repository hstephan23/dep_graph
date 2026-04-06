library(ggplot2)
library(dplyr)

source("models/user.R")
source("models/order.R")
source("services/user_service.R")
source("services/order_service.R")

main <- function() {
    user <- create_user("Alice", 30)
    save_user(user)

    order <- create_order(1, user$id, 99.99)
    process_order(order)

    cat("Done!\n")
}

main()
