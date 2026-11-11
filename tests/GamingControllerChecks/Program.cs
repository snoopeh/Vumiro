using System;
using System.Collections.Generic;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Threading;
using Vumiro.Client;
namespace Vumiro.Client {
 internal sealed partial class ClientWindow : Form { }
 internal static class GamingServices { internal static string FindInstalledExecutable(string component) { return null; } }
}
internal static class Program {
 static void Check(bool ok,string message){if(!ok)throw new Exception(message);}
 [StructLayout(LayoutKind.Sequential)] struct XInputGamepad { internal ushort Buttons; internal byte LeftTrigger,RightTrigger; internal short LeftX,LeftY,RightX,RightY; }
 [StructLayout(LayoutKind.Sequential)] struct XInputState { internal uint Packet; internal XInputGamepad Gamepad; }
 [DllImport("xinput1_4.dll")] static extern uint XInputGetState(uint index,out XInputState state);
 static int Connected(){int count=0;for(uint i=0;i<4;i++){XInputState state;if(XInputGetState(i,out state)==0)count++;}return count;}
 static bool WaitFor(Func<bool> check){for(int i=0;i<40;i++){if(check())return true;Thread.Sleep(50);}return false;}
 static bool IsActive(ClientWindow window){var reply=(Dictionary<string,object>)window.HandleGamingControllerAction("mapper-status",null);return (bool)((Dictionary<string,object>)reply["controller"])["active"];}
 static void Integration(){
  int baseline=Connected();Check(baseline<4,"all XInput slots already occupied");
  using(var window=new ClientWindow())try {
   var start=(Dictionary<string,object>)window.HandleGamingControllerAction("mapper-start",new Dictionary<string,object>{{"bindings",new Dictionary<string,object>{{"a","Space"}}}});
   Check((bool)start["ok"],"real controller startup failed: "+start["error"]);
   Check(IsActive(window),"real mapper did not become active");
   Check(WaitFor(()=>Connected()==baseline+1),"virtual Xbox controller absent from XInput");
   window.HandleGamingControllerAction("mapper-stop",null);
   Check(WaitFor(()=>Connected()==baseline),"stop left a virtual Xbox controller connected");
   start=(Dictionary<string,object>)window.HandleGamingControllerAction("mapper-start",new Dictionary<string,object>{{"bindings",new Dictionary<string,object>{{"a","Space"}}}});
   Check((bool)start["ok"],"real controller restart failed");
   Check(WaitFor(()=>Connected()==baseline+1),"restarted controller absent from XInput");
   Thread.Sleep(5500);
   Check(!IsActive(window),"expired heartbeat left mapper active");
   Check(WaitFor(()=>Connected()==baseline),"expired heartbeat left a virtual Xbox controller connected");
   Console.WriteLine("Real ViGEmBus/XInput integration passed: connect, stop/remove, restart, watchdog/remove.");
  }finally{window.StopGamingController();}
 }
 [STAThread] static int Main(string[] args){
  try {
   Dictionary<string,string> b; string error;
   Check(ControllerMapping.TryValidate(new Dictionary<string,object>{{"leftUp","KeyW"},{"leftRight","KeyD"},{"a","Space"}},out b,out error),"valid profile rejected");
   var frame=ControllerMapping.Frame(b,new HashSet<string>{"KeyW","KeyD","Space"});
   Check(frame.LeftX==23169&&frame.LeftY==23169&&frame.Buttons==0x1000,"normalized diagonal/button mismatch");
   Check(!ControllerMapping.TryValidate(new Dictionary<string,object>{{"a","KeyA"},{"b","KeyA"}},out b,out error),"duplicate accepted");
   Check(!ControllerMapping.TryValidate(new Dictionary<string,object>{{"a","Escape"}},out b,out error),"Escape must remain emergency stop");
   Check(!ControllerMapping.TryValidate(new Dictionary<string,object>{{"unknown","KeyA"}},out b,out error),"unknown target accepted");
   Check(!ControllerMapping.TryValidate(new Dictionary<string,object>{{"a","F24"}},out b,out error),"unsupported key accepted");
   Check(ControllerMapping.KeyCode(0x41,0,0)=="KeyA","letter code mismatch");
   Check(ControllerMapping.KeyCode(0x10,0x36,0)=="ShiftRight","right shift mismatch");
   Check(ControllerMapping.KeyCode(0x11,0,1)=="ControlRight","right control mismatch");
   Check(ControllerMapping.KeyCode(0x0D,0,1)=="NumpadEnter","numpad enter mismatch");
   Check(ControllerMapping.KeyCode(0x59,0x15,0)=="KeyY","physical layout-independent key mismatch");
   Check(ControllerMapping.KeyCode(0x28,0x50,0)=="Numpad2","NumLock-off key mismatch");
   Check(ControllerMapping.SystemShortcut("Tab",true,false),"Alt+Tab must pass through");
   Check(ControllerMapping.SystemShortcut("F4",true,false),"Alt+F4 must pass through");
   Check(ControllerMapping.SystemShortcut("KeyD",false,true),"Windows shortcuts must pass through");
   Check(!ControllerMapping.SystemShortcut("Tab",false,false),"plain Tab should remain bindable");
   Check(ControllerMapping.StreamWindow("C:\\Program Files\\Moonlight Game Streaming\\Moonlight.exe","C:\\Program Files\\Moonlight Game Streaming\\Moonlight.exe","SDL_app","Gaming PC - Moonlight"),"trusted streaming window rejected");
   Check(!ControllerMapping.StreamWindow("C:\\Program Files\\Moonlight Game Streaming\\Moonlight.exe","C:\\Program Files\\Moonlight Game Streaming\\Moonlight.exe","Qt5152QWindowIcon","Moonlight"),"Moonlight settings must not capture");
   Check(!ControllerMapping.StreamWindow("C:\\Program Files\\Moonlight Game Streaming\\Moonlight.exe","C:\\Program Files\\Moonlight Game Streaming\\Moonlight.exe","SDL_app","Add PC"),"unrecognized title must not capture");
   Check(!ControllerMapping.StreamWindow("C:\\untrusted\\Moonlight.exe","C:\\Program Files\\Moonlight Game Streaming\\Moonlight.exe","SDL_app","Gaming PC - Moonlight"),"untrusted executable must not capture");
   Check(ControllerMapping.TryValidate(new Dictionary<string,object>{{"a","Space"}},out b,out error),"valid button");
   var state=new ControllerCaptureState(b);
   Check(state.Key("Space",true,true),"mapped down not consumed");
   Check(state.Current.Buttons==0x1000,"button not held");
   state.Focus(false); Check(state.Current.Buttons==0,"focus loss did not release");
   state.Focus(true); Check(state.Current.Buttons==0,"focus regain replays held input");
   state.Key("Space",true,true); Check(state.Current.Buttons==0,"auto-repeat resurrected a held key after focus loss");
   state.Key("Space",false,true); state.Key("Space",true,true); Check(state.Current.Buttons==0x1000,"fresh press after focus regain ignored");
   state.Key("KeyP",true,false); Check(state.Current.Buttons==0,"foreign unmapped input must neutralize controls");
   Check(!state.Key("KeyP",true,true),"unmapped key swallowed");
   state.Key("Space",true,true); state.Release(); Check(state.Current.Buttons==0,"stop did not release");
   Check(!state.Key("Space",true,false),"foreign foreground key swallowed");
   Check(state.Current.Buttons==0,"foreign foreground changed state");
   using(var window=new ClientWindow()) {
    Check(window.HandleGamingControllerAction("unknown",null)==null,"unknown action claimed");
    var rejected=(Dictionary<string,object>)window.HandleGamingControllerAction("mapper-start",new Dictionary<string,object>{{"bindings",new Dictionary<string,object>{{"a","Escape"}}}});
    Check(!(bool)rejected["ok"],"invalid start must fail");
    var status=(Dictionary<string,object>)window.HandleGamingControllerAction("mapper-status",null);
    var controller=(Dictionary<string,object>)status["controller"];
    Check(!(bool)controller["active"]&&!(bool)controller["capturing"],"status falsely active");
    Console.WriteLine("Installed ViGEmBus readiness: "+controller["available"]+"; "+controller["message"]);
    if(Array.IndexOf(args,"--missing-client")>=0) {
     Check(!(bool)controller["available"],"missing client falsely reported ready");
     var missing=(Dictionary<string,object>)window.HandleGamingControllerAction("mapper-start",new Dictionary<string,object>{{"bindings",new Dictionary<string,object>{{"a","Space"}}}});
     Check(!(bool)missing["ok"],"missing client falsely started");
     Check(!(bool)((Dictionary<string,object>)missing["controller"])["active"],"missing client left active mapper");
     Console.WriteLine("Missing managed ViGEm client: unavailable status and failed start verified.");
    }
    window.StopGamingController(); window.StopGamingController();
   }
   Console.WriteLine("Gaming controller checks passed (mapping, validation, key codes, focus release, lifecycle).");
   if(Array.IndexOf(args,"--integration")>=0)Integration();
   return 0;
  }catch(Exception e){Console.Error.WriteLine(e);return 1;}
 }
}
