using System;
using System.Text;

namespace MyApp.Utils
{
    public static class Helpers
    {
        public static string FormatDate(DateTime date) => date.ToString("yyyy-MM-dd");
    }
}
