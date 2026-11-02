using System;
using Vumiro.Client;

internal static class Program
{
    private const string Callback = "/vumiro-auth/0123456789abcdefghijklmnopqrstuv/";
    private static int count;

    private static void Check(string name, string target, bool expected, string method = "GET", string host = "127.0.0.1:43821", string extra = "")
    {
        string code, error;
        var accepted = OAuthLogin.ParseCallback(method + " " + target + " HTTP/1.1\r\nHost: " + host + extra, Callback, out code, out error);
        if (accepted != expected) throw new Exception(name + " failed.");
        if (accepted && target.EndsWith("?code=one-use-code") && code != "one-use-code") throw new Exception("Code was changed.");
        count++;
    }

    private static void Main()
    {
        Check("valid callback", Callback + "?code=one-use-code", true);
        Check("provider denial", Callback + "?error=access_denied&error_description=Do+not+log+this", true);
        Check("wrong transaction", "/vumiro-auth/other/?code=abc", false);
        Check("encoded path", Callback.Replace("/vumiro-auth/", "/%76umiro-auth/") + "?code=abc", false);
        Check("non GET callback", Callback + "?code=abc", false, "POST");
        Check("wrong loopback authority", Callback + "?code=abc", false, host: "localhost:43821");
        Check("host rebinding", Callback + "?code=abc", false, host: "attacker.example:43821");
        Check("duplicate host", Callback + "?code=abc", false, extra: "\r\nHost: 127.0.0.1:43821");
        Check("duplicate code", Callback + "?code=abc&code=def", false);
        Check("encoded duplicate code", Callback + "?code=abc&%63ode=def", false);
        Check("ambiguous error and code", Callback + "?code=abc&error=access_denied", false);
        Check("duplicate error", Callback + "?error=a&error=b", false);
        Check("empty code", Callback + "?code=", false);
        Check("missing code", Callback + "?state=abc", false);
        Check("fragment", Callback + "?code=abc#discard", false);
        Check("absolute target", "http://127.0.0.1:43821" + Callback + "?code=abc", false);
        Check("oversized code", Callback + "?code=" + new string('a', 2049), false);
        Check("control character code", Callback + "?code=abc%0Adef", false);
        Console.WriteLine("Passed " + count + " OAuth loopback callback checks.");
    }
}
