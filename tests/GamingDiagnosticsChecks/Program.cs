using System;using System.Collections.Generic;using System.Threading;using Vumiro.Client;
internal static class Program {
 static int checks;static void Check(bool value,string name){if(!value)throw new Exception(name);checks++;}
 static void Main(string[] args){
  var state=new Dictionary<uint,GamingDiagnosticFrame>();Pad pad=null;var result=GamingDiagnostics.Controller(()=>pad=new Pad(state),()=>new Dictionary<uint,GamingDiagnosticFrame>(state),ms=>{});
  Check((bool)result["passed"],"full XInput path");Check(pad.Disposed&&pad.Neutral,"pad neutralized and removed");
  state=new Dictionary<uint,GamingDiagnosticFrame>();result=GamingDiagnostics.Controller(()=>pad=new Pad(state){Ignore=true},()=>new Dictionary<uint,GamingDiagnosticFrame>(state),ms=>{});
  Check(!(bool)result["passed"]&&pad.Disposed,"readback failure removes pad");
  var full=new Dictionary<uint,GamingDiagnosticFrame>();for(uint i=0;i<4;i++)full[i]=new GamingDiagnosticFrame();bool created=false;
  result=GamingDiagnostics.Controller(()=>{created=true;return pad;},()=>full,ms=>{});Check(!(bool)result["passed"]&&!created,"full XInput unavailable without new pad");
  var adapter=new Adapter();result=GamingDiagnostics.Lan(config=>adapter,(a,c)=>new List<Dictionary<string,object>>{GamingDiagnostics.Check("plumbing","Adapter plumbing","passed","Local UDP only.")},config=>adapter.Disposed);
  Check((bool)result["passed"]&&adapter.Disposed,"temporary LAN clean removal");
  adapter=new Adapter();result=GamingDiagnostics.Lan(config=>adapter,(a,c)=>{throw new Exception("readback failed");},config=>adapter.Disposed);Check(!(bool)result["passed"]&&adapter.Disposed,"failed LAN cleans adapter");
  adapter=new Adapter();result=GamingDiagnostics.Lan(config=>adapter,(a,c)=>new List<Dictionary<string,object>>(),config=>false);Check(!(bool)result["passed"],"cleanup failure is visible");
  Console.WriteLine("PASS "+checks+" native diagnostics checks.");
  if(args.Length==1&&args[0]=="--integration-controller"){var native=GamingDiagnostics.NativeController(()=>new RealPad());foreach(var row in (Dictionary<string,object>[])native["checks"])Console.WriteLine(row["id"]+": "+row["status"]+" - "+row["detail"]);Check((bool)native["passed"],"real native XInput integration");}
 }
 sealed class Pad:IGamingDiagnosticPad {readonly Dictionary<uint,GamingDiagnosticFrame> state;internal bool Disposed,Neutral,Ignore;internal Pad(Dictionary<uint,GamingDiagnosticFrame> value){state=value;state[0]=new GamingDiagnosticFrame();}public void Submit(GamingDiagnosticFrame f){Neutral=f.Buttons==0&&f.LeftX==0;if(!Ignore)state[0]=f;}public void Dispose(){Disposed=true;state.Remove(0);}}
 sealed class Adapter:IGamingLanAdapter{internal bool Disposed;public byte[] Read(CancellationToken c){return null;}public bool Write(byte[] p){return true;}public void Dispose(){Disposed=true;}}
 sealed class RealPad:IGamingDiagnosticPad{readonly VirtualGamepad pad=new VirtualGamepad();public void Submit(GamingDiagnosticFrame value){pad.Submit(new ControllerFrame{Buttons=value.Buttons,LeftX=value.LeftX,LeftY=value.LeftY,RightX=value.RightX,RightY=value.RightY,LeftTrigger=value.LeftTrigger,RightTrigger=value.RightTrigger});}public void Dispose(){pad.Dispose();}}
}
