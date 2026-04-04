<?php

namespace App\Services;

use App\Models\User;
use Monolog\Logger;

class UserService {
    private $logger;

    public function __construct() {
        $this->logger = new Logger('UserService');
    }

    public function save(User $user) {
        $this->logger->info("Saving user: " . $user->getName());
    }

    public function findAll() {
        return array();
    }

    public function update(User $user) {
        $this->logger->info("Updating user: " . $user->getName());
        return true;
    }
}
?>
