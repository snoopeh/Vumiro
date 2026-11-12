using System;
using Vumiro.Client;
internal static class Program
{
    static void Main()
    {
        foreach(var value in new[]{"https://checkout.stripe.com/c/pay/cs_test_a", "https://connect.stripe.com/setup/s/abc"})
            if(!MarketplaceLinks.IsAllowed(value))throw new Exception("Valid hosted URL rejected: "+value);
        foreach(var value in new[]{"https://checkout.stripe.com.evil.test/c/pay/a","https://user@connect.stripe.com/setup/s/a","http://checkout.stripe.com/c/pay/a","https://checkout.stripe.com:444/c/pay/a","https://connect.stripe.com/redirect","file:///C:/Windows", "https://checkout.stripe.com/c/pay/../redirect"})
            if(MarketplaceLinks.IsAllowed(value))throw new Exception("Unsafe URL allowed: "+value);
        Console.WriteLine("Marketplace hosted link checks passed.");
    }
}
