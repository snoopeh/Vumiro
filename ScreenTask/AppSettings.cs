using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ScreenTask
{
    [Serializable]
    public class AppSettings
    {
        public string IP { get; set; }
        public int Port { get; set; }
        public int FrameRate { get; set; } = 30;
        public bool IsPrivateSession { get; set; }
        public string Username { get; set; }
        public string Password { get; set; }
        public int SelectedScreenIndex { get; set; }
        public bool IsShowMouseEnabled { get; set; }
        public bool IsAutoStartServerEnabled { get; set; }
        public bool IsStartMinimizedEnabled { get; set; }
        public int ImageQuality { get; set; } = 90;
        public bool AllowPublicAccess { get; set; }
        public bool ShareSystemAudio { get; set; } = true;
        public int OutputWidth { get; set; } = 0;
        public int MaxBitrateMbps { get; set; } = 20;
        public bool AutomaticHdr { get; set; } = true;
        public bool FileTransferOnly { get; set; }
        public double ManualHdrExposure { get; set; }
        public int ManualHdrPeakNits { get; set; } = 1000;
        public bool HdrColorCorrection { get; set; }
        public double HdrExposure { get; set; }
        public int HdrPeakNits { get; set; } = 1000;
        public string AudioDeviceId { get; set; }
        public string AudioMode { get; set; } = "device";
        public int AudioProcessId { get; set; }
        public string AudioProcessName { get; set; }
        public string CallSignalingUrl { get; set; } = "wss://screentask-rooms.screentask-room-signaling.workers.dev/call-signaling";
    }
}
