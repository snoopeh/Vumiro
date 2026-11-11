using System;
using System.Collections.Generic;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Threading;

namespace Vumiro.Client
{
    [StructLayout(LayoutKind.Sequential)]
    internal struct GamingDiagnosticFrame
    {
        internal ushort Buttons; internal byte LeftTrigger, RightTrigger;
        internal short LeftX, LeftY, RightX, RightY;
        internal bool Matches(GamingDiagnosticFrame other) { return Buttons==other.Buttons&&LeftTrigger==other.LeftTrigger&&RightTrigger==other.RightTrigger&&LeftX==other.LeftX&&LeftY==other.LeftY&&RightX==other.RightX&&RightY==other.RightY; }
    }
    internal interface IGamingDiagnosticPad : IDisposable { void Submit(GamingDiagnosticFrame frame); }
    internal static class GamingDiagnostics
    {
        internal static Dictionary<string,object> Check(string id,string label,string status,string detail)
        {return new Dictionary<string,object>{{"id",id},{"label",label},{"status",status},{"detail",detail}};}
        internal static Dictionary<string,object> Unavailable(string detail)
        {return Result(new List<Dictionary<string,object>>{Check("availability","Native self-test","unavailable",detail)});}
        private static Dictionary<string,object> Result(List<Dictionary<string,object>> checks)
        {var passed=checks.Count>0;foreach(var check in checks)if((string)check["status"]!="passed")passed=false;return new Dictionary<string,object>{{"passed",passed},{"checks",checks.ToArray()}};}
        private static bool Until(Func<bool> condition,Action<int> wait,int count=50)
        {for(int i=0;i<count;i++){if(condition())return true;wait(40);}return condition();}
        internal static Dictionary<string,object> NativeController(Func<IGamingDiagnosticPad> create)
        {return Controller(create,ReadXInput,Thread.Sleep);}
        internal static Dictionary<string,object> Controller(Func<IGamingDiagnosticPad> create,Func<Dictionary<uint,GamingDiagnosticFrame>> read,Action<int> wait)
        {
            var checks=new List<Dictionary<string,object>>();IGamingDiagnosticPad pad=null;uint? slot=null;
            try{
                var before=read();if(before.Count>=4)return Unavailable("All four XInput slots are occupied. Disconnect a controller and retry.");
                pad=create();checks.Add(Check("controller-create","Temporary Xbox device","passed","Created a temporary virtual Xbox controller."));
                var found=Until(()=>{foreach(var item in read())if(!before.ContainsKey(item.Key)){slot=item.Key;return true;}return false;},wait);
                if(!found)throw new InvalidOperationException("The temporary device did not appear in XInput.");
                var expected=new GamingDiagnosticFrame{Buttons=0x1000,LeftX=12345,LeftY=-12345,RightX=-9000,RightY=9000,LeftTrigger=173,RightTrigger=91};
                pad.Submit(expected);
                var verified=Until(()=>{GamingDiagnosticFrame actual;return read().TryGetValue(slot.Value,out actual)&&actual.Matches(expected);},wait);
                checks.Add(Check("controller-readback","Native XInput readback",verified?"passed":"failed",verified?"XInput read the submitted buttons, sticks and both triggers.":"XInput did not match the submitted test frame."));
                pad.Submit(new GamingDiagnosticFrame());
                var neutral=Until(()=>{GamingDiagnosticFrame actual;return read().TryGetValue(slot.Value,out actual)&&actual.Matches(new GamingDiagnosticFrame());},wait);
                checks.Add(Check("controller-neutral","Neutral controller state",neutral?"passed":"failed",neutral?"XInput confirmed every test input was released.":"XInput did not confirm the neutral state."));
            }catch(Exception error){checks.Add(Check("controller-native","Native controller test",pad==null?"unavailable":"failed",pad==null?"The virtual controller runtime is unavailable. Start a session to install the bundled driver, then retry.":error.Message));}
            finally{
                if(pad!=null){try{pad.Submit(new GamingDiagnosticFrame());}catch{}try{pad.Dispose();var removed=!slot.HasValue||Until(()=>!read().ContainsKey(slot.Value),wait);checks.Add(Check("controller-remove","Temporary device cleanup",removed?"passed":"failed",removed?"The temporary Xbox device was removed.":"The temporary device is still visible in XInput."));}catch(Exception error){checks.Add(Check("controller-remove","Temporary device cleanup","failed",error.Message));}}
            }
            return Result(checks);
        }
        internal static Dictionary<string,object> NativeLan(Func<GamingLanConfiguration,IGamingLanAdapter> create)
        {
            string address=null;
            for(int subnet=250;subnet>=230&&address==null;subnet--){var prefix="10.203."+subnet+".";bool used=false;foreach(var item in NetworkInterface.GetAllNetworkInterfaces())foreach(var value in item.GetIPProperties().UnicastAddresses)if(value.Address.ToString().StartsWith(prefix,StringComparison.Ordinal))used=true;if(!used)address=prefix+"249";}
            return address==null?Unavailable("Reserved diagnostic subnets are already in use. End other local gaming sessions and retry."):Lan(create,CheckLanPlumbing,config=>Until(()=>!AdapterExists(config),Thread.Sleep),address);
        }
        internal static Dictionary<string,object> Lan(Func<GamingLanConfiguration,IGamingLanAdapter> create,Func<IGamingLanAdapter,GamingLanConfiguration,List<Dictionary<string,object>>> plumbing,Func<GamingLanConfiguration,bool> removed,string address="10.203.249.249")
        {
            var checks=new List<Dictionary<string,object>>();IGamingLanAdapter adapter=null;GamingLanConfiguration config;
            GamingLanConfiguration.TryCreate(Guid.NewGuid().ToString("N"),address,out config);
            try{
                adapter=create(config);checks.Add(Check("lan-create","Temporary LAN adapter","passed","Created and configured Vumiro's temporary /24 adapter. This does not test another PC."));
                checks.AddRange(plumbing(adapter,config));
            }catch(Exception error){checks.Add(Check("lan-native","Local adapter plumbing",adapter==null?"unavailable":"failed",error.Message));}
            finally{if(adapter!=null){try{adapter.Dispose();var clean=removed(config);checks.Add(Check("lan-remove","Temporary adapter cleanup",clean?"passed":"failed",clean?"The temporary adapter and IP configuration were removed.":"The temporary adapter is still present."));}catch(Exception error){checks.Add(Check("lan-remove","Temporary adapter cleanup","failed",error.Message));}}}
            return Result(checks);
        }
        private static bool AdapterExists(GamingLanConfiguration config)
        {foreach(var item in NetworkInterface.GetAllNetworkInterfaces()){Guid id;if(Guid.TryParse(item.Id,out id)&&id.ToString("N")==config.SessionId)return true;}return false;}
        private static List<Dictionary<string,object>> CheckLanPlumbing(IGamingLanAdapter adapter,GamingLanConfiguration config)
        {
            var checks=new List<Dictionary<string,object>>();var local=IPAddress.Parse(config.Address);var remote=IPAddress.Parse(config.RemoteAddress);
            using(var socket=new UdpClient(AddressFamily.InterNetwork)){
                var bound=Until(()=>{try{socket.Client.Bind(new IPEndPoint(local,0));return true;}catch(SocketException error){if(error.SocketErrorCode!=SocketError.AddressNotAvailable)throw;return false;}},Thread.Sleep,150);
                if(!bound)throw new InvalidOperationException("Windows did not make the adapter address usable.");
                socket.Client.ReceiveTimeout=2000;var port=((IPEndPoint)socket.Client.LocalEndPoint).Port;
                var payload=Guid.NewGuid().ToByteArray();socket.Send(payload,payload.Length,new IPEndPoint(remote,port));
                var outbound=false;using(var cancel=new CancellationTokenSource(2500))while(!cancel.IsCancellationRequested){var packet=adapter.Read(cancel.Token);if(packet!=null&&packet.Length>=28+payload.Length&&packet[9]==17&&GamingLanPacket.IsAllowed(packet,config,false)){var match=true;for(var i=0;i<payload.Length;i++)if(packet[28+i]!=payload[i])match=false;if(match){outbound=true;break;}}}
                checks.Add(Check("lan-outbound","Windows to adapter UDP",outbound?"passed":"failed",outbound?"The adapter read the test datagram emitted by Windows.":"The outbound test datagram was not observed."));
                var inbound=UdpPacket(remote,local,port,payload);if(!adapter.Write(inbound))throw new InvalidOperationException("The adapter could not accept the inbound test packet.");
                var received=false;try{var sender=new IPEndPoint(IPAddress.Any,0);var bytes=socket.Receive(ref sender);received=sender.Address.Equals(remote)&&Convert.ToBase64String(bytes)==Convert.ToBase64String(payload);}catch(SocketException){}
                checks.Add(Check("lan-inbound","Adapter to Windows UDP",received?"passed":"failed",received?"Windows received the datagram injected through the adapter.":"Windows did not receive the injected datagram; check its firewall rules."));
            }return checks;
        }
        private static byte[] UdpPacket(IPAddress from,IPAddress to,int port,byte[] payload)
        {
            var bytes=new byte[28+payload.Length];bytes[0]=0x45;bytes[2]=(byte)(bytes.Length>>8);bytes[3]=(byte)bytes.Length;bytes[8]=64;bytes[9]=17;
            Buffer.BlockCopy(from.GetAddressBytes(),0,bytes,12,4);Buffer.BlockCopy(to.GetAddressBytes(),0,bytes,16,4);
            bytes[20]=(byte)(port>>8);bytes[21]=(byte)port;bytes[22]=(byte)(port>>8);bytes[23]=(byte)port;bytes[24]=(byte)((payload.Length+8)>>8);bytes[25]=(byte)(payload.Length+8);Buffer.BlockCopy(payload,0,bytes,28,payload.Length);
            uint sum=0;for(int i=0;i<20;i+=2)sum+=(uint)(bytes[i]<<8|bytes[i+1]);while(sum>>16!=0)sum=(sum&65535)+(sum>>16);bytes[10]=(byte)(~sum>>8);bytes[11]=(byte)~sum;return bytes;
        }
        [StructLayout(LayoutKind.Sequential)] private struct XInputState{internal uint Packet;internal GamingDiagnosticFrame Frame;}
        [DllImport("xinput1_4.dll")]private static extern uint XInputGetState(uint index,out XInputState state);
        private static Dictionary<uint,GamingDiagnosticFrame> ReadXInput(){var result=new Dictionary<uint,GamingDiagnosticFrame>();for(uint i=0;i<4;i++){XInputState state;if(XInputGetState(i,out state)==0)result[i]=state.Frame;}return result;}
    }
}
