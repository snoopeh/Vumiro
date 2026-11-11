using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace Vumiro.Client
{
    // The bridge accepts display data and an opaque ID only. Action authority stays in the current page.
    internal sealed class DesktopNotificationData
    {
        internal string Id, Category, SenderName, Body, Avatar;
        private static readonly Regex SafeId = new Regex(@"\A[A-Za-z0-9:_-]{1,128}\z", RegexOptions.CultureInvariant);
        private static readonly Regex SafeAvatar = new Regex(@"\Adata:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}\z", RegexOptions.CultureInvariant);
        internal static bool TryParse(object input, out DesktopNotificationData result)
        {
            result = null;
            var data = input as Dictionary<string, object>;
            if (data == null || data.Count != 5) return false;
            string id, category, senderName, body, avatar;
            if (!Text(data, "id", 128, out id) || !SafeId.IsMatch(id) || !Text(data, "category", 20, out category)
                || (category != "friend" && category != "roomInvite" && category != "call" && category != "roomActivity" && category != "message")
                || !Text(data, "senderName", 80, out senderName) || string.IsNullOrWhiteSpace(senderName)
                || !Text(data, "body", 320, out body) || string.IsNullOrWhiteSpace(body)
                || !Text(data, "avatar", 32768, out avatar) || (avatar.Length > 0 && !SafeAvatar.IsMatch(avatar))) return false;
            result = new DesktopNotificationData { Id = id, Category = category, SenderName = senderName, Body = body, Avatar = avatar };
            return true;
        }
        private static bool Text(Dictionary<string, object> data, string key, int maximum, out string text)
        {
            object value; text = null;
            if (!data.TryGetValue(key, out value) || !(value is string)) return false;
            text = (string)value; return text.Length <= maximum;
        }
        internal static Image DecodeAvatar(string value)
        {
            if (string.IsNullOrEmpty(value) || value.Length > 32768 || !SafeAvatar.IsMatch(value)) return null;
            try
            {
                var bytes = Convert.FromBase64String(value.Substring(value.IndexOf(',') + 1));
                // Check dimensions before invoking the image decoder; compressed peer content is untrusted.
                int width = 0, height = 0;
                if (value.StartsWith("data:image/png;", StringComparison.Ordinal) && bytes.Length >= 24
                    && bytes[0] == 137 && bytes[1] == 80 && bytes[2] == 78 && bytes[3] == 71)
                { width = BigEndian(bytes, 16); height = BigEndian(bytes, 20); }
                else if (value.StartsWith("data:image/jpeg;", StringComparison.Ordinal) && bytes.Length > 4 && bytes[0] == 255 && bytes[1] == 216)
                {
                    int cursor = 2;
                    while (cursor + 8 < bytes.Length)
                    {
                        if (bytes[cursor++] != 255) break;
                        while (cursor < bytes.Length && bytes[cursor] == 255) cursor++;
                        if (cursor + 3 >= bytes.Length) break;
                        int marker = bytes[cursor++];
                        int length = (bytes[cursor] << 8) | bytes[cursor + 1];
                        if (length < 2 || cursor + length > bytes.Length) break;
                        if (marker >= 192 && marker <= 207 && marker != 196 && marker != 200 && marker != 204)
                        { height = (bytes[cursor + 3] << 8) | bytes[cursor + 4]; width = (bytes[cursor + 5] << 8) | bytes[cursor + 6]; break; }
                        cursor += length;
                    }
                }
                // WebP is accepted by the bridge, but older GDI+ cannot decode it. The page sends a PNG when possible.
                if (width < 1 || height < 1 || width > 512 || height > 512) return null;
                using (var stream = new MemoryStream(bytes))
                using (var source = Image.FromStream(stream, false, true))
                {
                    if (source.Width > 512 || source.Height > 512) return null;
                    return new Bitmap(source, 48, 48);
                }
            }
            catch (ArgumentException) { return null; }
            catch (FormatException) { return null; }
            catch (OutOfMemoryException) { return null; }
            catch (System.Runtime.InteropServices.ExternalException) { return null; }
        }
        private static int BigEndian(byte[] bytes, int offset)
        { return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]; }
    }

    internal sealed class DesktopNotificationCenter : IDisposable
    {
        private readonly Form owner;
        private readonly Action<string> activate;
        private readonly List<DesktopNotificationPopup> popups = new List<DesktopNotificationPopup>();
        private readonly HashSet<string> seen = new HashSet<string>(StringComparer.Ordinal);
        private readonly Queue<string> order = new Queue<string>();
        private bool disposed;
        internal DesktopNotificationCenter(Form owner, Action<string> activate) { this.owner = owner; this.activate = activate; }
        internal void Show(DesktopNotificationData data)
        {
            if (disposed || owner.IsDisposed || data == null || !seen.Add(data.Id)) return;
            order.Enqueue(data.Id); while (order.Count > 256) seen.Remove(order.Dequeue());
            while (popups.Count >= 3) popups[0].Close();
            var popup = new DesktopNotificationPopup(data, () => { if (!disposed && !owner.IsDisposed) activate(data.Id); });
            popup.FormClosed += (sender, args) => { popups.Remove(popup); Arrange(); };
            popup.Shown += (sender, args) => Arrange();
            popups.Add(popup); Arrange(); popup.Show();
        }
        private void Arrange()
        {
            if (owner.IsDisposed) return;
            var area = Screen.FromRectangle(owner.WindowState == FormWindowState.Minimized ? owner.RestoreBounds : owner.Bounds).WorkingArea;
            int bottom = area.Bottom - 16;
            for (int index = popups.Count - 1; index >= 0; index--)
            {
                var popup = popups[index];
                popup.Location = new Point(Math.Max(area.Left, area.Right - popup.Width - 16), Math.Max(area.Top, bottom - popup.Height));
                bottom -= popup.Height + 10;
            }
        }
        public void Dispose() { disposed = true; foreach (var popup in popups.ToArray()) popup.Close(); popups.Clear(); seen.Clear(); order.Clear(); }
    }

    internal sealed class DesktopNotificationPopup : Form
    {
        private readonly DesktopNotificationData data;
        private readonly Action activate;
        private readonly Timer lifetime;
        private readonly Image avatar;
        private readonly Font senderFont = new Font("Segoe UI", 11, FontStyle.Bold);
        private readonly Font bodyFont = new Font("Segoe UI", 10);
        internal DesktopNotificationPopup(DesktopNotificationData data, Action activate)
        {
            this.data = data; this.activate = activate; avatar = DesktopNotificationData.DecodeAvatar(data.Avatar);
            Text = "Vumiro notification";
            AutoScaleMode = AutoScaleMode.Dpi; ClientSize = new Size(360, 112); FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual; ShowInTaskbar = false; TopMost = true; DoubleBuffered = true;
            BackColor = Color.FromArgb(26, 23, 24); ForeColor = Color.FromArgb(246, 240, 235); Cursor = Cursors.Hand;
            AccessibleName = data.SenderName + ": " + data.Body; AccessibleRole = AccessibleRole.Alert;
            lifetime = new Timer { Interval = data.Category == "call" ? 12000 : 7000 };
            lifetime.Tick += (sender, args) => Close(); Shown += (sender, args) => lifetime.Start();
        }
        protected override bool ShowWithoutActivation { get { return true; } }
        protected override CreateParams CreateParams { get { var value = base.CreateParams; value.ExStyle |= 0x08000000 | 0x00000080; return value; } }
        protected override void WndProc(ref Message message)
        {
            if (message.Msg == 0x0021) { message.Result = new IntPtr(3); return; } // MA_NOACTIVATE; click still reaches popup.
            base.WndProc(ref message);
        }
        protected override void OnMouseClick(MouseEventArgs e)
        {
            base.OnMouseClick(e); if (e.Button != MouseButtons.Left) return;
            bool dismiss = e.X >= ClientSize.Width - 34 && e.Y <= 34;
            Close(); if (!dismiss) activate();
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e); var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var outline = new Pen(Color.FromArgb(65, 60, 61))) g.DrawRectangle(outline, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1);
            using (var badge = new SolidBrush(Color.FromArgb(38, 33, 34))) g.FillEllipse(badge, 16, 24, 48, 48);
            if (avatar != null)
            {
                var before = g.Save(); using (var mask = new GraphicsPath()) { mask.AddEllipse(16, 24, 48, 48); g.SetClip(mask); g.DrawImage(avatar, 16, 24, 48, 48); } g.Restore(before);
            }
            else TextRenderer.DrawText(g, data.SenderName.Substring(0, 1).ToUpperInvariant(), senderFont, new Rectangle(16, 24, 48, 48), Color.White, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
            TextRenderer.DrawText(g, data.SenderName, senderFont, new Rectangle(78, 18, ClientSize.Width - 116, 25), ForeColor, TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix);
            TextRenderer.DrawText(g, data.Body, bodyFont, new Rectangle(78, 46, ClientSize.Width - 94, 56), Color.FromArgb(195, 188, 189), TextFormatFlags.WordBreak | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
            TextRenderer.DrawText(g, "×", bodyFont, new Rectangle(ClientSize.Width - 30, 8, 24, 24), Color.Silver, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
        }
        protected override void Dispose(bool disposing)
        {
            if (disposing) { lifetime.Dispose(); avatar?.Dispose(); senderFont.Dispose(); bodyFont.Dispose(); }
            base.Dispose(disposing);
        }
    }
}
