using System;

namespace Vumiro.Client
{
    // WebView pointerdown starts a native move loop, which consumes DOM
    // double-click events. Match caption clicks using Windows' own thresholds.
    internal sealed class CaptionClickTracker
    {
        private bool pending;
        private uint timestamp;
        private int x, y;

        internal bool IsDoubleClick(uint now, int nextX, int nextY, int delay, int width, int height)
        {
            var matched = pending && unchecked(now - timestamp) <= delay &&
                Math.Abs((long)nextX - x) <= width / 2 && Math.Abs((long)nextY - y) <= height / 2;
            pending = !matched;
            timestamp = now; x = nextX; y = nextY;
            return matched;
        }

        internal void Reset() { pending = false; }
    }
}
