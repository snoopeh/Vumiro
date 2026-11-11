using System;
using System.Collections.Generic;
using Nefarius.ViGEm.Client;
using Nefarius.ViGEm.Client.Targets;
using Nefarius.ViGEm.Client.Targets.Xbox360;

namespace Vumiro.Client
{
    internal struct ControllerFrame
    {
        internal ushort Buttons;
        internal short LeftX, LeftY, RightX, RightY;
        internal byte LeftTrigger, RightTrigger;
    }

    internal static class ControllerMapping
    {
        private static readonly string[] Targets = { "leftUp", "leftDown", "leftLeft", "leftRight", "rightUp", "rightDown", "rightLeft", "rightRight", "a", "b", "x", "y", "lb", "rb", "lt", "rt", "back", "start", "ls", "rs", "dpadUp", "dpadDown", "dpadLeft", "dpadRight" };
        private static readonly Dictionary<string, ushort> Buttons = new Dictionary<string, ushort> {
            {"dpadUp",1},{"dpadDown",2},{"dpadLeft",4},{"dpadRight",8},{"start",16},{"back",32},{"ls",64},{"rs",128},{"lb",256},{"rb",512},{"a",4096},{"b",8192},{"x",16384},{"y",32768}
        };
        private static readonly HashSet<string> Codes = BuildCodes();
        private static HashSet<string> BuildCodes()
        {
            var result = new HashSet<string>(StringComparer.Ordinal);
            // Generate the whitelist from the same physical-key translation used by capture.
            for (uint vk = 1; vk < 256; vk++) for (uint extended = 0; extended < 2; extended++) {
                var code = KeyCode(vk, 0, extended); if (code != null && code != "Escape") result.Add(code);
            }
            return result;
        }
        internal static bool TryValidate(Dictionary<string, object> input, out Dictionary<string, string> bindings, out string error)
        {
            bindings = new Dictionary<string, string>(StringComparer.Ordinal); error = null;
            if (input == null || input.Count > Targets.Length) { error = "Bindings must be a controller mapping object."; return false; }
            var used = new HashSet<string>(StringComparer.Ordinal);
            foreach (var entry in input) {
                var code = entry.Value as string;
                if (Array.IndexOf(Targets, entry.Key) < 0 || code == null || (code.Length != 0 && !Codes.Contains(code))) { error = "Unknown control or unsupported keyboard code: " + entry.Key; return false; }
                if (code.Length != 0 && !used.Add(code)) { error = "Each keyboard key can control only one input: " + code; return false; }
                bindings.Add(entry.Key, code);
            }
            return true;
        }
        internal static ControllerFrame Frame(Dictionary<string, string> bindings, HashSet<string> keys)
        {
            Func<string, bool> down = target => { string code; return bindings.TryGetValue(target, out code) && code.Length != 0 && keys.Contains(code); };
            var frame = new ControllerFrame();
            foreach (var button in Buttons) if (down(button.Key)) frame.Buttons |= button.Value;
            if ((frame.Buttons & 3) == 3) frame.Buttons &= 0xfffc;
            if ((frame.Buttons & 12) == 12) frame.Buttons &= 0xfff3;
            Stick(down, "left", out frame.LeftX, out frame.LeftY); Stick(down, "right", out frame.RightX, out frame.RightY);
            frame.LeftTrigger = down("lt") ? (byte)255 : (byte)0; frame.RightTrigger = down("rt") ? (byte)255 : (byte)0;
            return frame;
        }
        private static void Stick(Func<string, bool> down, string side, out short x, out short y)
        {
            int dx = (down(side + "Right") ? 1 : 0) - (down(side + "Left") ? 1 : 0), dy = (down(side + "Up") ? 1 : 0) - (down(side + "Down") ? 1 : 0);
            int scale = dx != 0 && dy != 0 ? 23169 : 32767; x = (short)(dx * scale); y = (short)(dy * scale);
        }
        internal static bool SystemShortcut(string code, bool alt, bool windows) { return windows || (alt && (code == "Tab" || code == "F4")); }
        internal static bool StreamWindow(string executable, string installed, string windowClass, string title) {
            const string suffix = " - Moonlight";
            return !string.IsNullOrEmpty(installed) && string.Equals(executable, installed, StringComparison.OrdinalIgnoreCase) && windowClass == "SDL_app" && title != null && title.Length > suffix.Length && title.EndsWith(suffix, StringComparison.Ordinal);
        }
        internal static string KeyCode(uint vk, uint scan, uint flags)
        {
            bool extended = (flags & 1) != 0;
            if (!extended && scan > 0) {
                const string top = "QWERTYUIOP", middle = "ASDFGHJKL", bottom = "ZXCVBNM";
                if (scan >= 0x10 && scan <= 0x19) return "Key" + top[(int)scan - 0x10];
                if (scan >= 0x1e && scan <= 0x26) return "Key" + middle[(int)scan - 0x1e];
                if (scan >= 0x2c && scan <= 0x32) return "Key" + bottom[(int)scan - 0x2c];
                if (scan >= 2 && scan <= 11) return "Digit" + ((scan - 1) % 10);
                switch (scan) {
                    case 0x47:return "Numpad7";case 0x48:return "Numpad8";case 0x49:return "Numpad9";
                    case 0x4b:return "Numpad4";case 0x4c:return "Numpad5";case 0x4d:return "Numpad6";
                    case 0x4f:return "Numpad1";case 0x50:return "Numpad2";case 0x51:return "Numpad3";case 0x52:return "Numpad0";case 0x53:return "NumpadDecimal";
                    case 0x0c:return "Minus";case 0x0d:return "Equal";case 0x1a:return "BracketLeft";case 0x1b:return "BracketRight";
                    case 0x27:return "Semicolon";case 0x28:return "Quote";case 0x29:return "Backquote";case 0x2b:return "Backslash";
                    case 0x33:return "Comma";case 0x34:return "Period";case 0x35:return "Slash";
                }
            }
            if (vk >= 0x41 && vk <= 0x5a) return "Key" + (char)vk;
            if (vk >= 0x30 && vk <= 0x39) return "Digit" + (char)vk;
            if (vk >= 0x60 && vk <= 0x69) return "Numpad" + (vk - 0x60);
            if (vk >= 0x70 && vk <= 0x7b) return "F" + (vk - 0x6f);
            switch (vk) {
                case 8:return "Backspace";case 9:return "Tab";case 13:return extended ? "NumpadEnter" : "Enter";
                case 16:return scan == 0x36 ? "ShiftRight" : "ShiftLeft";case 17:return extended ? "ControlRight" : "ControlLeft";case 18:return extended ? "AltRight" : "AltLeft";
                case 27:return "Escape";case 32:return "Space";case 33:return "PageUp";case 34:return "PageDown";case 35:return "End";case 36:return "Home";
                case 37:return "ArrowLeft";case 38:return "ArrowUp";case 39:return "ArrowRight";case 40:return "ArrowDown";case 45:return "Insert";case 46:return "Delete";
                case 0xa0:return "ShiftLeft";case 0xa1:return "ShiftRight";case 0xa2:return "ControlLeft";case 0xa3:return "ControlRight";case 0xa4:return "AltLeft";case 0xa5:return "AltRight";
                case 106:return "NumpadMultiply";case 107:return "NumpadAdd";case 109:return "NumpadSubtract";case 110:return "NumpadDecimal";case 111:return "NumpadDivide";
                case 0xba:return "Semicolon";case 0xbb:return "Equal";case 0xbc:return "Comma";case 0xbd:return "Minus";case 0xbe:return "Period";case 0xbf:return "Slash";
                case 0xc0:return "Backquote";case 0xdb:return "BracketLeft";case 0xdc:return "Backslash";case 0xdd:return "BracketRight";case 0xde:return "Quote";
                default:return null;
            }
        }
    }

    // Pure state shared by capture and regression checks. No synthetic key events are emitted.
    internal sealed class ControllerCaptureState
    {
        private readonly Dictionary<string, string> bindings;
        private readonly HashSet<string> mapped, pressed = new HashSet<string>(StringComparer.Ordinal), physical = new HashSet<string>(StringComparer.Ordinal);
        internal ControllerCaptureState(Dictionary<string, string> bindings) { this.bindings = bindings; mapped = new HashSet<string>(bindings.Values, StringComparer.Ordinal); mapped.Remove(""); }
        internal ControllerFrame Current { get { return ControllerMapping.Frame(bindings, pressed); } }
        internal void Focus(bool allowed) { if (!allowed) Release(); }
        internal void Release() { pressed.Clear(); }
        internal bool Key(string code, bool down, bool allowed) {
            if (!allowed) Release();
            if (code == null || !mapped.Contains(code)) return false;
            bool repeat = down && !physical.Add(code);
            if (!down) physical.Remove(code);
            if (!allowed) return false;
            // Clearing output on focus loss must survive keyboard auto-repeat.
            // A key already physically held needs an up/down cycle to resume.
            if (down && !repeat) pressed.Add(code); else if (!down) pressed.Remove(code); return true;
        }
    }

    internal sealed class VirtualGamepad : IDisposable
    {
        private ViGEmClient client;
        private IXbox360Controller target;
        internal VirtualGamepad() {
            try { client = new ViGEmClient(); target = client.CreateXbox360Controller(); target.AutoSubmitReport = false; target.Connect(); Submit(new ControllerFrame()); }
            catch { Dispose(); throw; }
        }
        internal static bool Probe(out string message) {
            try { using (var probe = new ViGEmClient()) { message = "ViGEmBus is ready. Escape stops keyboard mapping."; return true; } }
            catch (Exception e) { message = Describe(e); return false; }
        }
        internal static string Describe(Exception e) {
            var name = e.GetType().Name;
            if (name.IndexOf("NotFound", StringComparison.OrdinalIgnoreCase) >= 0 || e is DllNotFoundException) return "ViGEmBus or its client library is not installed. Keyboard mapping is unavailable.";
            if (e is BadImageFormatException) return "The ViGEm client architecture does not match this x64 app.";
            return "Virtual controller unavailable (" + name + "): " + e.Message;
        }
        internal void Submit(ControllerFrame f) {
            if (target == null) throw new ObjectDisposedException("VirtualGamepad");
            target.SetButtonsFull(f.Buttons);
            target.SetAxisValue(Xbox360Axis.LeftThumbX, f.LeftX); target.SetAxisValue(Xbox360Axis.LeftThumbY, f.LeftY);
            target.SetAxisValue(Xbox360Axis.RightThumbX, f.RightX); target.SetAxisValue(Xbox360Axis.RightThumbY, f.RightY);
            target.SetSliderValue(Xbox360Slider.LeftTrigger, f.LeftTrigger); target.SetSliderValue(Xbox360Slider.RightTrigger, f.RightTrigger); target.SubmitReport();
        }
        public void Dispose() {
            if (target != null) {
                try { Submit(new ControllerFrame()); } catch { /* Removed driver cannot receive the release report. */ }
                try { target.Disconnect(); } catch { /* Device may already have been removed. */ }
                target = null;
            }
            if (client != null) { client.Dispose(); client = null; }
        }
    }
}
