package main

import (
	"fmt"
	"net/http"
	"github.com/example/myapp/handlers"
	"github.com/example/myapp/models"
)

func main() {
	fmt.Println("Starting server")
	http.ListenAndServe(":8080", nil)
}
