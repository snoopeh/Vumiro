namespace Vumiro.Android;

public sealed class HostPolicy(IEnumerable<string> assets)
{
    public const string Origin="https://vumiro.local";
    // Page routing includes auth redirects; native Back must never replay it.
    public static string BackAction(string? webResult)=>webResult=="true"?"handled":"background";
    private readonly HashSet<string> allowed=new(assets,StringComparer.Ordinal);
    public string? AssetPath(string url)
    {
        if(!Uri.TryCreate(url,UriKind.Absolute,out var uri)||uri.Scheme!="https"||uri.Host!="vumiro.local"||!uri.IsDefaultPort||uri.UserInfo.Length!=0)return null;
        var path=uri.AbsolutePath;
        if(path.Length<2||path[1..].Contains('/')||path.Contains('%')||path.Contains('\\'))return null;
        var filename=path[1..];
        if(!allowed.Contains(filename)||uri.Query.Length!=0&&filename is not ("auth.html" or "friends.html" or "call.html"))return null;
        return filename;
    }
    public bool TrustedRpc(string origin,bool mainFrame,string page)=>mainFrame&&origin==Origin&&AssetPath(page) is "auth.html" or "friends.html";
    public static bool ExternalUrl(string value)
    {
        if(value.Length>8192||value.Any(char.IsWhiteSpace)||value.Contains('\\')||!Uri.TryCreate(value,UriKind.Absolute,out var uri))return false;
        return uri.Scheme=="https"&&uri.UserInfo.Length==0&&uri.IsDefaultPort&&uri.Host.Contains('.')&&!uri.IsLoopback&&!System.Net.IPAddress.TryParse(uri.Host,out _)&&!uri.Host.EndsWith(".local",StringComparison.OrdinalIgnoreCase)&&uri.Host!="vumiro.local";
    }
    public static bool HostedPayment(string value)=>ExternalUrl(value)&&Uri.TryCreate(value,UriKind.Absolute,out var uri)&&((uri.Host=="checkout.stripe.com"&&uri.AbsolutePath.StartsWith("/c/pay/",StringComparison.Ordinal))||(uri.Host=="connect.stripe.com"&&uri.AbsolutePath.StartsWith("/setup/",StringComparison.Ordinal)));
}
