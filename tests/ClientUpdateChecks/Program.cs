using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Vumiro.Client;

namespace Vumiro.Client
{
    internal sealed class ClientWindow { internal void ExitApplication() { throw new Exception("Tests must not close a real app."); } }
}

internal static class Program
{
    private sealed class StalledStream : Stream
    {
        internal readonly TaskCompletionSource<bool> Reading = new TaskCompletionSource<bool>();
        private readonly TaskCompletionSource<int> pending = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
        internal bool Disposed;
        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
        {
            Reading.TrySetResult(true);
            return pending.Task; // Model net48 network I/O that ignores cancellation after beginning a read.
        }
        protected override void Dispose(bool disposing)
        {
            Disposed = true;
            pending.TrySetException(new IOException("The response was closed."));
            base.Dispose(disposing);
        }
        public override bool CanRead { get { return true; } }
        public override bool CanSeek { get { return false; } }
        public override bool CanWrite { get { return false; } }
        public override long Length { get { throw new NotSupportedException(); } }
        public override long Position { get { throw new NotSupportedException(); } set { throw new NotSupportedException(); } }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
        public override long Seek(long offset, SeekOrigin origin) { throw new NotSupportedException(); }
        public override void SetLength(long value) { throw new NotSupportedException(); }
        public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
    }
    private static int count;
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static Dictionary<string, object> last;
    private static void Check(bool value, string message) { if (!value) throw new Exception(message); count++; }
    private static void Emit(object value) { last = Json.Deserialize<Dictionary<string, object>>(Json.Serialize(value)); }
    private static Task Start(ClientUpdates updates) { return updates.StartAsync(); }
    private static ClientUpdates Updates(Func<Task<ClientUpdates.Release>> check, Func<ClientUpdates.Release, Task> install)
    {
        return new ClientUpdates(null, Emit, check, install);
    }
    private static ClientUpdates.Release Release(int major) { return new ClientUpdates.Release { Version = new Version(major, 0, 0, 0) }; }
    private static void Main() { Run().GetAwaiter().GetResult(); Console.WriteLine("Passed " + count + " updater checks."); }
    private static async Task Run()
    {
        var checkedReleases = 0; var installed = 0;
        var release = Release(99);
        var pending = new TaskCompletionSource<ClientUpdates.Release>();
        var installing = new TaskCompletionSource<bool>();
        var updates = Updates(() => { checkedReleases++; return pending.Task; }, value => {
            Check(Object.ReferenceEquals(value, release), "Install must use the checked release metadata."); installed++; return installing.Task;
        });
        var first = Start(updates);
        var second = Start(updates);
        Check(!second.IsCompleted, "Another navigation must wait for the in-flight boot update before enabling the app.");
        Check(Object.ReferenceEquals(first, second), "All boot navigation handlers must await the same update task.");
        Check(checkedReleases == 1 && installed == 0, "Repeated navigation during startup cannot start another update.");
        pending.SetResult(release);
        Check(!first.IsCompleted && !second.IsCompleted, "Every navigation must wait through installation, not only the metadata check.");
        installing.SetResult(true); await first; await second;
        Check(installed == 1 && !(bool)last["busy"], "An available boot update installs and clears busy state.");
        await Start(updates);
        Check(checkedReleases == 1 && installed == 1, "Later navigation cannot update or restart the app again.");

        updates = Updates(() => Task.FromResult(Release(0)), value => { installed++; return Task.CompletedTask; });
        await Start(updates);
        Check(installed == 1 && !(bool)last["available"], "An older release cannot be installed.");
        updates = Updates(() => Task.FromResult<ClientUpdates.Release>(null), value => { installed++; return Task.CompletedTask; });
        await Start(updates);
        Check(installed == 1, "A missing release leaves the app open.");

        var attempts = 0;
        updates = Updates(() => {
            attempts++;
            if (attempts == 1) throw new InvalidOperationException("offline");
            return Task.FromResult(release);
        }, value => { installed++; return Task.CompletedTask; });
        await Start(updates);
        Check(((string)last["message"]).Contains("offline") && !(bool)last["busy"], "Boot failure must be recoverable and visible.");
        await Start(updates);
        Check(attempts == 1, "Navigation must not silently retry a failed boot update.");
        await updates.HandleAsync("install");
        Check(attempts == 2 && installed == 2, "Manual install must still retry after an offline startup.");
        updates = Updates(() => Task.FromResult(release), value => { throw new InvalidOperationException("verification failed"); });
        await Start(updates);
        Check(((string)last["message"]).Contains("verification failed") && !(bool)last["busy"], "A verification failure must preserve a usable app.");

        Environment.SetEnvironmentVariable("VUMIRO_SKIP_STARTUP_UPDATE", "1");
        try
        {
            updates = Updates(() => { checkedReleases++; return Task.FromResult(release); }, value => { installed++; return Task.CompletedTask; });
            await Start(updates);
            Check(installed == 2, "Recovery restart must not enter an automatic installation loop.");
            Check(Environment.GetEnvironmentVariable("VUMIRO_SKIP_STARTUP_UPDATE") == null, "Recovery skip applies only to this launch.");
            await updates.HandleAsync("install");
            Check(installed == 3, "Recovery startup must preserve manual update retries.");
        }
        finally { Environment.SetEnvironmentVariable("VUMIRO_SKIP_STARTUP_UPDATE", null); }

        await StalledResponseCancellation();
        HelperRecovery();
        MissingHelperMarksPackageIncomplete();
    }

    private static void MissingHelperMarksPackageIncomplete()
    {
        var complete = typeof(ClientUpdates).GetMethod("CompletePackageInstalled", BindingFlags.Static | BindingFlags.NonPublic,
            null, new[] { typeof(string) }, null);
        Check(complete != null, "Complete-package detection must inspect an installation folder for a missing helper.");
        var install = Path.Combine(Path.GetTempPath(), "vumiro-complete-test-" + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(Path.Combine(install, "WebServer"));
            foreach (var file in new[] { "account-client.js", "auth.html", "identity-recovery.js" })
                File.WriteAllText(Path.Combine(install, "WebServer", file), "complete");
            File.WriteAllText(Path.Combine(install, "PRIVACY.md"), "complete");
            Check(!(bool)complete.Invoke(null, new object[] { install }),
                "Same-version update must remain available when complete UI assets exist but the helper is missing.");
            File.WriteAllBytes(Path.Combine(install, "Vumiro.Updater.exe"), new byte[] { 9, 8, 7 });
            File.WriteAllText(Path.Combine(install, "Vumiro.Updater.exe.config"), "damaged");
            Check(!(bool)complete.Invoke(null, new object[] { install }),
                "Same-version update must remain available when the installed helper is damaged.");

            File.Copy(BuiltUpdaterExecutable(), Path.Combine(install, "Vumiro.Updater.exe"), true);
            File.Copy(Path.ChangeExtension(BuiltUpdaterExecutable(), ".exe.config"),
                Path.Combine(install, "Vumiro.Updater.exe.config"), true);
            Check((bool)complete.Invoke(null, new object[] { install }),
                "A complete installation with a valid helper and config must not repeat a same-version update.");
            File.WriteAllText(Path.Combine(install, "Vumiro.Updater.exe.config"), "<configuration><startup></configuration>");
            Check(!(bool)complete.Invoke(null, new object[] { install }),
                "Same-version update must remain available when the installed helper config is malformed.");
        }
        finally { if (Directory.Exists(install)) Directory.Delete(install, true); }
    }

    private static void HelperRecovery()
    {
        var copy = typeof(ClientUpdates).GetMethod("CopyUpdateHelper", BindingFlags.Static | BindingFlags.NonPublic);
        Check(copy != null, "Updater must have a recovery path for a missing installed helper.");
        var root = Path.Combine(Path.GetTempPath(), "vumiro-helper-test-" + Guid.NewGuid().ToString("N"));
        var install = Path.Combine(root, "install"); var stage = Path.Combine(root, "stage");
        var cache = Path.Combine(root, "cache");
        try
        {
            Directory.CreateDirectory(install); Directory.CreateDirectory(stage); Directory.CreateDirectory(cache);
            var stagedExe = new byte[] { 1, 2, 3, 4 };
            File.WriteAllBytes(Path.Combine(stage, "Vumiro.Updater.exe"), stagedExe);
            File.WriteAllText(Path.Combine(stage, "Vumiro.Updater.exe.config"), "staged config");

            copy.Invoke(null, new object[] { stage, cache });
            Check(File.ReadAllBytes(Path.Combine(cache, "Vumiro.Updater.exe")).SequenceEqual(stagedExe),
                "Missing installed helper must recover from the already verified staged update.");
            Check(File.ReadAllText(Path.Combine(cache, "Vumiro.Updater.exe.config")) == "staged config",
                "Recovery must copy the staged helper config with the staged executable.");

            File.WriteAllBytes(Path.Combine(install, "Vumiro.Updater.exe"), new byte[] { 9, 8, 7 });
            File.WriteAllText(Path.Combine(install, "Vumiro.Updater.exe.config"), "broken config");
            File.Delete(Path.Combine(cache, "Vumiro.Updater.exe"));
            File.Delete(Path.Combine(cache, "Vumiro.Updater.exe.config"));
            copy.Invoke(null, new object[] { stage, cache });
            Check(File.ReadAllBytes(Path.Combine(cache, "Vumiro.Updater.exe")).SequenceEqual(stagedExe),
                "Damaged installed helper must recover from the verified staged update.");
            Check(File.ReadAllText(Path.Combine(cache, "Vumiro.Updater.exe.config")) == "staged config",
                "Damaged helper recovery must not reuse its installed config.");

            File.Copy(BuiltUpdaterExecutable(), Path.Combine(install, "Vumiro.Updater.exe"), true);
            File.Delete(Path.Combine(cache, "Vumiro.Updater.exe"));
            File.Delete(Path.Combine(cache, "Vumiro.Updater.exe.config"));
            copy.Invoke(null, new object[] { stage, cache });
            Check(File.ReadAllBytes(Path.Combine(cache, "Vumiro.Updater.exe")).SequenceEqual(stagedExe),
                "A valid installed helper must not replace the digest-verified staged helper.");
            Check(File.ReadAllText(Path.Combine(cache, "Vumiro.Updater.exe.config")) == "staged config",
                "A valid installed helper must not reuse its installed config.");
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    private static string BuiltUpdaterExecutable()
    {
        var root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "../../../../.."));
        var executable = Path.Combine(root, "Vumiro.Client.Updater", "bin", "Release", "net48", "Vumiro.Updater.exe");
        Check(File.Exists(executable), "The updater test fixture must build from the current source.");
        return executable;
    }

    private static async Task StalledResponseCancellation()
    {
        var stream = new StalledStream();
        using (var response = new HttpResponseMessage { Content = new StreamContent(stream) })
        using (var timeout = new CancellationTokenSource())
        {
            var method = typeof(ClientUpdates).GetMethod("ReadBoundedAsync", BindingFlags.Static | BindingFlags.NonPublic);
            var read = (Task<string>)method.Invoke(null, new object[] { response, 1024, timeout.Token });
            await stream.Reading.Task;
            timeout.Cancel();
            Check(await Task.WhenAny(read, Task.Delay(1000)) == read, "A stalled response must finish when its timeout fires, even when ReadAsync ignores cancellation.");
            Check(stream.Disposed, "Timeout must close the network response to abort net48 pending reads.");
            try { await read; throw new Exception("A cancelled stalled response cannot succeed."); }
            catch (IOException) { count++; }
        }
    }
}
