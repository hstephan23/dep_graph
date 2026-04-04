<?php

namespace App\Models;

class User {
    private $id;
    private $name;
    private $age;

    public function __construct($name, $age) {
        $this->id = uniqid();
        $this->name = $name;
        $this->age = $age;
    }

    public function getId() {
        return $this->id;
    }

    public function getName() {
        return $this->name;
    }

    public function getAge() {
        return $this->age;
    }

    public function displayName() {
        return "User: {$this->name} (Age: {$this->age})";
    }
}
?>
