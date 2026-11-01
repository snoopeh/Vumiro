using System;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using ScreenTask;

class Program
{
    const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
    static int result = 1;
    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        var form = new frmMain();
        form.Load -= (EventHandler)Delegate.CreateDelegate(typeof(EventHandler), form, typeof(frmMain).GetMethod("frmMain_Load", Private));
        form.StartPosition = FormStartPosition.Manual; form.Location = new System.Drawing.Point(-20000, -20000); form.ShowInTaskbar = false;
        Set(form, "callUserDataFolder", Path.Combine(Path.GetTempPath(), "ScreenTask-call-ui-" + Guid.NewGuid().ToString("N")));
        ((TextBox)Get(form, "callSignalingInput")).Text = args.Length > 0 ? args[0] : "ws://localhost:17889/call-signaling";
        ((NumericUpDown)Get(form, "numShotEvery")).Value = 60;
        form.Shown += async (s, e) => {
            try
            {
                await (Task)typeof(frmMain).GetMethod("OpenCallAsync", Private).Invoke(form, null);
                var browser = (WebView2)Get(form, "callBrowser");
                if (browser == null || browser.CoreWebView2 == null) throw new Exception(((Label)Get(form, "callStatus")).Text);
                await Wait(browser, "typeof document.getElementById('join')?.onclick==='function' && typeof window.RTCPeerConnection==='function'");
                var capture = await browser.CoreWebView2.ExecuteScriptAsync("typeof navigator.mediaDevices?.getDisplayMedia");
                if (capture != "\"function\"") throw new Exception("Embedded secure call origin has no screen capture API: " + capture);
                await browser.CoreWebView2.ExecuteScriptAsync("document.getElementById('name').value='Embedded UI test'; document.getElementById('join').click();");
                await Wait(browser, "document.getElementById('join').disabled && !document.getElementById('share').disabled");
                await browser.CoreWebView2.ExecuteScriptAsync("navigator.mediaDevices.getDisplayMedia=async options=>{const c=document.createElement('canvas'); c.width=640;c.height=360;const x=c.getContext('2d');setInterval(()=>{x.fillStyle='navy';x.fillRect(0,0,640,360);x.fillStyle='white';x.fillText('Native call test '+Date.now(),20,40)},16);return c.captureStream(options.video.frameRate.ideal)};document.getElementById('share').click();");
                await Wait(browser, "!document.getElementById('stopShare').disabled");
                if (!(await browser.CoreWebView2.ExecuteScriptAsync("document.getElementById('captureInfo').textContent")).Contains("60 FPS requested")) throw new Exception("Native call ignored configured 60 FPS.");
                if (browser.Height < 300 || browser.Width < 600) throw new Exception("Embedded room has insufficient usable space.");
                var artifacts = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "call-ui.png");
                using (var file = File.Create(artifacts)) await browser.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, file);
                var listener = (System.Net.HttpListener)Get(form, "serv");
                if (listener.IsListening) throw new Exception("Joining a call must not start a local server.");
                await browser.CoreWebView2.ExecuteScriptAsync("document.getElementById('leave').click()");
                Console.WriteLine("PASS: native Call tab loads a secure embedded UI, joins and shares without starting its own server; " + artifacts);
                result = 0;
            }
            catch (Exception error) { Console.Error.WriteLine(error); }
            finally { form.Close(); }
        };
        Application.Run(form);
        return result;
    }
    static object Get(object target, string name) => target.GetType().GetField(name, Private).GetValue(target);
    static void Set(object target, string name, object value) => target.GetType().GetField(name, Private).SetValue(target, value);
    static async Task Wait(WebView2 browser, string condition)
    {
        var end = DateTime.UtcNow.AddSeconds(20);
        while (DateTime.UtcNow < end) { if (await browser.CoreWebView2.ExecuteScriptAsync("Boolean(" + condition + ")") == "true") return; await Task.Delay(100); }
        throw new Exception("Embedded UI timed out: " + condition + " | " + await browser.CoreWebView2.ExecuteScriptAsync("document.body.innerText"));
    }
}
