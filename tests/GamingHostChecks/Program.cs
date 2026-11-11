using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Vumiro.Client;

internal static class Program
{
    private static int checks;
    private static void Check(bool condition, string name) { if (!condition) throw new Exception(name); checks++; }
    private static Dictionary<string,object> Request(string action) { return new Dictionary<string,object> { { "id", new string('a',32) }, { "action", action } }; }
    private static async Task MainAsync()
    {
        CheckDirectoryCreationRace();
        CheckPipeAccess();
        CheckStalePipeFailure();
        Check(GamingHostProtocol.ValidPipeName("VumiroGaming-" + new string('a',32)), "own pipe prefix");
        Check(!GamingHostProtocol.ValidPipeName("VumiroGaming-../other"), "pipe path rejected");
        Check(!GamingHostProtocol.ValidPipeName("other-"+new string('a',32)), "foreign pipe rejected");
        Check(GamingHost.Run(new[]{"--gaming-host","invalid-pipe","0"})==2,"helper rejects invalid launch without setup");
        foreach (var action in new[] { "heartbeat", "lan-status", "controller-status", "install-controller", "self-test-lan" }) Check(GamingHostProtocol.ValidRequest(Request(action)), "allowed action " + action);
        Check(!GamingHostProtocol.ValidRequest(Request("run")), "arbitrary command rejected");
        var unsafeMessage=Request("install-controller");unsafeMessage["path"]="C:\\evil.exe";Check(!GamingHostProtocol.ValidRequest(unsafeMessage), "installer path rejected");
        var start=Request("lan-start");start["sessionId"]=new string('b',32);start["address"]="10.203.12.1";start["addresses"]=new object[]{"10.203.12.2"};
        Check(GamingHostProtocol.ValidRequest(start), "bounded LAN start");
        start["address"]="1.2.3.4";Check(!GamingHostProtocol.ValidRequest(start), "foreign LAN rejected");start["address"]="10.203.12.1";
        var framed=new MemoryStream(Encoding.UTF8.GetBytes("{\"ok\":true}\nsecond\n"));
        using (var reader=new GamingPipeReader(framed)) {
            Check(await reader.ReadLineAsync(CancellationToken.None)=="{\"ok\":true}", "framed first message");
            Check(await reader.ReadLineAsync(CancellationToken.None)=="second", "framed second message");
            Check(await reader.ReadLineAsync(CancellationToken.None)==null, "clean pipe EOF");
        }
        bool bounded=false;
        using(var reader=new GamingPipeReader(new MemoryStream(new byte[GamingHostProtocol.MaxLineBytes+1])))
            try { await reader.ReadLineAsync(CancellationToken.None); } catch(InvalidDataException) { bounded=true; }
        Check(bounded,"oversized frame refused before JSON allocation");
        using(var blocked=new BlockedStream())using(var writer=new GamingPipeWriter(blocked,()=>{})) {
            int accepted=0;
            for(int i=0;i<200;i++)if(writer.TryWrite(new Dictionary<string,object>{{"payload",new string('x',20000)}}))accepted++;
            Check(accepted>0&&accepted<129,"outbound byte and count budgets prevent unbounded buffering");blocked.Release();
        }
        Check(GamingPayloads.VerifyHash(new MemoryStream(new byte[0]), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"), "real SHA256");
        Check(!GamingPayloads.VerifyHash(new MemoryStream(new byte[1]), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"), "modified payload rejected");
        Check(GamingPayloads.EmbeddedPayloadsValid(), "embedded signed binaries match both pins");
        Check(GamingPayloads.LanDriverBundled&&GamingPayloads.ControllerDriverBundled,"availability does not require extraction or setup");
        int installs=0;bool installed=true;
        using(var ops=new GamingHostOperations(config=>new FakeAdapter(),message=>{},()=>installed,()=>{installs++;installed=true;return Task.FromResult(0);})) {
            var existing=await ops.HandleAsync("install-controller",Request("install-controller"));
            Check((bool)existing["ok"]&&installs==0,"installed controller bus never reruns installer");
            installed=false;var fresh=await ops.HandleAsync("install-controller",Request("install-controller"));
            Check((bool)fresh["ok"]&&installs==1,"explicit setup invokes fixed injected installer");
            var result=await ops.HandleAsync("lan-start",start);Check((bool)result["ok"],"helper starts own LAN session");
            var diagnostic=await ops.HandleAsync("self-test-lan",Request("self-test-lan"));
            Check((bool)diagnostic["ok"]&&!(bool)diagnostic["passed"],"active helper LAN refuses temporary adapter diagnostic");
            var changed=Request("lan-stop");changed["sessionId"]=new string('c',32);
            Check(!(bool)(await ops.HandleAsync("lan-stop",changed))["ok"],"stale session cannot stop current session");
            var stop=Request("lan-stop");stop["sessionId"]=start["sessionId"];
            Check((bool)(await ops.HandleAsync("lan-stop",stop))["ok"],"matching session stops");
        }
        using(var client=new GamingHostClient()) Check(!client.IsConnected,"constructing client does not prompt UAC or start helper");
        Console.WriteLine("Gaming host checks passed: "+checks);
    }
    private static void Main() { MainAsync().GetAwaiter().GetResult(); }
    private static void CheckDirectoryCreationRace()
    {
        foreach(var attackerOwned in new[]{true,false}) {
            bool created=false,rewritten=false,rejected=false;int reads=0;
            var attacker=new DirectorySecurity();
            attacker.SetOwner(new SecurityIdentifier(attackerOwned?"S-1-5-21-1-2-3-1001":"S-1-5-32-544"));
            if(!attackerOwned)attacker.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.WorldSid,null),FileSystemRights.Write,AccessControlType.Allow));
            try {
                GamingPayloads.SecureDirectory(Path.Combine(Path.GetTempPath(),"vumiro-test-"+Guid.NewGuid().ToString("N")),
                    path=>false,(path,requested)=>created=true,path=>{reads++;return attacker;},(path,requested)=>rewritten=true);
            } catch(IOException) { rejected=true; }
            Check(created&&reads==1&&rejected&&!rewritten,attackerOwned?"creation race winner owner rejected before ACL rewrite":"creation race writable ACL rejected before rewrite");
        }
        bool trustedApplied=false;var trusted=new DirectorySecurity();
        trusted.SetOwner(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid,null));
        trusted.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid,null),FileSystemRights.FullControl,AccessControlType.Allow));
        GamingPayloads.SecureDirectory(Path.Combine(Path.GetTempPath(),"vumiro-test-"+Guid.NewGuid().ToString("N")),
            path=>false,(path,requested)=>{},path=>trusted,(path,requested)=>trustedApplied=true);
        Check(trustedApplied,"trusted newly created directory may receive protected ACL");
    }
    private static void CheckPipeAccess()
    {
        var user=new SecurityIdentifier("S-1-5-21-1-2-3-1001");
        var acl=GamingHostClient.CreatePipeSecurity(user);var found=new HashSet<string>();
        foreach(PipeAccessRule rule in acl.GetAccessRules(true,true,typeof(SecurityIdentifier))) {
            Check(rule.AccessControlType==AccessControlType.Allow&&(rule.PipeAccessRights&PipeAccessRights.ReadWrite)==PipeAccessRights.ReadWrite,"helper pipe grants only required read/write identities");
            found.Add(rule.IdentityReference.Value);
        }
        Check(acl.AreAccessRulesProtected&&found.SetEquals(new[]{user.Value,"S-1-5-18","S-1-5-32-544"}),"desktop user SYSTEM and alternate elevated administrators can connect");
    }
    private static void CheckStalePipeFailure()
    {
        using(var client=new GamingHostClient())
        using(var oldPipe=new NamedPipeServerStream("VumiroGaming-"+Guid.NewGuid().ToString("N")))
        using(var replacement=new NamedPipeServerStream("VumiroGaming-"+Guid.NewGuid().ToString("N"))) {
            var type=typeof(GamingHostClient);var field=type.GetField("pipe",BindingFlags.NonPublic|BindingFlags.Instance);
            field.SetValue(client,replacement);
            var callback=type.GetMethod("Disconnect",BindingFlags.NonPublic|BindingFlags.Instance,null,new[]{typeof(NamedPipeServerStream)},null);
            Check(callback!=null,"channel-specific disconnect callback exists");
            callback.Invoke(client,new object[]{oldPipe});
            Check(Object.ReferenceEquals(field.GetValue(client),replacement),"old writer failure cannot disconnect replacement pipe");
        }
    }
    private sealed class FakeAdapter : IGamingLanAdapter
    {
        public byte[] Read(CancellationToken cancellation) { cancellation.WaitHandle.WaitOne(5);return null; }
        public bool Write(byte[] packet) { return true; }
        public void Dispose() { }
    }
    private sealed class BlockedStream : MemoryStream
    {
        private readonly ManualResetEvent ready=new ManualResetEvent(false);
        public override void Write(byte[] bytes,int offset,int count) { ready.WaitOne(); }
        internal void Release() { ready.Set(); }
    }
}
