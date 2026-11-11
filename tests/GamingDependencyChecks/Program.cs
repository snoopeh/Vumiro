using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using Vumiro.Client;

internal static class Program
{
    private const string Identity = "Nefarius.ViGEm.Client, Version=1.21.256.0, Culture=neutral, PublicKeyToken=null";
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length == 1 && args[0] == "--isolated") return Isolated();
            var temporaryRoot = Path.GetFullPath(Path.GetTempPath());
            var stage = Path.GetFullPath(Path.Combine(temporaryRoot, "VumiroGamingDependencyChecks-" + Guid.NewGuid().ToString("N")));
            if (!stage.StartsWith(temporaryRoot, StringComparison.OrdinalIgnoreCase)) throw new Exception("Test staging escaped temporary directory.");
            Directory.CreateDirectory(stage);
            try
            {
                var source = Assembly.GetExecutingAssembly().Location;
                var target = Path.Combine(stage, "GamingDependencyChecks.exe");
                File.Copy(source, target);
                if (File.Exists(source + ".config")) File.Copy(source + ".config", target + ".config");
                using (var process = Process.Start(new ProcessStartInfo(target, "--isolated") {
                    UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
                    WorkingDirectory = stage, RedirectStandardOutput = true, RedirectStandardError = true
                }))
                {
                    if (!process.WaitForExit(30000)) { process.Kill(); throw new Exception("Isolated dependency probe timed out."); }
                    var output = process.StandardOutput.ReadToEnd();
                    var error = process.StandardError.ReadToEnd();
                    if (process.ExitCode != 0) throw new Exception("Isolated dependency probe failed: " + error + output);
                    Console.Write(output);
                }
            }
            finally
            {
                if (Path.GetFullPath(stage).StartsWith(temporaryRoot, StringComparison.OrdinalIgnoreCase) &&
                    Path.GetFileName(stage).StartsWith("VumiroGamingDependencyChecks-", StringComparison.Ordinal)) Directory.Delete(stage, true);
            }
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }

    private static int Isolated()
    {
        if (Directory.GetFiles(AppDomain.CurrentDomain.BaseDirectory, "*.dll").Length != 0) throw new Exception("Isolated probe has copy-local DLLs.");
        foreach (var name in new[] {
            "Unrelated.Assembly, Version=1.21.256.0, Culture=neutral, PublicKeyToken=null",
            "Nefarius.ViGEm.Client, Version=9.0.0.0, Culture=neutral, PublicKeyToken=null",
            "Nefarius.ViGEm.Client, Version=1.21.256.0, Culture=fr, PublicKeyToken=null",
            "Nefarius.ViGEm.Client, Version=1.21.256.0, Culture=neutral, PublicKeyToken=0123456789abcdef",
            "Nefarius.ViGEm.Client", "Nefarius.ViGEm.Client.resources", "../Nefarius.ViGEm.Client.dll"
        })
            if (GamingDependencies.Resolve(null, new ResolveEventArgs(name)) != null) throw new Exception("Resolver accepted untrusted identity: " + name);
        GamingDependencies.Register();
        GamingDependencies.Register();
        var dependency = Assembly.Load(Identity);
        if (dependency.FullName != Identity || dependency.Location.Length != 0) throw new Exception("Dependency was not loaded from trusted embedded bytes.");
        if (!ReferenceEquals(dependency, Assembly.Load(Identity)) || !ReferenceEquals(dependency, GamingDependencies.Resolve(null, new ResolveEventArgs(Identity))))
            throw new Exception("Repeated resolution did not use cached assembly.");
        var type = dependency.GetType("Nefarius.ViGEm.Client.ViGEmClient", true);
        if (type.GetConstructor(Type.EmptyTypes) == null) throw new Exception("ViGEm client type is unavailable.");
        var resources = dependency.GetManifestResourceNames();
        if (!Array.Exists(resources, value => value.StartsWith("costura64.vigemclient.dll", StringComparison.OrdinalIgnoreCase)) ||
            !Array.Exists(resources, value => value.StartsWith("costura32.vigemclient.dll", StringComparison.OrdinalIgnoreCase)))
            throw new Exception("Embedded native ViGEm client resources missing.");
        try
        {
            using (var client = (IDisposable)Activator.CreateInstance(type)) { }
            Console.WriteLine("ViGEmBus probe reached the installed driver.");
        }
        catch (TargetInvocationException error)
        {
            var cause = error.InnerException;
            if (cause == null || cause.GetType().FullName != "Nefarius.ViGEm.Client.Exceptions.VigemBusNotFoundException") throw;
            Console.WriteLine("ViGEmBus probe loaded managed/native libraries; driver is not installed.");
        }
        Console.WriteLine("Passed isolated embedded gaming dependency identity, allowlist, cache, type and native probe checks without copy-local DLLs.");
        return 0;
    }
}
