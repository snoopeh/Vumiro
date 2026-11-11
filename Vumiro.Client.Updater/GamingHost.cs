using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace Vumiro.Client
{
    internal static class GamingHost
    {
        internal static int Run(string[] args)
        { try { return RunAsync(args).GetAwaiter().GetResult(); } catch { return 1; } }
        private static async Task<int> RunAsync(string[] args)
        {
            int parentId;
            if(args==null||args.Length!=3||args[0]!="--gaming-host"||!GamingHostProtocol.ValidPipeName(args[1])||!Int32.TryParse(args[2],out parentId)||parentId<=0)return 2;
            if(!WintunGamingLanAdapter.IsElevated)return 3;
            using(var parent=Process.GetProcessById(parentId))
            using(var channel=new NamedPipeClientStream(".",args[1],PipeDirection.InOut,PipeOptions.Asynchronous))
            using(var cancel=new CancellationTokenSource()) {
                await channel.ConnectAsync(15000,cancel.Token).ConfigureAwait(false);
                uint serverId;
                if(!GetNamedPipeServerProcessId(channel.SafePipeHandle.DangerousGetHandle(),out serverId)||serverId!=(uint)parentId)return 4;
                var expected=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"Vumiro.exe");
                GamingPayloads.NoLinks(expected);
                if(!String.Equals(Path.GetFullPath(parent.MainModule.FileName),Path.GetFullPath(expected),StringComparison.OrdinalIgnoreCase)||parent.HasExited)return 5;
                long lease=Environment.TickCount;
                Action disconnect=()=>{ try { cancel.Cancel();channel.Dispose(); } catch { } };
                using(var watchdog=new Timer(_=>{
                    try { if(parent.HasExited||unchecked((uint)(Environment.TickCount-(int)Interlocked.Read(ref lease)))>30000)disconnect(); } catch { disconnect(); }
                },null,2000,2000))
                using(var output=new GamingPipeWriter(channel,disconnect))
                using(var operations=new GamingHostOperations(
                    config=>new WintunGamingLanAdapter(config,GamingPayloads.GetWintunPath(true)),
                    packet=>{if(!output.TryWrite(packet))throw new IOException("The LAN packet queue is full.");},ControllerInstalled,InstallControllerAsync))
                using(var reader=new GamingPipeReader(channel)) {
                    Task installation=null;
                    for(;;) {
                        var line=await reader.ReadLineAsync(cancel.Token).ConfigureAwait(false);if(line==null)break;
                        var request=GamingHostProtocol.Serializer().Deserialize<Dictionary<string,object>>(line);
                        if(!GamingHostProtocol.ValidRequest(request))return 6;
                        Interlocked.Exchange(ref lease,Environment.TickCount);
                        var action=GamingHostProtocol.Text(request,"action");
                        if(action=="install-controller") {
                            if(installation!=null&&!installation.IsCompleted) {
                                var busy=GamingHostProtocol.Error("Controller setup is already running.");busy["id"]=request["id"];if(!output.TryWrite(busy))break;
                            } else installation=ReplyAsync(operations,output,action,request,disconnect);
                        } else await ReplyAsync(operations,output,action,request,disconnect).ConfigureAwait(false);
                    }
                    return 0;
                }
            }
        }
        private static async Task ReplyAsync(GamingHostOperations operations,GamingPipeWriter output,string action,Dictionary<string,object> request,Action disconnect)
        {
            Dictionary<string,object> result;
            try { result=await operations.HandleAsync(action,request).ConfigureAwait(false); }
            catch(Exception error) { result=GamingHostProtocol.Error(error.Message); }
            result["id"]=request["id"];if(!output.TryWrite(result))disconnect();
        }
        internal static bool ControllerInstalled()
        { using(var key=Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\ViGEmBus"))return key!=null; }
        private static Task<int> InstallControllerAsync()
        {
            return Task.Run(()=>{
                if(ControllerInstalled())return 0;
                var path=GamingPayloads.GetControllerInstallerPath(true);
                // Fixed publisher-signed installer, fixed arguments from its
                // official WinGet manifest; no caller-supplied path or flags.
                using(var verify=File.OpenRead(path))if(!GamingPayloads.VerifyHash(verify,GamingPayloads.ControllerHash))throw new IOException("Controller setup integrity check failed.");
                using(var process=Process.Start(new ProcessStartInfo(path,"/exenoui /qn /norestart") {
                    UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,WorkingDirectory=Path.GetDirectoryName(path)
                })) {
                    if(process==null)throw new IOException("Windows did not start controller setup.");
                    if(!process.WaitForExit(180000))throw new IOException("Controller setup is still running. Wait for Windows setup to finish, then try again.");
                    return process.ExitCode;
                }
            });
        }
        [DllImport("kernel32.dll",SetLastError=true)] private static extern bool GetNamedPipeServerProcessId(IntPtr handle,out uint processId);
    }

    // Operations are separate from elevation and transport so the full handler
    // can be checked with an in-memory adapter, without UAC or driver changes.
    internal sealed class GamingHostOperations : IDisposable
    {
        private readonly Func<GamingLanConfiguration,IGamingLanAdapter> adapter;
        private readonly Action<Dictionary<string,object>> publish;
        private readonly Func<bool> controllerInstalled;
        private readonly Func<Task<int>> installController;
        private GamingLanSession lan;
        internal GamingHostOperations(Func<GamingLanConfiguration,IGamingLanAdapter> factory,Action<Dictionary<string,object>> send,Func<bool> installed,Func<Task<int>> install)
        { adapter=factory;publish=send;controllerInstalled=installed;installController=install; }
        internal async Task<Dictionary<string,object>> HandleAsync(string action,Dictionary<string,object> message)
        {
            if(action=="heartbeat")return new Dictionary<string,object>{{"ok",true}};
            if(action=="controller-status")return ControllerReply(true,null,false);
            if(action=="install-controller") {
                if(controllerInstalled())return ControllerReply(true,null,false);
                var exit=await installController().ConfigureAwait(false);
                return exit==0||exit==3010||exit==1641?ControllerReply(true,null,exit!=0):ControllerReply(false,"Windows controller setup failed ("+exit+").",false);
            }
            if(action=="lan-status")return LanReply(true,null);
            var id=GamingHostProtocol.Text(message,"sessionId");
            if(action=="lan-start") {
                GamingLanConfiguration config;
                if(!GamingLanConfiguration.TryCreate(id,GamingHostProtocol.Text(message,"address"),out config))return LanReply(false,"Invalid LAN session or address.");
                object peers;if(message.TryGetValue("addresses",out peers)&&!config.SetPeers(peers))return LanReply(false,"Invalid LAN peer assignment.");
                if(lan!=null&&lan.SessionId==id)return LanReply(true,null);
                Stop();
                lan=new GamingLanSession(config,()=>adapter(config),callback=>{callback();return true;},packet=>publish(new Dictionary<string,object> {
                    {"type","gaming-lan-packet"},{"sessionId",config.SessionId},{"packet",Convert.ToBase64String(packet)}
                }));
                lan.Start();return LanReply(true,null);
            }
            if(lan==null||lan.SessionId!=id)return LanReply(false,"The LAN session is not active or has changed.");
            if(action=="lan-stop") { Stop();return LanReply(true,null); }
            if(action=="lan-set-peers") {
                object peers;return message.TryGetValue("addresses",out peers)&&lan.SetPeers(peers)?LanReply(true,null):LanReply(false,"Invalid LAN peer assignment.");
            }
            if(action=="lan-packet")return lan.Receive(id,GamingHostProtocol.Text(message,"packet"))?LanReply(true,null):LanReply(false,"The LAN packet was rejected or its bounded queue is full.");
            return GamingHostProtocol.Error("Unsupported gaming action.");
        }
        private Dictionary<string,object> ControllerReply(bool ok,string error,bool restart)
        { return new Dictionary<string,object>{{"ok",ok},{"error",error},{"controller",new Dictionary<string,object>{{"installed",controllerInstalled()},{"restartRequired",restart}}}}; }
        private Dictionary<string,object> LanReply(bool ok,string error)
        {
            var status=lan==null?new Dictionary<string,object>{{"state","stopped"},{"sessionId",null},{"address",null},{"packetsSent",0L},{"packetsReceived",0L},{"packetsDropped",0L},{"error",null}}:lan.Status();
            status["driverReady"]=GamingPayloads.LanDriverBundled;status["requiresElevation"]=false;status["backend"]="Vumiro IPv4 over WebRTC";
            return new Dictionary<string,object>{{"ok",ok},{"error",error},{"lan",status}};
        }
        private void Stop() { var previous=lan;lan=null;if(previous!=null)previous.Dispose(); }
        public void Dispose() { Stop(); }
    }
}
