using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using Microsoft.Web.WebView2.Core;

namespace Vumiro.Client
{
    internal sealed partial class ClientWindow
    {
        private readonly object streamAudioGate = new object();
        private StreamAudioCapture streamAudioCapture;
        private string streamAudioId;
        private float[] pendingStreamAudio;
        private long streamAudioSequence;
        private bool streamAudioAwaitingAck;
        private int streamAudioUiPending;
        private long streamAudioSentAt;

        private bool HandleStreamAudioMessage(Dictionary<string, object> message)
        {
            object type, actionValue, idValue;
            if (message == null || !message.TryGetValue("type", out type) || type as string != "stream-audio") return false;
            if (!message.TryGetValue("action", out actionValue) || !(actionValue is string)) return true;
            var action = (string)actionValue;
            if (action == "state" && message.Count == 2)
            {
                var supported = StreamAudioCapture.IsSupported;
                ClientDiagnostics.Current.Enqueue("native-audio-state", new Dictionary<string, object> { { "supported", supported } });
                PublishStreamAudio(new { type = "stream-audio", action = "state", supported, reason = supported ? null : "Excluding Discord requires Windows 11 or Windows build 20348 or newer. Use the sharing picker's audio option on this Windows version.", sampleRate = 48000, channels = 2 });
                return true;
            }
            if (!message.TryGetValue("id", out idValue) || !(idValue is string) || !Regex.IsMatch((string)idValue, "^[A-Za-z0-9_-]{16,64}$")) return true;
            var id = (string)idValue;
            if (action == "start" && message.Count == 4)
            {
                object excluded;
                if (!message.TryGetValue("excludeDiscord", out excluded) || !(excluded is bool)) return true;
                StopStreamAudio();
                if (!StreamAudioCapture.IsSupported)
                {
                    PublishStreamAudio(new { type = "stream-audio", action = "error", id, message = "Native stream audio requires Windows build 20348 or newer. Use the sharing picker's audio option on this Windows version." });
                    return true;
                }
                var capture = new StreamAudioCapture();
                lock (streamAudioGate) { streamAudioId = id; streamAudioCapture = capture; streamAudioSequence = 0; }
                try
                {
                    capture.Start((bool)excluded, samples => QueueStreamAudio(id, capture, samples), error => OnStreamAudioError(id, capture, error), warning => OnStreamAudioError(id, capture, warning, false));
                    ClientDiagnostics.Current.Enqueue("native-audio-started", new Dictionary<string, object> { { "excludeDiscord", (bool)excluded }, { "sampleRate", 48000 }, { "channels", 2 } });
                    PublishStreamAudio(new { type = "stream-audio", action = "started", id, sampleRate = 48000, channels = 2 });
                }
                catch (Exception error)
                {
                    ClientDiagnostics.Current.EnqueueException("native-audio-error", error);
                    StopStreamAudio();
                    PublishStreamAudio(new { type = "stream-audio", action = "error", id, message = "Could not start stream audio: " + error.Message });
                }
            }
            else if (action == "stop" && message.Count == 3)
            {
                lock (streamAudioGate) { if (streamAudioId != id) return true; }
                StopStreamAudio();
                PublishStreamAudio(new { type = "stream-audio", action = "stopped", id });
            }
            else if (action == "ack" && message.Count == 4)
            {
                object sequence;
                if (!message.TryGetValue("sequence", out sequence) || !(sequence is int || sequence is long)) return true;
                lock (streamAudioGate)
                {
                    if (streamAudioId != id || !streamAudioAwaitingAck || Convert.ToInt64(sequence) != streamAudioSequence) return true;
                    streamAudioAwaitingAck = false;
                }
                FlushStreamAudio();
            }
            return true;
        }

        private void PublishStreamAudio(object message)
        {
            if (IsDisposed || browser.CoreWebView2 == null) return;
            try { browser.CoreWebView2.PostWebMessageAsJson(json.Serialize(message)); }
            catch (InvalidOperationException) { /* The renderer is shutting down. */ }
            catch (COMException) { /* A failed renderer cannot receive capture state. */ }
        }

        private void QueueStreamAudio(string id, StreamAudioCapture capture, float[] samples)
        {
            lock (streamAudioGate)
            {
                if (streamAudioId != id || streamAudioCapture != capture || samples == null || samples.Length != 3840) return;
                pendingStreamAudio = samples;
            }
            if (Interlocked.Exchange(ref streamAudioUiPending, 1) != 0) return;
            try
            {
                BeginInvoke((Action)(() => {
                    Interlocked.Exchange(ref streamAudioUiPending, 0);
                    if (IsDisposed) return;
                    lock (streamAudioGate)
                    {
                        if (streamAudioId != id || streamAudioCapture != capture) return;
                        if (streamAudioAwaitingAck && Stopwatch.GetTimestamp() - streamAudioSentAt > Stopwatch.Frequency * 5)
                        {
                            StopStreamAudio();
                            PublishStreamAudio(new { type = "stream-audio", action = "error", id, message = "Stream audio stopped because the room is no longer receiving it." });
                            return;
                        }
                    }
                    FlushStreamAudio();
                }));
            }
            catch (InvalidOperationException) { Interlocked.Exchange(ref streamAudioUiPending, 0); }
        }

        private void FlushStreamAudio()
        {
            float[] samples;
            string id;
            long sequence;
            lock (streamAudioGate)
            {
                if (streamAudioId == null || streamAudioAwaitingAck || pendingStreamAudio == null || IsDisposed || browser.CoreWebView2 == null) return;
                samples = pendingStreamAudio; pendingStreamAudio = null;
                id = streamAudioId; sequence = ++streamAudioSequence;
                streamAudioAwaitingAck = true;
                streamAudioSentAt = Stopwatch.GetTimestamp();
            }
            try
            {
                var bytes = new byte[samples.Length * sizeof(float)];
                Buffer.BlockCopy(samples, 0, bytes, 0, bytes.Length);
                using (var buffer = browser.CoreWebView2.Environment.CreateSharedBuffer((ulong)bytes.Length))
                {
                    using (var output = buffer.OpenStream()) output.Write(bytes, 0, bytes.Length);
                    browser.CoreWebView2.PostSharedBufferToScript(buffer, CoreWebView2SharedBufferAccess.ReadOnly,
                        json.Serialize(new { type = "stream-audio", action = "samples", id, sequence, sampleRate = 48000, channels = 2, frames = 1920 }));
                }
            }
            catch (Exception error)
            {
                StopStreamAudio();
                PublishStreamAudio(new { type = "stream-audio", action = "error", id, message = "Stream audio stopped: " + error.Message });
            }
        }

        private void OnStreamAudioError(string id, StreamAudioCapture capture, string error, bool fatal = true)
        {
            var diagnostic = new Dictionary<string, object> { { "fatal", fatal } };
            var code = Regex.Match(error ?? "", "0x([0-9a-fA-F]{8})");
            if (code.Success) diagnostic["hresult"] = unchecked((int)Convert.ToUInt32(code.Groups[1].Value, 16));
            ClientDiagnostics.Current.Enqueue(fatal ? "native-audio-error" : "native-audio-warning", diagnostic);
            try
            {
                BeginInvoke((Action)(() => {
                    lock (streamAudioGate) { if (streamAudioId != id || streamAudioCapture != capture) return; }
                    if (fatal) StopStreamAudio();
                    PublishStreamAudio(new { type = "stream-audio", action = fatal ? "error" : "warning", id, message = error });
                }));
            }
            catch (InvalidOperationException) { /* The window is shutting down. */ }
        }

        private void StopStreamAudio()
        {
            StreamAudioCapture capture;
            lock (streamAudioGate)
            {
                capture = streamAudioCapture;
                streamAudioCapture = null; streamAudioId = null;
                pendingStreamAudio = null; streamAudioAwaitingAck = false;
            }
            if (capture != null) capture.Dispose();
        }
    }
}
