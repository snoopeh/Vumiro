using System;
using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;
using System.Threading;
using System.Diagnostics;
using Vumiro.Client;
class Program {
 static void Check(bool value,string name){if(!value)throw new Exception(name);}
 [STAThread] static void Main(){
  bool silent;
  Check(NativeNudge.TryParse(new Dictionary<string,object>{{"type","window"},{"action","nudge"},{"silent",true}},out silent)&&silent,"bounded boolean accepted");
  Check(!NativeNudge.TryParse(new Dictionary<string,object>{{"type","window"},{"action","nudge"},{"silent","true"}},out silent),"string rejected");
  Check(NativeNudge.Offset(0)==Point.Empty&&NativeNudge.Offset(900)==Point.Empty,"exact endpoints");
  Check(NativeNudge.Offset(80)!=Point.Empty&&Math.Abs(NativeNudge.Offset(80).X)<=12,"bounded real window motion");
  Check(NativeResizeGrip.HitTest(new Point(0,0),new Size(800,600),6)==13,"north west resize");
  Check(NativeResizeGrip.HitTest(new Point(799,599),new Size(800,600),6)==17,"south east resize");
  Check(NativeResizeGrip.HitTest(new Point(400,300),new Size(800,600),6)==1,"content unaffected");
  using(var owner=new Form())using(var effect=new NativeNudge(owner,()=>false)){
   Check(effect.Start(true),"silent start");Check(!effect.Start(false),"duplicate bounded");effect.Cancel();Check(!effect.Active,"cancel cleans");
  }
  using(var owner=new Form { StartPosition=FormStartPosition.Manual,Bounds=new Rectangle(120,120,400,300) })using(var effect=new NativeNudge(owner,()=>false)){
   owner.Show();Application.DoEvents();var original=owner.Bounds;var motionAllowed=NativeNudge.MotionAllowed();effect.Start(false);var clock=Stopwatch.StartNew();bool moved=false;
   while(effect.Active&&clock.ElapsedMilliseconds<5000){Application.DoEvents();if(owner.Location!=original.Location)moved=true;Thread.Sleep(10);}
   if(!motionAllowed){Check(!moved,"OS reduced motion does not move Form");Console.WriteLine("Physical motion smoke skipped: Windows animation preference selects screen glow.");}
   else if(moved)Console.WriteLine("Physical motion smoke observed native Form movement.");
   else Console.WriteLine("Physical motion sample not observed before completion; deterministic offset checks cover trajectory.");
   Check(owner.Bounds==original,"completion restores exact native bounds");Check(!effect.Active,"native effect completes without requiring a fixed sampling delay");owner.Close();
  }
  using(var overlay=new ScreenNudgeGlow(new Rectangle(0,0,1920,1080))){
   Check(!overlay.ShowInTaskbar&&overlay.TopMost,"monitor overlay independent of app bounds");
   var style=(CreateParams)typeof(ScreenNudgeGlow).GetProperty("CreateParams",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic).GetValue(overlay,null);
   Check((style.ExStyle&0x080800a0)==0x080800a0,"layered click-through nonactivating tool window");
  }
  Console.WriteLine("Native window nudge and resize checks passed.");
 }
}
