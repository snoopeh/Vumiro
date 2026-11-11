using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Vumiro.Client;
namespace Vumiro.Client { internal sealed partial class ClientWindow : Form { } }
internal static class Program {
 static void Check(bool ok,string text){if(!ok)throw new Exception(text);}
 static Dictionary<string,object> Frame(int buttons=0){return new Dictionary<string,object>{{"buttons",buttons},{"leftX",23169},{"leftY",23169},{"rightX",0},{"rightY",0},{"leftTrigger",255},{"rightTrigger",0}};}
 [StructLayout(LayoutKind.Sequential)] struct Pad {internal ushort Buttons;internal byte LT,RT;internal short LX,LY,RX,RY;}
 [StructLayout(LayoutKind.Sequential)] struct State {internal uint Packet;internal Pad Gamepad;}
 [DllImport("xinput1_4.dll")] static extern uint XInputGetState(uint index,out State state);
 static int Count(){int n=0;for(uint i=0;i<4;i++){State s;if(XInputGetState(i,out s)==0)n++;}return n;}
 static bool Wait(Func<bool> fn){for(int i=0;i<40;i++){if(fn())return true;Thread.Sleep(50);}return false;}
 [STAThread]static int Main(string[]args){try{
  ControllerFrame f;Check(GamingRemoteInput.TryFrame(Frame(0x1000),out f)&&f.Buttons==0x1000&&f.LeftX==23169,"valid frame");
  foreach(var key in new[]{"buttons","leftX","leftTrigger"}){var b=Frame();b[key]=999999;Check(!GamingRemoteInput.TryFrame(b,out f),"invalid bounded "+key);}
  var missing=Frame();missing.Remove("rightY");Check(!GamingRemoteInput.TryFrame(missing,out f),"missing axis");
  var reserved=Frame(0x400);Check(!GamingRemoteInput.TryFrame(reserved,out f),"reserved button");
  var fractional=Frame();fractional["leftX"]=0.5;Check(!GamingRemoteInput.TryFrame(fractional,out f),"fractional axis");
  long now=0;var frames=new List<ControllerFrame>();int closed=0;
  var input=new GamingRemoteInput("0123456789abcdef0123456789abcdef",frames.Add,()=>closed++,()=>now);
  Check(!input.Receive("ffffffffffffffffffffffffffffffff",0,Frame()),"wrong session accepted");
  Check(input.Receive(input.SessionId,0,Frame(0x1000)),"first frame rejected");
  Check(!input.Receive(input.SessionId,0,Frame()),"replay accepted");
  Check(!input.Receive(input.SessionId,-1,Frame()),"negative sequence accepted");
  now=301;input.Tick();Check(frames[frames.Count-1].Buttons==0&&frames[frames.Count-1].LeftX==0,"watchdog stuck input");
  now=400;Check(input.Receive(input.SessionId,1,Frame(0x2000)),"fresh input rejected");
  now=5501;input.Tick();Check(input.Active&&closed==0&&frames[frames.Count-1].Buttons==0,"idle pad must remain attached and neutral");now=5600;Check(input.Receive(input.SessionId,2,Frame()),"refocus after idle rejected");input.Dispose();input.Dispose();Check(closed==1,"double disposal");
  Check(!input.Receive(input.SessionId,3,Frame()),"input after stop");
  if(args.Length==1&&args[0]=="--integration"){
   int before=Count();Check(before<4,"No free XInput slot");
   using(var window=new ClientWindow()){
    var session="0123456789abcdef0123456789abcdef";
    var reply=(Dictionary<string,object>)window.HandleGamingControllerAction("remote-controller-start",new Dictionary<string,object>{{"sessionId",session}});
    Check((bool)reply["ok"],"real pad startup failed");Check(Wait(()=>Count()==before+1),"pad missing from XInput");
    window.HandleGamingControllerAction("remote-controller-frame",new Dictionary<string,object>{{"sessionId",session},{"sequence",1},{"frame",Frame(0x1000)}});
    window.StopGamingController();Check(Wait(()=>Count()==before),"pad remained connected");
   }
   Console.WriteLine("Real remote input/XInput integration passed.");
  }
  Console.WriteLine("Remote controller validation, ordering and watchdog checks passed.");return 0;
 }catch(Exception e){Console.Error.WriteLine(e);return 1;}}
}
