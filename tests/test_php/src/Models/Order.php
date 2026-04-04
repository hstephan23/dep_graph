<?php

namespace App\Models;

use App\Models\User;

class Order {
    private $id;
    private $userId;
    private $total;

    public function __construct($id, $userId, $total) {
        $this->id = $id;
        $this->userId = $userId;
        $this->total = $total;
    }

    public function getId() {
        return $this->id;
    }

    public function getUserId() {
        return $this->userId;
    }

    public function getTotal() {
        return $this->total;
    }

    public function getOwner(User $user) {
        return $user->getName();
    }

    public function formatTotal() {
        return sprintf("$%.2f", $this->total);
    }
}
?>
