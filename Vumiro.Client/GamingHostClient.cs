using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Threading;
using System.Threading.Tasks;

namespace Vumiro.Client
{
    internal sealed class GamingHostClient : IDisposable
    {
        private readonly SemaphoreSlim startup=new SemaphoreSlim(1,1);
        private readonly object gate=new object();
        private readonly Dictionary<string,TaskCompletionSource<Dictionary<string,object>>> waiting=new Dictionary<string,TaskCompletionSource<Dictionary<string,object>>>();
        private NamedPipeServerStream pipe;private GamingPipeWriter writer;private Process helper;
        private CancellationTokenSource stop;private Timer heartbeat;private bool disposed;private int heartbeating,outstanding;
        internal event Action<Dictionary<string,object>> PacketReceived;
        internal bool IsConnected { get { lock(gate)return !disposed&&pipe!=null&&pipe.IsConnected; } }
        internal async Task<Dictionary<string,object>> RequestAsync(string action,Dictionary<string,object> message)
        {
            var request=new Dictionary<string,object>();
            if(message!=null)foreach(var item in message)if(item.Key!="id"&&item.Key!="action"&&item.Key!="type")request[item.Key]=item.Value;
            var id=Guid.NewGuid().ToString("N");request["id"]=id;request["action"]=action;
            if(!GamingHostProtocol.ValidRequest(request))return GamingHostProtocol.Error("Invalid gaming helper request.");
            if(Interlocked.Increment(ref outstanding)>128) { Interlocked.Decrement(ref outstanding);return GamingHostProtocol.Error("The gaming helper queue is full."); }
            try {
                await EnsureConnectedAsync().ConfigureAwait(false);
                var completion=new TaskCompletionSource<Dictionary<string,object>>(TaskCreationOptions.RunContinuationsAsynchronously);
                lock(gate) {
                    if(disposed||writer==null)return GamingHostProtocol.Error("The gaming helper disconnected.");
                    if(waiting.Count>=128)return GamingHostProtocol.Error("The gaming helper queue is full.");
                    waiting.Add(id,completion);
                    if(!writer.TryWrite(request)) { waiting.Remove(id);return GamingHostProtocol.Error("The gaming helper queue is full."); }
                }
                var timeout=Task.Delay(action=="install-controller"?240000:20000);
                if(await Task.WhenAny(completion.Task,timeout).ConfigureAwait(false)!=completion.Task) {
                    lock(gate)waiting.Remove(id);return GamingHostProtocol.Error("The gaming helper did not answer in time.");
                }
                return await completion.Task.ConfigureAwait(false);
            } catch(System.ComponentModel.Win32Exception error) {
                return GamingHostProtocol.Error(error.NativeErrorCode==1223?"Windows setup was cancelled. Start Gaming again when ready.":error.Message);
            } catch(Exception error) { return GamingHostProtocol.Error(error.Message); }
            finally { Interlocked.Decrement(ref outstanding); }
        }
        private async Task EnsureConnectedAsync()
        {
            await startup.WaitAsync().ConfigureAwait(false);
            try {
                if(disposed)throw new ObjectDisposedException("GamingHostClient");
                if(IsConnected)return;
                var updater=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"Vumiro.Updater.exe");
                GamingPayloads.NoLinks(updater);if(!File.Exists(updater))throw new IOException("The bundled Vumiro gaming helper is missing. Reinstall Vumiro.");
                var name="VumiroGaming-"+Guid.NewGuid().ToString("N");
                var security=CreatePipeSecurity(WindowsIdentity.GetCurrent().User);
                var channel=new NamedPipeServerStream(name,PipeDirection.InOut,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous,65536,65536,security);
                Process launched=null;
                try {
                    var connected=channel.WaitForConnectionAsync();
                    launched=await Task.Run(()=>Process.Start(new ProcessStartInfo(updater,"--gaming-host "+name+" "+Process.GetCurrentProcess().Id) {
                        UseShellExecute=true,Verb="runas",WorkingDirectory=AppDomain.CurrentDomain.BaseDirectory,WindowStyle=ProcessWindowStyle.Hidden
                    })).ConfigureAwait(false);
                    if(launched==null)throw new IOException("Windows did not start the Vumiro gaming helper.");
                    if(await Task.WhenAny(connected,Task.Delay(90000)).ConfigureAwait(false)!=connected)throw new IOException("Windows gaming setup timed out.");
                    await connected.ConfigureAwait(false);
                    uint client;if(!GetNamedPipeClientProcessId(channel.SafePipeHandle.DangerousGetHandle(),out client)||client!=(uint)launched.Id)
                        throw new IOException("The gaming helper connection could not be authenticated.");
                    lock(gate) {
                        if(disposed)throw new ObjectDisposedException("GamingHostClient");
                        pipe=channel;helper=launched;stop=new CancellationTokenSource();
                        writer=new GamingPipeWriter(channel,()=>Disconnect(channel));
                        heartbeat=new Timer(_=>{ if(Interlocked.Exchange(ref heartbeating,1)==0)HeartbeatAsync(); },null,2000,2000);
                    }
                    ReadAsync(channel,stop.Token);
                } catch { channel.Dispose();if(launched!=null)launched.Dispose();throw; }
            } finally { startup.Release(); }
        }
        internal static PipeSecurity CreatePipeSecurity(SecurityIdentifier sid)
        {
            var security=new PipeSecurity();security.SetAccessRuleProtection(true,false);
            security.AddAccessRule(new PipeAccessRule(sid,PipeAccessRights.ReadWrite,AccessControlType.Allow));
            security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid,null),PipeAccessRights.FullControl,AccessControlType.Allow));
            security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid,null),PipeAccessRights.ReadWrite,AccessControlType.Allow));
            return security;
        }
        private async void HeartbeatAsync()
        {
            try { if(IsConnected)await RequestAsync("heartbeat",null).ConfigureAwait(false); }
            catch { Disconnect(); }
            finally { Interlocked.Exchange(ref heartbeating,0); }
        }
        private async void ReadAsync(NamedPipeServerStream channel,CancellationToken token)
        {
            try {
                using(var reader=new GamingPipeReader(channel))for(;;) {
                    var line=await reader.ReadLineAsync(token).ConfigureAwait(false);if(line==null)break;
                    var message=GamingHostProtocol.Serializer().Deserialize<Dictionary<string,object>>(line);
                    if(message==null)throw new InvalidDataException("Invalid gaming helper response.");
                    if(GamingHostProtocol.Text(message,"type")=="gaming-lan-packet") {
                        var handler=PacketReceived;if(handler!=null)try { handler(message); } catch { }
                        continue;
                    }
                    var id=GamingHostProtocol.Text(message,"id");TaskCompletionSource<Dictionary<string,object>> completion=null;
                    lock(gate)if(id!=null&&waiting.TryGetValue(id,out completion))waiting.Remove(id);
                    if(completion!=null)completion.TrySetResult(message);
                }
            } catch { }
            finally { Disconnect(channel); }
        }
        private void Disconnect(NamedPipeServerStream channel)
        { lock(gate)if(ReferenceEquals(pipe,channel))Disconnect(); }
        private void Disconnect()
        {
            lock(gate) {
                if(heartbeat!=null)heartbeat.Dispose();heartbeat=null;
                if(stop!=null)stop.Cancel();
                if(writer!=null)writer.Dispose();writer=null;
                if(pipe!=null)pipe.Dispose();pipe=null;
                if(helper!=null)helper.Dispose();helper=null;
                foreach(var completion in waiting.Values)completion.TrySetResult(GamingHostProtocol.Error("The gaming helper disconnected."));waiting.Clear();
            }
        }
        public void Dispose() { lock(gate) { if(disposed)return;disposed=true; } Disconnect(); }
        [DllImport("kernel32.dll",SetLastError=true)] private static extern bool GetNamedPipeClientProcessId(IntPtr handle,out uint processId);
    }
}
