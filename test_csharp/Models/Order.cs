using System;
using MyApp.Utils;

namespace MyApp.Models
{
    public class Order
    {
        public int Id { get; set; }
        public User Customer { get; set; }
    }
}
