use super::utils::helpers;

pub struct Config {
    pub name: String,
}

pub fn load() -> Config {
    helpers::greet();
    Config { name: String::from("default") }
}
