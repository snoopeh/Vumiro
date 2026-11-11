using System;
using System.IO;
using System.Reflection;

namespace Vumiro.Client
{
    // Updater package schemas have a fixed file set. Keep this pinned managed
    // dependency inside Vumiro.exe; never probe user-supplied paths or names.
    internal static class GamingDependencies
    {
        private const string ClientIdentity = "Nefarius.ViGEm.Client, Version=1.21.256.0, Culture=neutral, PublicKeyToken=null";
        private const string ClientResource = "Vumiro.Gaming.ViGEmClient";
        private static readonly object Registration = new object();
        private static readonly Lazy<Assembly> ClientAssembly = new Lazy<Assembly>(LoadClient);
        private static bool registered;

        internal static void Register()
        {
            lock (Registration)
            {
                if (registered) return;
                AppDomain.CurrentDomain.AssemblyResolve += Resolve;
                registered = true;
            }
        }

        internal static Assembly Resolve(object sender, ResolveEventArgs arguments)
        {
            if (arguments == null || !string.Equals(arguments.Name, ClientIdentity, StringComparison.Ordinal)) return null;
            return ClientAssembly.Value;
        }

        private static Assembly LoadClient()
        {
            using (var resource = typeof(GamingDependencies).Assembly.GetManifestResourceStream(ClientResource))
            {
                if (resource == null) throw new FileNotFoundException("The embedded gaming controller client is missing from this app package.");
                using (var buffer = new MemoryStream())
                {
                    resource.CopyTo(buffer);
                    var assembly = Assembly.Load(buffer.ToArray());
                    if (!string.Equals(assembly.FullName, ClientIdentity, StringComparison.Ordinal))
                        throw new FileLoadException("The embedded gaming controller client has an unsupported assembly identity.");
                    return assembly;
                }
            }
        }
    }
}
