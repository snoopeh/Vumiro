using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace Vumiro.Client
{
    internal static class GamingPayloads
    {
        internal const string WintunHash="e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce";
        internal const string ControllerHash="89220a7865076b342892f98865f3499fb7c4cfd673159e89d352c360fd014c6a";
        internal static bool LanDriverBundled { get { return HasResource("Vumiro.Gaming.Wintun"); } }
        internal static bool ControllerDriverBundled { get { return HasResource("Vumiro.Gaming.ControllerInstaller"); } }
        private static bool HasResource(string name) { using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream(name))return stream!=null; }
        internal static bool VerifyHash(Stream stream,string expected)
        { using(var sha=SHA256.Create()) return String.Equals(BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant(),expected,StringComparison.Ordinal); }
        internal static bool EmbeddedPayloadsValid()
        {
            foreach(var item in new[]{new[]{"Vumiro.Gaming.Wintun",WintunHash},new[]{"Vumiro.Gaming.ControllerInstaller",ControllerHash}})
                using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream(item[0])) if(stream==null||!VerifyHash(stream,item[1]))return false;
            return true;
        }
        internal static string GetWintunPath(bool machine=false) { return Extract("Vumiro.Gaming.Wintun","wintun.dll",WintunHash,machine); }
        internal static string GetControllerInstallerPath(bool machine=false) { return Extract("Vumiro.Gaming.ControllerInstaller","ViGEmBus_1.22.0.exe",ControllerHash,machine); }
        internal static void NoLinks(string path)
        {
            for(var current=Path.GetFullPath(path);!String.IsNullOrEmpty(current);current=Path.GetDirectoryName(current)) {
                if((Directory.Exists(current)||File.Exists(current))&&(File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)
                    throw new IOException("The gaming runtime path contains a link.");
                if(current==Path.GetPathRoot(current))break;
            }
        }
        private static string Extract(string resource,string filename,string hash,bool machine)
        {
            var root=Path.Combine(Environment.GetFolderPath(machine?Environment.SpecialFolder.CommonApplicationData:Environment.SpecialFolder.LocalApplicationData),"Vumiro","GamingRuntime");
            var directory=Path.Combine(root,hash);var target=Path.Combine(directory,filename);
            NoLinks(directory);
            if(machine) {
                // A standard user must never replace a DLL subsequently loaded
                // by the elevated helper. Protect each runtime directory.
                SecureDirectory(Path.GetDirectoryName(root));SecureDirectory(root);SecureDirectory(directory);
            } else Directory.CreateDirectory(directory);
            NoLinks(target);
            if(File.Exists(target)) { using(var file=File.OpenRead(target)) if(VerifyHash(file,hash))return target;File.Delete(target); }
            var temporary=Path.Combine(directory,Guid.NewGuid().ToString("N")+".tmp");
            try {
                using(var input=Assembly.GetExecutingAssembly().GetManifestResourceStream(resource)) {
                    if(input==null)throw new IOException("The bundled gaming runtime is missing. Reinstall Vumiro.");
                    using(var output=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None))input.CopyTo(output);
                }
                using(var file=File.OpenRead(temporary))if(!VerifyHash(file,hash))throw new IOException("The bundled gaming runtime failed its integrity check.");
                NoLinks(target);
                try { File.Move(temporary,target); } catch(IOException) { if(!File.Exists(target))throw; }
                using(var file=File.OpenRead(target))if(!VerifyHash(file,hash))throw new IOException("The extracted gaming runtime failed its integrity check.");
                return target;
            } finally { if(File.Exists(temporary))File.Delete(temporary); }
        }
        private static void SecureDirectory(string path)
        { SecureDirectory(path,Directory.Exists,(value,security)=>Directory.CreateDirectory(value,security),Directory.GetAccessControl,Directory.SetAccessControl); }
        internal static void SecureDirectory(string path,Func<string,bool> exists,Action<string,DirectorySecurity> create,Func<string,DirectorySecurity> read,Action<string,DirectorySecurity> apply)
        {
            NoLinks(path);
            var security=new DirectorySecurity();security.SetAccessRuleProtection(true,false);
            security.SetOwner(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid,null));
            var inheritance=InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit;
            foreach(var sid in new[]{WellKnownSidType.BuiltinAdministratorsSid,WellKnownSidType.LocalSystemSid})
                security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid,null),FileSystemRights.FullControl,inheritance,PropagationFlags.None,AccessControlType.Allow));
            security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid,null),FileSystemRights.ReadAndExecute,inheritance,PropagationFlags.None,AccessControlType.Allow));
            // Never adopt a runtime directory pre-created by an unprivileged
            // process: it might retain write handles even after an ACL change.
            if(!exists(path))create(path,security);
            NoLinks(path);
            // CreateDirectory may return an existing directory if another
            // process won creation. Validate the actual result in both cases.
            {
                var existing=read(path);var owner=existing.GetOwner(typeof(SecurityIdentifier)) as SecurityIdentifier;
                if(owner==null||!owner.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid)&&!owner.IsWellKnown(WellKnownSidType.LocalSystemSid))
                    throw new IOException("Windows gaming setup found an untrusted runtime directory.");
                foreach(FileSystemAccessRule rule in existing.GetAccessRules(true,true,typeof(SecurityIdentifier))) {
                    var identity=rule.IdentityReference as SecurityIdentifier;
                    if(rule.AccessControlType==AccessControlType.Allow&&identity!=null&&!identity.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid)&&!identity.IsWellKnown(WellKnownSidType.LocalSystemSid)&&
                        (rule.FileSystemRights&(FileSystemRights.Write|FileSystemRights.ChangePermissions|FileSystemRights.TakeOwnership|FileSystemRights.Delete|FileSystemRights.DeleteSubdirectoriesAndFiles))!=0)
                        throw new IOException("Windows gaming setup found a writable runtime directory.");
                }
            }
            apply(path,security);NoLinks(path);
        }
    }

    internal static class GamingHostProtocol
    {
        internal const int MaxLineBytes=96*1024;
        internal static JavaScriptSerializer Serializer() { return new JavaScriptSerializer { MaxJsonLength=MaxLineBytes,RecursionLimit=12 }; }
        internal static bool ValidPipeName(string value) { return value!=null&&Regex.IsMatch(value,"\\AVumiroGaming-[0-9a-f]{32}\\z"); }
        internal static string Text(IDictionary<string,object> message,string key) { object value;return message!=null&&message.TryGetValue(key,out value)?value as string:null; }
        internal static bool ValidRequest(Dictionary<string,object> message)
        {
            if(message==null||!Regex.IsMatch(Text(message,"id")??"","\\A[0-9a-f]{32}\\z"))return false;
            var action=Text(message,"action");string[] extra;
            switch(action) {
                case "heartbeat":case "lan-status":case "controller-status":case "install-controller":case "self-test-lan":extra=new string[0];break;
                case "lan-start":extra=new[]{"sessionId","address","addresses"};break;
                case "lan-set-peers":extra=new[]{"sessionId","addresses"};break;
                case "lan-packet":extra=new[]{"sessionId","packet"};break;
                case "lan-stop":extra=new[]{"sessionId"};break;
                default:return false;
            }
            foreach(var key in message.Keys)if(key!="id"&&key!="action"&&Array.IndexOf(extra,key)<0)return false;
            if(extra.Length==0)return true;
            var session=Text(message,"sessionId");
            if(!Regex.IsMatch(session??"","\\A[0-9a-f]{32}\\z"))return false;
            if(action=="lan-start") {
                GamingLanConfiguration config;if(!GamingLanConfiguration.TryCreate(session,Text(message,"address"),out config))return false;
                object peers;return !message.TryGetValue("addresses",out peers)||config.SetPeers(peers);
            }
            if(action=="lan-set-peers") {
                object peers;var sequence=message.TryGetValue("addresses",out peers)?peers as System.Collections.IEnumerable:null;
                if(sequence==null||peers is string)return false;
                var count=0;foreach(var item in sequence)if(!(item is string)||++count>4)return false;
            }
            return action!="lan-packet"||Text(message,"packet")!=null&&Text(message,"packet").Length<=87380;
        }
        internal static Dictionary<string,object> Error(string text) { return new Dictionary<string,object>{{"ok",false},{"error",text}}; }
    }

    // Buffered framing keeps packet IPC efficient while refusing oversized lines
    // before a JSON parser or unbounded ReadLine allocation sees them.
    internal sealed class GamingPipeReader : IDisposable
    {
        private readonly Stream stream;private readonly byte[] buffer=new byte[8192];private int offset,count;
        internal GamingPipeReader(Stream source) { stream=source; }
        internal async Task<string> ReadLineAsync(CancellationToken cancellation)
        {
            using(var line=new MemoryStream()) {
                for(;;) {
                    if(offset==count) { count=await stream.ReadAsync(buffer,0,buffer.Length,cancellation).ConfigureAwait(false);offset=0;if(count==0) { if(line.Length!=0)throw new EndOfStreamException("Incomplete gaming message.");return null; } }
                    var end=offset;while(end<count&&buffer[end]!=10)end++;
                    var length=end-offset;if(line.Length+length>GamingHostProtocol.MaxLineBytes)throw new InvalidDataException("The gaming message is too large.");
                    line.Write(buffer,offset,length);offset=end;
                    if(offset<count&&buffer[offset++]==10)return new UTF8Encoding(false,true).GetString(line.ToArray());
                }
            }
        }
        public void Dispose() { }
    }

    internal sealed class GamingPipeWriter : IDisposable
    {
        private readonly Stream stream;private readonly Action failed;
        private readonly System.Collections.Concurrent.BlockingCollection<byte[]> queue=new System.Collections.Concurrent.BlockingCollection<byte[]>(128);
        private readonly object gate=new object();private readonly Thread writer;private int bytes;private bool closed;
        internal GamingPipeWriter(Stream destination,Action onFailure)
        { stream=destination;failed=onFailure;writer=new Thread(Run){IsBackground=true,Name="Vumiro gaming IPC writer"};writer.Start(); }
        internal bool TryWrite(Dictionary<string,object> message)
        {
            var encoded=Encoding.UTF8.GetBytes(GamingHostProtocol.Serializer().Serialize(message)+"\n");
            if(encoded.Length>GamingHostProtocol.MaxLineBytes+1)return false;
            lock(gate) { if(closed||bytes+encoded.Length>2*1024*1024||queue.Count>=128)return false;bytes+=encoded.Length;if(queue.TryAdd(encoded))return true;bytes-=encoded.Length;return false; }
        }
        private void Run()
        {
            try { foreach(var packet in queue.GetConsumingEnumerable()) { try { stream.Write(packet,0,packet.Length);stream.Flush(); } finally { lock(gate)bytes-=packet.Length; } } }
            catch { failed(); }
        }
        public void Dispose() { lock(gate) { if(closed)return;closed=true;queue.CompleteAdding(); } }
    }
}
