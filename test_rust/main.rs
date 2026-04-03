mod utils;
mod config;
use crate::utils::helpers;
pub use crate::config::Config;
extern crate serde;
extern crate log as logger;

fn main() {
    helpers::greet();
    let cfg = config::load();
}
