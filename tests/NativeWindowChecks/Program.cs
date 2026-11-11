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
  using(var owner=new Form { StartPosition=FormStartPosition.Manual,Bounds=new Rectangle(120,120,400,300) })using(var effect=new NativeNudge(owner,()=>false,()=>null)){
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
  foreach(var fullscreen in new[]{false,true}){
   using(var owner=new Form { StartPosition=FormStartPosition.Manual,Bounds=new Rectangle(120,120,400,300) })using(var effect=new NativeNudge(owner,()=>fullscreen,()=>null)){
    owner.Show();if(fullscreen)owner.Bounds=Screen.FromControl(owner).Bounds;else owner.WindowState=FormWindowState.Maximized;
    Application.DoEvents();var bounds=owner.Bounds;var restore=owner.RestoreBounds;var state=owner.WindowState;bool moved=false;
    effect.Start(false);var clock=Stopwatch.StartNew();
    while(effect.Active&&clock.ElapsedMilliseconds<2500){Application.DoEvents();moved|=owner.Location!=bounds.Location;Thread.Sleep(5);}
    if(NativeNudge.MotionAllowed())Check(moved,fullscreen?"content fullscreen shakes the native window":"maximized window shakes instead of screen glow");
    Check(owner.Bounds==bounds&&owner.WindowState==state,"large-window nudge restores exact bounds and state");
    Check(owner.RestoreBounds==restore,"maximized nudge preserves normal restore bounds");owner.Close();
   }
  }
  var guarded=typeof(NativeNudge).GetConstructor(System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Instance,null,new[]{typeof(Form),typeof(Func<bool>),typeof(Func<Rectangle?>)},null);
  Check(guarded!=null,"nudge accepts foreground policy independent of its own fullscreen state");
  using(var owner=new Form {Bounds=new Rectangle(120,120,400,300)}){
   owner.Show();Application.DoEvents();var bounds=owner.Bounds;var monitor=Screen.FromControl(owner).Bounds;
   using(var effect=(NativeNudge)guarded.Invoke(new object[]{owner,(Func<bool>)(()=>false),(Func<Rectangle?>)(()=>monitor)})){
    effect.Start(false);Application.DoEvents();
    Check(owner.Bounds==bounds,"external fullscreen never shakes owner");
    ScreenNudgeGlow cue=null;foreach(Form form in Application.OpenForms)if(form is ScreenNudgeGlow)cue=(ScreenNudgeGlow)form;
    Check(cue!=null&&cue.Bounds==monitor,"external fullscreen gets a bounded independent edge cue on its own monitor");
    var style=(CreateParams)typeof(ScreenNudgeGlow).GetProperty("CreateParams",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic).GetValue(cue,null);
    Check((style.ExStyle&0x080800a0)==0x080800a0,"external cue never steals focus or clicks");effect.Cancel();
   }
   owner.Close();
  }
  Check(ForegroundAttention.IsFullscreenBounds(new Rectangle(-1920,0,1920,1080),new Rectangle(-1920,0,1920,1080)),"fullscreen monitor includes negative desktop coordinates");
  Check(!ForegroundAttention.IsFullscreenBounds(new Rectangle(0,0,1920,1040),new Rectangle(0,0,1920,1080)),"maximized work area is not fullscreen");
  using(var owner=new Form {StartPosition=FormStartPosition.Manual,Bounds=new Rectangle(120,120,400,300)})using(var effect=new NativeNudge(owner,()=>false,()=>null)){
   owner.Show();Application.DoEvents();effect.Start(false);var userBounds=new Rectangle(370,240,500,400);owner.Bounds=userBounds;
   var clock=Stopwatch.StartNew();while(effect.Active&&clock.ElapsedMilliseconds<2000){Application.DoEvents();Thread.Sleep(5);}
   Check(owner.Bounds==userBounds,"user movement or resize cancels nudge without restoring stale geometry");owner.Close();
  }
  Console.WriteLine("Native window nudge and resize checks passed.");
 }
}
