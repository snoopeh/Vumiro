using System;
using System.Drawing;
namespace Vumiro.Client {
 internal static class NativeResizeGrip {
  internal static int Width(int dpi) { return Math.Max(5,(int)Math.Round(6*dpi/96.0)); }
  internal static int HitTest(Point point,Size size,int edge) {
   var left=point.X<edge;var right=point.X>=size.Width-edge;var top=point.Y<edge;var bottom=point.Y>=size.Height-edge;
   return top?left?13:right?14:12:bottom?left?16:right?17:15:left?10:right?11:1;
  }
 }
}
