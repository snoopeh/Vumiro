using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Forms;
namespace Vumiro.Client {
 // Owns a finite effect on the UI thread. Never activates or restores a window.
 internal sealed class NativeNudge : IDisposable {
  private readonly Form owner;
  private readonly Func<bool> fullscreen;
  private readonly Func<Rectangle?> externalFullscreen;
  private readonly Timer timer=new Timer { Interval=16 };
  private readonly Stopwatch clock=new Stopwatch();
  private Rectangle original,expected;
  private FormWindowState originalState;
  private bool originalFullscreen;
  private bool moving,disposed;
  private ScreenNudgeGlow glow;
  internal bool Active {get;private set;}
  internal NativeNudge(Form owner,Func<bool> fullscreen,Func<Rectangle?> externalFullscreen=null){this.owner=owner;this.fullscreen=fullscreen;this.externalFullscreen=externalFullscreen??ForegroundAttention.ExternalFullscreenMonitor;timer.Tick+=(s,e)=>Tick();}
  internal static bool TryParse(Dictionary<string,object> message,out bool silent){
   silent=false;object type,action,value;
   if(message==null||message.Count!=3||!message.TryGetValue("type",out type)||!Equals(type,"window")||!message.TryGetValue("action",out action)||!Equals(action,"nudge")||!message.TryGetValue("silent",out value)||!(value is bool))return false;
   silent=(bool)value;return true;
  }
  internal static bool MotionAllowed(){bool enabled;return !SystemParametersInfo(0x1042,0,out enabled,0)||enabled;}
  [DllImport("user32.dll")]private static extern bool SystemParametersInfo(uint action,uint parameter,[MarshalAs(UnmanagedType.Bool)]out bool value,uint flags);
  internal static Point Offset(double milliseconds){
   if(milliseconds<=0||milliseconds>=900)return Point.Empty;
   var strength=12*(1-milliseconds/900);return new Point((int)Math.Round(Math.Sin(milliseconds*Math.PI/42)*strength),(int)Math.Round(Math.Sin(milliseconds*Math.PI/65)*strength*.42));
  }
  internal bool Start(bool silent){
   if(disposed||owner.IsDisposed)return false;
   if(Active){if(silent&&glow==null)ShowGlow();return false;}
   Active=true;original=expected=owner.Bounds;originalState=owner.WindowState;originalFullscreen=fullscreen();
   moving=!silent&&!externalFullscreen().HasValue&&owner.Visible&&owner.WindowState!=FormWindowState.Minimized&&MotionAllowed();
   if(!moving)ShowGlow();
   clock.Restart();timer.Start();return true;
  }
  private void ShowGlow(){
   if(moving){RestorePosition();moving=false;}
   if(glow!=null)return;
   var monitor=externalFullscreen();
   glow=new ScreenNudgeGlow(monitor??(owner.Visible&&owner.WindowState!=FormWindowState.Minimized?owner.Bounds:Screen.FromControl(owner).WorkingArea),monitor.HasValue);glow.Show();
  }
  private void Tick(){
   if(owner.IsDisposed||!Active){Cancel();return;}
   var elapsed=clock.Elapsed.TotalMilliseconds;
   if(moving&&owner.Bounds!=expected){Cancel(false);return;}
   if(elapsed>=900){Cancel();return;}
   if(moving){
    if(externalFullscreen().HasValue){ShowGlow();return;}
    if(!owner.Visible||owner.WindowState!=originalState||fullscreen()!=originalFullscreen){Cancel();return;}
    else{var offset=Offset(elapsed);expected=new Rectangle(original.X+offset.X,original.Y+offset.Y,original.Width,original.Height);SetWindowPos(owner.Handle,IntPtr.Zero,expected.X,expected.Y,0,0,0x0010|0x0001|0x0004);}
   }
   if(glow!=null)glow.Pulse(elapsed);
  }
  private void RestorePosition(){if(!owner.IsDisposed&&owner.Visible&&owner.WindowState==originalState&&fullscreen()==originalFullscreen)SetWindowPos(owner.Handle,IntPtr.Zero,original.X,original.Y,original.Width,original.Height,0x0010|0x0004);}
  internal void Cancel(bool restoreOriginal=true){timer.Stop();clock.Reset();if(moving&&restoreOriginal&&owner.Bounds==expected)RestorePosition();moving=false;Active=false;glow?.Dispose();glow=null;}
  public void Dispose(){if(disposed)return;Cancel();timer.Dispose();disposed=true;}
  [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window,IntPtr insertAfter,int x,int y,int width,int height,uint flags);
 }
 // Per-pixel alpha drawn from a generated bitmap, never from screen capture.
 internal sealed class ScreenNudgeGlow : Form {
  private IntPtr memoryDc,bitmap,oldBitmap;
  private readonly Size imageSize;
  private readonly bool yellow;
  internal ScreenNudgeGlow(Rectangle monitor,bool yellow=false){
   this.yellow=yellow;
   Text="Vumiro nudge";
   FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;StartPosition=FormStartPosition.Manual;Bounds=monitor;imageSize=monitor.Size;
  }
  protected override bool ShowWithoutActivation {get{return true;}}
  protected override CreateParams CreateParams {get{var value=base.CreateParams;value.ExStyle|=0x00080000|0x00000020|0x08000000|0x00000080;return value;}}
  protected override void OnShown(EventArgs e){base.OnShown(e);CreateImage();Pulse(0);}
  private void CreateImage(){
   using(var image=new Bitmap(imageSize.Width,imageSize.Height,PixelFormat.Format32bppPArgb)){
    using(var graphics=Graphics.FromImage(image)){
     graphics.Clear(Color.Transparent);var feather=Math.Min(70,Math.Min(image.Width,image.Height)/4);
     for(var distance=0;distance<feather;distance++){
      var amount=1-distance/(double)feather;var alpha=(int)Math.Round(145*amount*amount);
      using(var pen=new Pen(Color.FromArgb(alpha,yellow?255:246,yellow?211:240,yellow?68:235)))graphics.DrawRectangle(pen,distance,distance,image.Width-distance*2-1,image.Height-distance*2-1);
     }
    }
    memoryDc=CreateCompatibleDC(IntPtr.Zero);bitmap=image.GetHbitmap(Color.FromArgb(0));oldBitmap=SelectObject(memoryDc,bitmap);
   }
  }
  internal void Pulse(double elapsed){
   if(memoryDc==IntPtr.Zero||IsDisposed)return;
   var opacity=Math.Min(1,Math.Min(elapsed/160,(900-elapsed)/180));
   var destination=new NativePoint {X=Left,Y=Top};var source=new NativePoint();var size=new NativeSize {Width=imageSize.Width,Height=imageSize.Height};var blend=new Blend {Operation=0,Flags=0,Alpha=(byte)Math.Max(0,Math.Min(255,opacity*255)),Format=1};
   UpdateLayeredWindow(Handle,IntPtr.Zero,ref destination,ref size,memoryDc,ref source,0,ref blend,2);
  }
  protected override void WndProc(ref Message message){if(message.Msg==0x0084){message.Result=new IntPtr(-1);return;}if(message.Msg==0x0021){message.Result=new IntPtr(3);return;}base.WndProc(ref message);}
  protected override void Dispose(bool disposing){if(memoryDc!=IntPtr.Zero){SelectObject(memoryDc,oldBitmap);DeleteObject(bitmap);DeleteDC(memoryDc);memoryDc=IntPtr.Zero;}base.Dispose(disposing);}
  [StructLayout(LayoutKind.Sequential)] private struct NativePoint {public int X,Y;}
  [StructLayout(LayoutKind.Sequential)] private struct NativeSize {public int Width,Height;}
  [StructLayout(LayoutKind.Sequential,Pack=1)] private struct Blend {public byte Operation,Flags,Alpha,Format;}
  [DllImport("user32.dll")]private static extern bool UpdateLayeredWindow(IntPtr window,IntPtr destinationDc,ref NativePoint destination,ref NativeSize size,IntPtr sourceDc,ref NativePoint source,uint color,ref Blend blend,uint flags);
  [DllImport("gdi32.dll")]private static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")]private static extern IntPtr SelectObject(IntPtr dc,IntPtr value);
  [DllImport("gdi32.dll")]private static extern bool DeleteObject(IntPtr value);
  [DllImport("gdi32.dll")]private static extern bool DeleteDC(IntPtr dc);
 }
}
