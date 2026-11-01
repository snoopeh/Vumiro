using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace ScreenTask
{
    // Room membership and WebRTC negotiation only. Media travels between peers.
    internal sealed class CallSignalingHub : IDisposable
    {
        private const int MaxMessageBytes = 64 * 1024;
        private readonly object _sync = new object();
        private readonly Dictionary<string, Room> _rooms = new Dictionary<string, Room>(StringComparer.Ordinal);
        private bool _disposed;

        public async Task HandleClientAsync(HttpListenerContext context)
        {
            var roomId = context.Request.QueryString["room"];
            if (!context.Request.IsWebSocketRequest || !SafeToken(roomId))
            {
                context.Response.StatusCode = 400;
                context.Response.Close();
                return;
            }
            var name = CleanName(context.Request.QueryString["name"]);
            Uri origin;
            if (!Uri.TryCreate(context.Request.Headers["Origin"], UriKind.Absolute, out origin) ||
                !((origin.Scheme == "http" || origin.Scheme == "https") && String.Equals(origin.Authority, context.Request.Url.Authority, StringComparison.OrdinalIgnoreCase) ||
                  origin.Scheme == "https" && origin.Host == "screentask.local" && origin.IsDefaultPort))
            { context.Response.StatusCode = 403; context.Response.Close(); return; }
            Peer peer = null;
            Room room = null;
            WebSocket socket = null;
            try
            {
                lock (_sync)
                {
                    if (_disposed)
                    {
                        context.Response.StatusCode = 503;
                        context.Response.Close();
                        return;
                    }
                }
                socket = (await context.AcceptWebSocketAsync(null).ConfigureAwait(false)).WebSocket;
                string rejection = null;
                lock (_sync)
                {
                    if (_disposed) rejection = "Calls are stopped.";
                    else if (!_rooms.TryGetValue(roomId, out room))
                    {
                        if (_rooms.Count >= 128) rejection = "There are too many active call rooms.";
                        else { room = new Room(); _rooms.Add(roomId, room); }
                    }
                    if (rejection == null && room.Peers.Count >= 8) rejection = "This call already has 8 participants.";
                    if (rejection == null)
                    {
                        peer = new Peer(socket, name);
                        // Every notification is enqueued while membership is
                        // serialized. No socket operation runs under this lock.
                        peer.Enqueue(Json(new { type = "welcome", id = peer.Id,
                            peers = room.Peers.Values.Select(p => new { id = p.Id, name = p.Name }).ToArray() }));
                        Broadcast(room, Json(new { type = "peer-joined", id = peer.Id, name = peer.Name }));
                        room.Peers.Add(peer.Id, peer);
                    }
                }
                if (rejection != null)
                {
                    await SendWithDeadlineAsync(socket, Json(new { type = "error", message = rejection })).ConfigureAwait(false);
                    // Give the final error frame a close handshake instead of
                    // immediately aborting HTTP.sys's outgoing buffer.
                    using (var closing = new CancellationTokenSource(1500))
                        await socket.CloseAsync(WebSocketCloseStatus.PolicyViolation, rejection, closing.Token).ConfigureAwait(false);
                    return;
                }
                peer.Start();
                var buffer = new byte[8192];
                while (socket.State == WebSocketState.Open)
                {
                    var text = await ReceiveTextAsync(socket, buffer).ConfigureAwait(false);
                    if (text == null) break;
                    string targetId;
                    Dictionary<string, object> signal;
                    if (!TrySignal(text, peer.Id, out targetId, out signal)) break;
                    lock (_sync)
                    {
                        Peer current, target;
                        // A reset removes this generation atomically. An old
                        // connection cannot signal participants of a new room.
                        if (room.Peers.TryGetValue(peer.Id, out current) && ReferenceEquals(current, peer) &&
                            room.Peers.TryGetValue(targetId, out target) && !ReferenceEquals(peer, target))
                            target.Enqueue(Json(signal));
                    }
                }
            }
            catch (Exception ex) when (ex is HttpListenerException || ex is WebSocketException ||
                ex is ObjectDisposedException || ex is InvalidOperationException || ex is IOException || ex is OperationCanceledException)
            {
                // Disconnects, malformed messages and slow receivers leave the
                // room through the same ordered membership cleanup below.
            }
            finally
            {
                if (peer != null)
                {
                    lock (_sync)
                    {
                        if (room.Peers.Remove(peer.Id))
                            Broadcast(room, Json(new { type = "peer-left", id = peer.Id }));
                        Room current;
                        if (room.Peers.Count == 0 && _rooms.TryGetValue(roomId, out current) && ReferenceEquals(current, room))
                            _rooms.Remove(roomId);
                    }
                    peer.Stop();
                    await peer.Sender.ConfigureAwait(false);
                }
                if (socket != null)
                {
                    try { socket.Abort(); } catch (ObjectDisposedException) { }
                    socket.Dispose();
                }
            }
        }

        private static byte[] Json(object value)
        {
            return Encoding.UTF8.GetBytes(new JavaScriptSerializer { MaxJsonLength = MaxMessageBytes, RecursionLimit = 16 }.Serialize(value));
        }

        private static bool SafeToken(string value)
        {
            return value != null && value.Length >= 16 && value.Length <= 128 && value.All(c =>
                c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-');
        }

        private static string CleanName(string value)
        {
            var name = new string((value ?? "").Where(c => !Char.IsControl(c)).ToArray()).Trim();
            if (name.Length > 48) name = name.Substring(0, Char.IsHighSurrogate(name[47]) ? 47 : 48);
            return name.Length == 0 ? "Guest" : name;
        }

        private static bool TrySignal(string text, string senderId, out string targetId, out Dictionary<string, object> signal)
        {
            targetId = null;
            signal = null;
            Dictionary<string, object> input;
            try
            {
                input = new JavaScriptSerializer { MaxJsonLength = MaxMessageBytes, RecursionLimit = 16 }
                    .DeserializeObject(text) as Dictionary<string, object>;
            }
            catch (Exception ex) when (ex is ArgumentException || ex is InvalidOperationException) { return false; }
            if (input == null || input.Keys.Any(k => k != "type" && k != "to" && k != "from" && k != "description" && k != "candidate")) return false;
            object type, to, description, candidate;
            if (!input.TryGetValue("type", out type) || !Object.Equals(type, "signal") ||
                !input.TryGetValue("to", out to) || !(to is string) || ((string)to).Length != 32) return false;
            targetId = (string)to;
            var hasDescription = input.TryGetValue("description", out description);
            var hasCandidate = input.TryGetValue("candidate", out candidate);
            if (hasDescription == hasCandidate) return false;
            signal = new Dictionary<string, object> { { "type", "signal" }, { "from", senderId } };
            if (hasDescription)
            {
                var sdp = description as Dictionary<string, object>;
                object sdpType, body;
                if (sdp == null || sdp.Count != 2 || !sdp.TryGetValue("type", out sdpType) ||
                    (!Object.Equals(sdpType, "offer") && !Object.Equals(sdpType, "answer")) ||
                    !sdp.TryGetValue("sdp", out body) || !(body is string) || ((string)body).Length > 60 * 1024) return false;
                signal.Add("description", new { type = (string)sdpType, sdp = (string)body });
            }
            else
            {
                var ice = candidate as Dictionary<string, object>;
                if (candidate != null)
                {
                    object iceText;
                    if (ice == null || !ice.TryGetValue("candidate", out iceText) || !(iceText is string) || ((string)iceText).Length > 8192) return false;
                    foreach (var field in ice)
                    {
                        if (field.Key == "candidate") continue;
                        if (field.Key == "sdpMid" || field.Key == "usernameFragment")
                        {
                            if (field.Value != null && (!(field.Value is string) || ((string)field.Value).Length > 256)) return false;
                        }
                        else if (field.Key == "sdpMLineIndex")
                        {
                            if (field.Value != null && (!(field.Value is int) || (int)field.Value < 0 || (int)field.Value > 65535)) return false;
                        }
                        else return false;
                    }
                }
                signal.Add("candidate", ice);
            }
            return true;
        }

        private static async Task<string> ReceiveTextAsync(WebSocket socket, byte[] buffer)
        {
            using (var message = new MemoryStream())
            {
                WebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None).ConfigureAwait(false);
                    if (result.MessageType == WebSocketMessageType.Close) return null;
                    if (result.MessageType != WebSocketMessageType.Text || message.Length + result.Count > MaxMessageBytes)
                        throw new IOException("Invalid call signaling message.");
                    message.Write(buffer, 0, result.Count);
                } while (!result.EndOfMessage);
                try { return new UTF8Encoding(false, true).GetString(message.ToArray()); }
                catch (DecoderFallbackException) { throw new IOException("Call signaling must be UTF-8 text."); }
            }
        }

        private static void Broadcast(Room room, byte[] message)
        {
            foreach (var peer in room.Peers.Values) peer.Enqueue(message);
        }

        private static async Task SendWithDeadlineAsync(WebSocket socket, byte[] message)
        {
            using (var deadlineCancellation = new CancellationTokenSource())
            {
                var send = socket.SendAsync(new ArraySegment<byte>(message), WebSocketMessageType.Text, true, deadlineCancellation.Token);
                var deadline = Task.Delay(3000, deadlineCancellation.Token);
                try
                {
                    if (await Task.WhenAny(send, deadline).ConfigureAwait(false) != send && !send.IsCompleted)
                    {
                        _ = send.ContinueWith(task => { var ignored = task.Exception; }, CancellationToken.None,
                            TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
                        socket.Abort();
                        throw new IOException("Call signaling receiver is too slow.");
                    }
                    await send.ConfigureAwait(false);
                }
                finally { deadlineCancellation.Cancel(); }
            }
        }

        public void Reset()
        {
            Peer[] peers;
            lock (_sync)
            {
                peers = _rooms.Values.SelectMany(r => r.Peers.Values).ToArray();
                foreach (var room in _rooms.Values) room.Peers.Clear();
                _rooms.Clear();
            }
            foreach (var peer in peers) peer.Stop();
        }

        public void Dispose()
        {
            lock (_sync) _disposed = true;
            Reset();
        }

        private sealed class Room
        {
            internal readonly Dictionary<string, Peer> Peers = new Dictionary<string, Peer>(StringComparer.Ordinal);
        }

        private sealed class Peer
        {
            internal readonly string Id = Guid.NewGuid().ToString("N");
            internal readonly string Name;
            private readonly WebSocket _socket;
            private readonly object _queueSync = new object();
            private readonly Queue<byte[]> _outbox = new Queue<byte[]>();
            private readonly SemaphoreSlim _available = new SemaphoreSlim(0);
            private int _queuedBytes;
            private bool _stopped;
            internal Task Sender = Task.CompletedTask;

            internal Peer(WebSocket socket, string name) { _socket = socket; Name = name; }
            internal void Start() { Sender = Task.Run(SendLoopAsync); }

            internal void Enqueue(byte[] message)
            {
                lock (_queueSync)
                {
                    if (_stopped) return;
                    if (_outbox.Count >= 32 || _queuedBytes + message.Length > 256 * 1024)
                    {
                        _stopped = true;
                        _outbox.Clear();
                        _queuedBytes = 0;
                    }
                    else { _outbox.Enqueue(message); _queuedBytes += message.Length; }
                    _available.Release();
                }
            }

            internal void Stop()
            {
                lock (_queueSync)
                {
                    if (!_stopped) { _stopped = true; _outbox.Clear(); _queuedBytes = 0; _available.Release(); }
                }
                try { _socket.Abort(); } catch (ObjectDisposedException) { }
            }

            private async Task SendLoopAsync()
            {
                try
                {
                    while (true)
                    {
                        await _available.WaitAsync().ConfigureAwait(false);
                        byte[] message;
                        lock (_queueSync)
                        {
                            if (_stopped) break;
                            message = _outbox.Dequeue();
                            _queuedBytes -= message.Length;
                        }
                        await SendWithDeadlineAsync(_socket, message).ConfigureAwait(false);
                    }
                }
                catch (Exception ex) when (ex is WebSocketException || ex is ObjectDisposedException ||
                    ex is InvalidOperationException || ex is IOException || ex is OperationCanceledException) { }
                finally { Stop(); }
            }
        }
    }
}
