using System;
namespace Vumiro.Client
{
    internal static class MarketplaceLinks
    {
        internal static bool IsAllowed(string value)
        {
            if(String.IsNullOrEmpty(value)||value.Length>8192||value.IndexOf('\\')>=0)return false;
            foreach(var c in value)if(Char.IsWhiteSpace(c)||Char.IsControl(c))return false;
            Uri url;
            if(!Uri.TryCreate(value,UriKind.Absolute,out url)||url.Scheme!="https"||!url.IsDefaultPort||!String.IsNullOrEmpty(url.UserInfo))return false;
            return url.Host=="checkout.stripe.com"&&url.AbsolutePath.StartsWith("/c/pay/",StringComparison.Ordinal)||url.Host=="connect.stripe.com"&&url.AbsolutePath.StartsWith("/setup/",StringComparison.Ordinal);
        }
    }
}
