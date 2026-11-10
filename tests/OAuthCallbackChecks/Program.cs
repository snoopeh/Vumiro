using System;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Collections.Generic;
using System.IO;
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
        if (!OAuthLogin.IsBrowserExecutable(@"C:\Browser\browser.exe", @"c:\browser\BROWSER.EXE") ||
            OAuthLogin.IsBrowserExecutable(@"C:\Browser\browser.exe", @"C:\Browser\browser.exe.attacker.exe") ||
            OAuthLogin.IsBrowserExecutable(@"C:\Browser\browser.exe", @"C:\Other\browser.exe") ||
            OAuthLogin.IsBrowserExecutable("", @"C:\Browser\browser.exe"))
            throw new Exception("Browser focus must match the registered executable, not just its name.");
        count++;
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
        var body = OAuthLogin.CallbackBody(true);
        var script = Regex.Match(body, "<script>(.*?)</script>").Groups[1].Value;
        if (!script.Contains("window.close()") || !script.Contains("history.replaceState") || !body.Contains("If this tab stays open")) throw new Exception("Missing browser return behavior.");
        using (var hash = SHA256.Create())
            if (!OAuthLogin.CallbackContentSecurityPolicy.Contains("'sha256-" + Convert.ToBase64String(hash.ComputeHash(Encoding.UTF8.GetBytes(script))) + "'")) throw new Exception("Browser return script is blocked by CSP.");
        if (OAuthLogin.CallbackBody(false).Contains("<script>") || OAuthLogin.CallbackBody(false).Contains("window.close")) throw new Exception("Denied sign-in must leave a useful error page.");
        count += 3;
        var caption = new CaptionClickTracker();
        if (caption.IsDoubleClick(100, 10, 10, 500, 4, 4) || !caption.IsDoubleClick(200, 11, 10, 500, 4, 4)) throw new Exception("Caption double-click was missed.");
        if (caption.IsDoubleClick(250, 11, 10, 500, 4, 4)) throw new Exception("Triple click must start a new pair.");
        caption.Reset();
        if (caption.IsDoubleClick(300, 11, 10, 500, 4, 4) || caption.IsDoubleClick(900, 11, 10, 500, 4, 4)) throw new Exception("Slow clicks must not maximize.");
        if (caption.IsDoubleClick(950, 30, 10, 500, 4, 4)) throw new Exception("Separate caption positions must not maximize.");
        caption.Reset();
        if (caption.IsDoubleClick(uint.MaxValue - 20, 1, 1, 500, 4, 4) || !caption.IsDoubleClick(20, 1, 1, 500, 4, 4)) throw new Exception("Tick wraparound must preserve double-click timing.");
        count += 5;
        CheckLocalQaConfiguration();
        Console.WriteLine("Passed " + count + " desktop OAuth, caption and local QA checks.");
    }

    private static void CheckLocalQaConfiguration()
    {
        var root = Path.Combine(Path.GetTempPath(), "vumiro-runtime-check-" + Guid.NewGuid().ToString("N"));
        var web = Path.Combine(root, "checkout", "WebServer");
        Directory.CreateDirectory(web);
        foreach (var file in new[] { "friends.html", "auth.html", "call.html" }) File.WriteAllText(Path.Combine(web, file), "test");
        var local = Path.Combine(root, "AppData");
        var install = Path.Combine(root, "installed");
        var production = Path.Combine(local, "ScreenTask");
        var data = Path.Combine(local, "Vumiro", "LocalQA", "workspace");
        var values = new Dictionary<string, string> {
            { "VUMIRO_DEV_WEB_ROOT", web }, { "VUMIRO_DEV_DATA_ROOT", data },
            { "VUMIRO_DEV_LABEL", "abc123 + working tree" },
            { "WEBVIEW2_USER_DATA_FOLDER", Path.Combine(production, "ClientBrowser") }
        };
        Func<string, string> env = key => values.ContainsKey(key) ? values[key] : null;
        try
        {
            var release = ClientRuntime.Create(false, env, local, install);
            if (release.IsLocalQa || !release.UpdatesEnabled || release.DataDirectory != production || release.WebRoot != Path.Combine(install, "WebServer"))
                throw new Exception("Release mode accepted local QA overrides.");
            var qa = ClientRuntime.Create(true, env, local, install);
            if (!qa.IsLocalQa || qa.UpdatesEnabled || qa.DataDirectory != data || qa.WebRoot != web ||
                qa.BrowserProfileDirectory != Path.Combine(data, "ClientBrowser") || !qa.Label.Contains("abc123"))
                throw new Exception("Local QA did not isolate native/browser data or use the checkout.");
            count += 2;
            values.Remove("VUMIRO_DEV_DATA_ROOT");
            RejectLocalQa(env, local, install);
            values["VUMIRO_DEV_DATA_ROOT"] = production;
            RejectLocalQa(env, local, install);
            values["VUMIRO_DEV_DATA_ROOT"] = Path.Combine(production, "nested");
            RejectLocalQa(env, local, install);
            values["VUMIRO_DEV_DATA_ROOT"] = local;
            RejectLocalQa(env, local, install);
            values["VUMIRO_DEV_DATA_ROOT"] = "relative-profile";
            RejectLocalQa(env, local, install);
            values["VUMIRO_DEV_DATA_ROOT"] = data;
            values["VUMIRO_DEV_WEB_ROOT"] = Path.Combine(root, "missing-assets");
            RejectLocalQa(env, local, install);
            values.Remove("VUMIRO_DEV_WEB_ROOT");
            values["WEBVIEW2_USER_DATA_FOLDER"] = Path.Combine(root, "custom-browser");
            var normal = ClientRuntime.Create(true, env, local, install);
            if (normal.IsLocalQa || normal.DataDirectory != production || normal.BrowserProfileDirectory != values["WEBVIEW2_USER_DATA_FOLDER"])
                throw new Exception("Normal launch or its existing explicit browser override changed.");
            count++;
        }
        finally { Directory.Delete(root, true); }
    }

    private static void RejectLocalQa(Func<string, string> env, string local, string install)
    {
        try { ClientRuntime.Create(true, env, local, install); }
        catch (ArgumentException) { count++; return; }
        catch (IOException) { count++; return; }
        throw new Exception("Unsafe or incomplete local QA configuration was accepted.");
    }
}
