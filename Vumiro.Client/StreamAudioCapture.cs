using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;

namespace Vumiro.Client
{
    [ComVisible(true), Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IActivateAudioInterfaceCompletionHandlerCallback
    {
        [PreserveSig] int ActivateCompleted(IntPtr operation);
    }

    [ComVisible(true), Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IStreamAudioAgileObject { }

    /// <summary>
    /// Captures audio rendered by active processes on the default output device.
    /// Process-loopback inclusion is used per audio session so Vumiro's own
    /// WebView tree and (by default) Discord can be left out of the mix.
    /// </summary>
    internal sealed class StreamAudioCapture : IDisposable
    {
        private const int OutputRate = 48000;
        private const int OutputChannels = 2;
        private const int FramesPerBlock = 1920; // 40 ms at 48 kHz
        private const int MaximumSources = 24;
        private static readonly int OwnProcessId = Process.GetCurrentProcess().Id;
        private readonly object gate = new object();
        private readonly ManualResetEvent stopEvent = new ManualResetEvent(false);
        private Thread worker;
        private Action<float[]> onSamples;
        private Action<string> onError;
        private Action<string> onWarning;
        private bool started;
        private bool disposed;
        private int errorSent;
        private int stopSignaled;

        internal static bool IsSupported
        {
            get
            {
                try
                {
                    var version = new OSVERSIONINFOEX { Size = Marshal.SizeOf(typeof(OSVERSIONINFOEX)), CSDVersion = String.Empty };
                    return RtlGetVersion(ref version) == 0 && version.MajorVersion >= 10 && version.BuildNumber >= 20348;
                }
                catch { return false; }
            }
        }

        internal void Start(bool excludeDiscord, Action<float[]> sampleCallback, Action<string> errorCallback, Action<string> warningCallback = null)
        {
            if (sampleCallback == null) throw new ArgumentNullException("sampleCallback");
            lock (gate)
            {
                if (disposed) throw new ObjectDisposedException("StreamAudioCapture");
                if (started) return;
                if (!IsSupported) throw new PlatformNotSupportedException("Windows process audio capture requires Windows 10 build 20348 or newer.");
                started = true;
                onSamples = sampleCallback;
                onError = errorCallback;
                onWarning = warningCallback;
                worker = new Thread(() => Run(excludeDiscord)) { IsBackground = true, Name = "Vumiro system audio mixer" };
                worker.SetApartmentState(ApartmentState.MTA);
                try { worker.Start(); }
                catch { started = false; throw; }
            }
        }

        /// <summary>Signals capture workers to stop; it never waits on the UI thread.</summary>
        internal void Stop()
        {
            if (Interlocked.Exchange(ref stopSignaled, 1) != 0) return;
            try { stopEvent.Set(); }
            catch (ObjectDisposedException) { }
        }

        public void Dispose()
        {
            lock (gate)
            {
                if (disposed) return;
                disposed = true;
            }
            Stop();
            if (!started) stopEvent.Dispose();
        }

        private void Run(bool excludeDiscord)
        {
            var sources = new Dictionary<int, ProcessCaptureSource>();
            var clock = Stopwatch.StartNew();
            long nextEnumeration = 0;
            long nextMix = 0;
            var enumerationFailed = false;
            try
            {
                while (!stopEvent.WaitOne(0))
                {
                    var now = clock.ElapsedMilliseconds;
                    if (now >= nextEnumeration)
                    {
                        HashSet<int> desired;
                        if (TryEnumerateProcesses(() => EnumerateEligibleProcesses(excludeDiscord), SignalWarning, ref enumerationFailed, out desired))
                        {
                            if (desired.Count > MaximumSources)
                            {
                                SignalError("Too many active audio applications to capture safely.");
                                Stop();
                                break;
                            }
                            foreach (var pid in sources.Keys.Where(pid => !desired.Contains(pid)).ToArray())
                            {
                                sources[pid].Stop();
                                sources.Remove(pid);
                            }
                            foreach (var pid in desired)
                            {
                                if (sources.ContainsKey(pid)) continue;
                                if (sources.Count >= MaximumSources)
                                {
                                    SignalError("Too many active audio applications to capture safely.");
                                    Stop();
                                    break;
                                }
                                var source = new ProcessCaptureSource(pid, SignalWarning);
                                sources.Add(pid, source);
                                source.Start();
                            }
                        }
                        nextEnumeration = now + 1000;
                    }

                    if (now >= nextMix)
                    {
                        var block = new float[FramesPerBlock * OutputChannels];
                        foreach (var source in sources.Values)
                            source.MixInto(block, FramesPerBlock);
                        for (var i = 0; i < block.Length; i++)
                            block[i] = Math.Max(-1f, Math.Min(1f, block[i]));
                        try { onSamples?.Invoke(block); }
                        catch (Exception ex) { SignalError("The system audio callback failed: " + ex.Message); Stop(); }
                        nextMix += 40;
                        var afterMix = clock.ElapsedMilliseconds;
                        if (nextMix < afterMix - 100) nextMix = afterMix + 40;
                    }

                    var delay = (int)Math.Max(1, Math.Min(20, nextMix - clock.ElapsedMilliseconds));
                    stopEvent.WaitOne(delay);
                }
            }
            catch (Exception ex)
            {
                SignalError("System audio capture stopped: " + ex.Message);
            }
            finally
            {
                foreach (var source in sources.Values) source.Stop();
                stopEvent.Dispose();
            }
        }

        private void SignalError(string message)
        {
            if (Interlocked.Exchange(ref errorSent, 1) != 0) return;
            try { onError?.Invoke(message); }
            catch { }
            Stop();
        }

        private void SignalWarning(string message)
        {
            Trace.TraceWarning(message);
            try { onWarning?.Invoke(message); }
            catch { }
        }

        // An unavailable endpoint is not an empty session list. Leave the
        // current sources alone until a complete enumeration succeeds again.
        internal static bool TryEnumerateProcesses(Func<HashSet<int>> enumerate, Action<string> reportWarning, ref bool failed, out HashSet<int> desired)
        {
            try
            {
                desired = enumerate();
                failed = false;
                return true;
            }
            catch (Exception ex)
            {
                desired = null;
                if (!failed)
                    reportWarning("Audio device discovery is reconnecting (0x" + ex.HResult.ToString("X8") + "): " + ex.Message);
                failed = true;
                return false;
            }
        }

        // A device can disappear while a process keeps running (USB/Bluetooth,
        // driver reconfiguration). Retry only that source; the mixer and the
        // remaining applications must keep delivering audio.
        internal static void RunSourceWithRecovery(Func<bool> shouldStop, Action captureOnce, Action<string> reportWarning, Action<int> wait)
        {
            var failures = 0;
            while (!shouldStop())
            {
                try { captureOnce(); return; }
                catch (Exception ex)
                {
                    if (shouldStop()) return;
                    if (failures == 0)
                        reportWarning("Audio capture is reconnecting (0x" + ex.HResult.ToString("X8") + "): " + ex.Message);
                    failures = Math.Min(failures + 1, 5);
                    wait(failures * 1000);
                }
            }
        }

        private static HashSet<int> EnumerateEligibleProcesses(bool excludeDiscord)
        {
            var parents = ProcessTree.ReadParents();
            var names = new Dictionary<int, string>();
            foreach (var process in Process.GetProcesses())
            {
                try { names[process.Id] = process.ProcessName ?? String.Empty; }
                catch { }
                finally { process.Dispose(); }
            }

            var protectedIds = new HashSet<int>();
            foreach (var pair in names)
            {
                if (IsVumiroProcess(pair.Key, pair.Value) || (excludeDiscord && IsDiscordProcess(pair.Value)))
                {
                    var tree = ProcessTree.DescendantsAndAncestors(pair.Key, parents);
                    foreach (var id in tree) protectedIds.Add(id);
                }
            }

            var active = AudioSessions.GetActiveProcessIds();
            var candidates = new HashSet<int>();
            foreach (var pid in active)
            {
                if (pid <= 0 || !names.ContainsKey(pid)) continue;
                if (protectedIds.Contains(pid)) continue;
                if (ProcessTree.HasProtectedDescendant(pid, protectedIds, parents)) continue;
                candidates.Add(pid);
            }

            // Include-tree capture for an ancestor also includes a selected
            // descendant session. Keep only the highest eligible session PID.
            return new HashSet<int>(candidates.Where(pid => !candidates.Any(other => other != pid && ProcessTree.IsAncestor(other, pid, parents))));
        }

        private static bool IsDiscordProcess(string name)
        {
            return String.Equals(name, "Discord", StringComparison.OrdinalIgnoreCase) ||
                   String.Equals(name, "DiscordPTB", StringComparison.OrdinalIgnoreCase) ||
                   String.Equals(name, "DiscordCanary", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsVumiroProcess(int pid, string name)
        {
            return pid == OwnProcessId;
        }

        private sealed class ProcessCaptureSource
        {
            private readonly int processId;
            private readonly Action<string> onWarning;
            private readonly FloatRingBuffer ring = new FloatRingBuffer(OutputRate * OutputChannels / 5);
            private readonly float[] packetSamples = new float[OutputRate * OutputChannels];
            private readonly short[] packetPcm = new short[OutputRate * OutputChannels];
            private Thread thread;
            private volatile bool stop;

            internal ProcessCaptureSource(int processId, Action<string> onWarning)
            {
                this.processId = processId;
                this.onWarning = onWarning;
            }

            internal void Start()
            {
                thread = new Thread(CaptureLoop) { IsBackground = true, Name = "Vumiro process audio " + processId };
                thread.SetApartmentState(ApartmentState.MTA);
                thread.Start();
            }

            internal void Stop()
            {
                stop = true;
            }

            internal void MixInto(float[] destination, int frames)
            {
                ring.MixInto(destination, frames * OutputChannels);
            }

            private void CaptureLoop()
            {
                RunSourceWithRecovery(
                    () => stop || !IsProcessRunning(processId),
                    CaptureOnce,
                    warning => onWarning("Process " + processId + ": " + warning),
                    delay => {
                        for (var elapsed = 0; elapsed < delay && !stop; elapsed += 100)
                            Thread.Sleep(Math.Min(100, delay - elapsed));
                    });
            }

            private void CaptureOnce()
            {
                IAudioClient audioClient = null;
                IAudioCaptureClient captureClient = null;
                EventWaitHandle ready = null;
                var captureStarted = false;
                var comInitialized = false;
                try
                {
                    var co = CoInitializeEx(IntPtr.Zero, 0);
                    if (co < 0) Marshal.ThrowExceptionForHR(co);
                    comInitialized = true;
                    audioClient = ActivateProcessLoopback(processId);
                    var format = new WAVEFORMATEX { FormatTag = 1, Channels = OutputChannels, SamplesPerSec = OutputRate, BitsPerSample = 16, BlockAlign = OutputChannels * 2, AverageBytesPerSecond = OutputRate * OutputChannels * 2, ExtraSize = 0 };
                    var formatPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(WAVEFORMATEX)));
                    try
                    {
                        Marshal.StructureToPtr(format, formatPtr, false);
                        ready = new EventWaitHandle(false, EventResetMode.AutoReset);
                        const uint Loopback = 0x00020000;
                        const uint EventCallback = 0x00040000;
                        const uint AutoConvertPcm = 0x80000000;
                        const uint SourceDefaultQuality = 0x08000000;
                        Check(audioClient.Initialize(0, Loopback | EventCallback | AutoConvertPcm | SourceDefaultQuality, 0, 0, formatPtr, IntPtr.Zero));
                        Check(audioClient.SetEventHandle(ready.SafeWaitHandle.DangerousGetHandle()));
                        object service;
                        var iid = typeof(IAudioCaptureClient).GUID;
                        Check(audioClient.GetService(ref iid, out service));
                        captureClient = (IAudioCaptureClient)service;
                        Check(audioClient.Start());
                        captureStarted = true;
                        while (!stop)
                        {
                            ready.WaitOne(100);
                            Drain(captureClient);
                        }
                    }
                    finally { Marshal.FreeHGlobal(formatPtr); }
                }
                finally
                {
                    if (captureStarted)
                    {
                        try { audioClient.Stop(); }
                        catch { }
                    }
                    if (captureClient != null && Marshal.IsComObject(captureClient)) Marshal.ReleaseComObject(captureClient);
                    if (audioClient != null && Marshal.IsComObject(audioClient)) Marshal.ReleaseComObject(audioClient);
                    if (ready != null) ready.Dispose();
                    if (comInitialized) CoUninitialize();
                }
            }

            private void Drain(IAudioCaptureClient captureClient)
            {
                uint packetFrames;
                while (!stop)
                {
                    Check(captureClient.GetNextPacketSize(out packetFrames));
                    if (packetFrames == 0) return;
                    IntPtr data;
                    uint frames, flags;
                    ulong devicePosition, qpcPosition;
                    Check(captureClient.GetBuffer(out data, out frames, out flags, out devicePosition, out qpcPosition));
                    try
                    {
                        if (frames > OutputRate) throw new InvalidOperationException("An audio packet exceeded the safe buffer limit.");
                        var count = checked((int)frames * OutputChannels);
                        if ((flags & 2) == 0 && count > 0)
                        {
                            Marshal.Copy(data, packetPcm, 0, count);
                            for (var i = 0; i < count; i++) packetSamples[i] = packetPcm[i] / 32768f;
                        }
                        else if (count > 0) Array.Clear(packetSamples, 0, count);
                        ring.Write(packetSamples, count);
                    }
                    finally { Check(captureClient.ReleaseBuffer(frames)); }
                }
            }

            private static bool IsProcessRunning(int pid)
            {
                try { using (Process.GetProcessById(pid)) return true; }
                catch (ArgumentException) { return false; }
                catch (InvalidOperationException) { return false; }
            }

            private static IAudioClient ActivateProcessLoopback(int pid)
            {
                var parameters = new AUDIOCLIENT_ACTIVATION_PARAMS
                {
                    ActivationType = 1,
                    ProcessLoopbackMode = 0, // Include target process tree.
                    TargetProcessId = unchecked((uint)pid)
                };
                var bytes = Marshal.SizeOf(typeof(AUDIOCLIENT_ACTIVATION_PARAMS));
                var parameterMemory = Marshal.AllocHGlobal(bytes);
                var blobMemory = Marshal.AllocHGlobal(24);
                IActivateAudioInterfaceAsyncOperation operation = null;
                var callback = new ActivationCallback();
                var activationAccepted = false;
                var timedOut = false;
                try
                {
                    Marshal.StructureToPtr(parameters, parameterMemory, false);
                    Marshal.Copy(new byte[24], 0, blobMemory, 24);
                    Marshal.WriteInt16(blobMemory, 0, 0x0041); // VT_BLOB
                    Marshal.WriteInt32(blobMemory, 8, bytes);
                    Marshal.WriteIntPtr(blobMemory, 16, parameterMemory);
                    var iid = typeof(IAudioClient).GUID;
                    var activationHr = ActivateAudioInterfaceAsync("VAD\\Process_Loopback", ref iid, blobMemory, callback, out operation);
                    callback.Attach(operation, parameterMemory, blobMemory);
                    parameterMemory = IntPtr.Zero;
                    blobMemory = IntPtr.Zero;
                    if (activationHr < 0)
                    {
                        Marshal.ThrowExceptionForHR(activationHr);
                    }
                    activationAccepted = true;
                    if (!callback.Completed.WaitOne(10000))
                    {
                        timedOut = true;
                        callback.Abandon();
                        throw new TimeoutException("Windows did not complete process-loopback activation.");
                    }
                    if (callback.Result < 0) Marshal.ThrowExceptionForHR(callback.Result);
                    if (callback.AudioClient == null) throw new InvalidOperationException("Windows returned no process-loopback audio client.");
                    return callback.AudioClient;
                }
                finally
                {
                    if (blobMemory != IntPtr.Zero) Marshal.FreeHGlobal(blobMemory);
                    if (parameterMemory != IntPtr.Zero) Marshal.FreeHGlobal(parameterMemory);
                    if (!activationAccepted) callback.Cleanup();
                    else if (!timedOut)
                    {
                        if (callback.CompletedSignaled()) callback.Cleanup();
                        else callback.Abandon();
                    }
                }
            }
        }

        [ComVisible(true), ClassInterface(ClassInterfaceType.None), Guid("C6CF3D97-9B7E-4FE4-8D79-9841E9D8B2E7")]
        private sealed class ActivationCallback : IActivateAudioInterfaceCompletionHandlerCallback, IStreamAudioAgileObject
        {
            internal readonly ManualResetEvent Completed = new ManualResetEvent(false);
            internal int Result = unchecked((int)0x8000FFFF);
            internal IAudioClient AudioClient;
            private IActivateAudioInterfaceAsyncOperation operation;
            private IntPtr parameterMemory, blobMemory;
            private int abandoned, cleaned;

            internal void Attach(IActivateAudioInterfaceAsyncOperation asyncOperation, IntPtr parameters, IntPtr blob)
            {
                operation = asyncOperation;
                parameterMemory = parameters;
                blobMemory = blob;
                if (Volatile.Read(ref abandoned) != 0 && Completed.WaitOne(0)) Cleanup();
            }

            internal void Abandon()
            {
                Interlocked.Exchange(ref abandoned, 1);
                if (CompletedSignaled()) Cleanup();
            }

            internal bool CompletedSignaled()
            {
                try { return Completed.WaitOne(0); }
                catch (ObjectDisposedException) { return true; }
            }

            internal void Cleanup()
            {
                if (Interlocked.Exchange(ref cleaned, 1) != 0) return;
                if (blobMemory != IntPtr.Zero) Marshal.FreeHGlobal(blobMemory);
                if (parameterMemory != IntPtr.Zero) Marshal.FreeHGlobal(parameterMemory);
                blobMemory = parameterMemory = IntPtr.Zero;
                if (operation != null && Marshal.IsComObject(operation)) Marshal.ReleaseComObject(operation);
                operation = null;
                if (Volatile.Read(ref abandoned) != 0 && AudioClient != null && Marshal.IsComObject(AudioClient))
                    Marshal.ReleaseComObject(AudioClient);
                Completed.Dispose();
            }

            public int ActivateCompleted(IntPtr operationPointer)
            {
                try
                {
                    var operation = (IActivateAudioInterfaceAsyncOperation)Marshal.GetObjectForIUnknown(operationPointer);
                    try
                    {
                        object activated;
                        Check(operation.GetActivateResult(out Result, out activated));
                        if (Result >= 0) AudioClient = activated as IAudioClient;
                    }
                    finally
                    {
                        if (Marshal.IsComObject(operation)) Marshal.ReleaseComObject(operation);
                        GC.KeepAlive(operation);
                    }
                }
                catch (Exception ex) { Result = Marshal.GetHRForException(ex); }
                finally
                {
                    try { Completed.Set(); }
                    catch (ObjectDisposedException) { }
                    if (Volatile.Read(ref abandoned) != 0) Cleanup();
                }
                return 0;
            }
        }

        private sealed class FloatRingBuffer
        {
            private readonly object sync = new object();
            private readonly float[] data;
            private int head, count;
            internal FloatRingBuffer(int capacity) { data = new float[capacity]; }
            internal void Write(float[] source, int length)
            {
                lock (sync)
                {
                    if (length >= data.Length)
                    {
                        Array.Copy(source, length - data.Length, data, 0, data.Length);
                        head = 0; count = data.Length;
                        return;
                    }
                    var overflow = count + length - data.Length;
                    if (overflow > 0) { head = (head + overflow) % data.Length; count -= overflow; }
                    var tail = (head + count) % data.Length;
                    var first = Math.Min(length, data.Length - tail);
                    Array.Copy(source, 0, data, tail, first);
                    if (length > first) Array.Copy(source, first, data, 0, length - first);
                    count += length;
                }
            }
            internal void MixInto(float[] target, int length)
            {
                lock (sync)
                {
                    var take = Math.Min(length, count);
                    for (var i = 0; i < take; i++) target[i] += data[(head + i) % data.Length];
                    head = (head + take) % data.Length;
                    count -= take;
                }
            }
        }

        private static class ProcessTree
        {
            internal static Dictionary<int, int> ReadParents()
            {
                var result = new Dictionary<int, int>();
                var snapshot = CreateToolhelp32Snapshot(2, 0);
                if (snapshot == new IntPtr(-1)) throw new InvalidOperationException("Could not inspect the local process tree.");
                try
                {
                    var entry = new PROCESSENTRY32 { Size = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32)) };
                    if (Process32First(snapshot, ref entry))
                    {
                        do { result[(int)entry.ProcessId] = (int)entry.ParentProcessId; }
                        while (Process32Next(snapshot, ref entry));
                    }
                }
                finally { CloseHandle(snapshot); }
                return result;
            }

            internal static bool IsAncestor(int ancestor, int child, Dictionary<int, int> parents)
            {
                var seen = new HashSet<int>();
                var current = child;
                int parent;
                while (parents.TryGetValue(current, out parent) && seen.Add(parent))
                {
                    if (parent == ancestor) return true;
                    current = parent;
                }
                return false;
            }

            internal static IEnumerable<int> DescendantsAndAncestors(int pid, Dictionary<int, int> parents)
            {
                yield return pid;
                foreach (var id in parents.Keys)
                    if (IsAncestor(pid, id, parents) || IsAncestor(id, pid, parents)) yield return id;
            }

            internal static bool HasProtectedDescendant(int pid, HashSet<int> protectedIds, Dictionary<int, int> parents)
            {
                return protectedIds.Any(id => id == pid || IsAncestor(pid, id, parents));
            }
        }

        private static class AudioSessions
        {
            internal static HashSet<int> GetActiveProcessIds()
            {
                var result = new HashSet<int>();
                var initialized = false;
                IMMDeviceEnumerator enumerator = null;
                IMMDevice device = null;
                IAudioSessionManager2 manager = null;
                IAudioSessionEnumerator sessions = null;
                try
                {
                    var hr = CoInitializeEx(IntPtr.Zero, 0);
                    if (hr < 0) Marshal.ThrowExceptionForHR(hr);
                    initialized = hr >= 0;
                    enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
                    Check(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
                    var iid = typeof(IAudioSessionManager2).GUID;
                    object managerObject;
                    Check(device.Activate(ref iid, 23, IntPtr.Zero, out managerObject));
                    manager = (IAudioSessionManager2)managerObject;
                    Check(manager.GetSessionEnumerator(out sessions));
                    int count;
                    Check(sessions.GetCount(out count));
                    for (var i = 0; i < count; i++)
                    {
                        IAudioSessionControl baseControl = null;
                        try
                        {
                            Check(sessions.GetSession(i, out baseControl));
                            var control = (IAudioSessionControl2)baseControl;
                            int state;
                            Check(control.GetState(out state));
                            if (state != 1) continue;
                            uint pid;
                            Check(control.GetProcessId(out pid));
                            if (pid > 0 && pid <= Int32.MaxValue) result.Add((int)pid);
                        }
                        catch (COMException) { }
                        finally { Release(baseControl); }
                    }
                    return result;
                }
                finally
                {
                    Release(sessions); Release(manager); Release(device); Release(enumerator);
                    if (initialized) CoUninitialize();
                }
            }
        }

        private static void Release(object value)
        {
            if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value);
        }

        private static void Check(int hr)
        {
            if (hr < 0) Marshal.ThrowExceptionForHR(hr);
        }

        [DllImport("ntdll.dll")]
        private static extern int RtlGetVersion(ref OSVERSIONINFOEX version);
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct OSVERSIONINFOEX
        {
            internal int Size, MajorVersion, MinorVersion, BuildNumber, PlatformId;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] internal string CSDVersion;
            internal ushort ServicePackMajor, ServicePackMinor, SuiteMask;
            internal byte ProductType, Reserved;
        }

        [DllImport("ole32.dll")] private static extern int CoInitializeEx(IntPtr reserved, uint coInit);
        [DllImport("ole32.dll")] private static extern void CoUninitialize();
        [DllImport("mmdevapi.dll", ExactSpelling = true, CharSet = CharSet.Unicode, PreserveSig = true)]
        private static extern int ActivateAudioInterfaceAsync(string deviceInterfacePath, ref Guid riid, IntPtr activationParams, IActivateAudioInterfaceCompletionHandlerCallback completionHandler, out IActivateAudioInterfaceAsyncOperation activationOperation);

        [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] private class MMDeviceEnumerator { }
        [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMMDeviceEnumerator
        {
            [PreserveSig] int EnumAudioEndpoints(int dataFlow, uint stateMask, out IntPtr devices);
            [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
        }
        [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMMDevice
        {
            [PreserveSig] int Activate(ref Guid iid, uint clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object result);
        }
        [ComImport, Guid("BFA971F1-4D5E-40BB-935E-967039BFBEE4"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IAudioSessionManager
        {
            [PreserveSig] int GetAudioSessionControl(IntPtr sessionGuid, uint flags, out IntPtr control);
            [PreserveSig] int GetSimpleAudioVolume(IntPtr sessionGuid, uint flags, out IntPtr volume);
        }
        [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IAudioSessionManager2
        {
            [PreserveSig] int GetAudioSessionControl(IntPtr sessionGuid, uint flags, out IntPtr control);
            [PreserveSig] int GetSimpleAudioVolume(IntPtr sessionGuid, uint flags, out IntPtr volume);
            [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnumerator);
            [PreserveSig] int RegisterSessionNotification(IntPtr notification);
            [PreserveSig] int UnregisterSessionNotification(IntPtr notification);
            [PreserveSig] int RegisterDuckNotification([MarshalAs(UnmanagedType.LPWStr)] string sessionId, IntPtr notification);
            [PreserveSig] int UnregisterDuckNotification(IntPtr notification);
        }
        [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IAudioSessionEnumerator
        {
            [PreserveSig] int GetCount(out int count);
            [PreserveSig] int GetSession(int index, out IAudioSessionControl control);
        }
        [ComImport, Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IAudioSessionControl
        {
            [PreserveSig] int GetState(out int state);
            [PreserveSig] int GetDisplayName(out IntPtr name);
            [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid eventContext);
            [PreserveSig] int GetIconPath(out IntPtr path);
            [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid eventContext);
            [PreserveSig] int GetGroupingParam(out Guid groupingId);
            [PreserveSig] int SetGroupingParam(ref Guid groupingId, ref Guid eventContext);
            [PreserveSig] int RegisterAudioSessionNotification(IntPtr notification);
            [PreserveSig] int UnregisterAudioSessionNotification(IntPtr notification);
        }
        [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IAudioSessionControl2
        {
            [PreserveSig] int GetState(out int state);
            [PreserveSig] int GetDisplayName(out IntPtr name);
            [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid eventContext);
            [PreserveSig] int GetIconPath(out IntPtr path);
            [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid eventContext);
            [PreserveSig] int GetGroupingParam(out Guid groupingId);
            [PreserveSig] int SetGroupingParam(ref Guid groupingId, ref Guid eventContext);
            [PreserveSig] int RegisterAudioSessionNotification(IntPtr notification);
            [PreserveSig] int UnregisterAudioSessionNotification(IntPtr notification);
            [PreserveSig] int GetSessionIdentifier(out IntPtr id);
            [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr id);
            [PreserveSig] int GetProcessId(out uint processId);
            [PreserveSig] int IsSystemSoundsSession();
            [PreserveSig] int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
        }
        [ComImport, Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IAudioClient
        {
            [PreserveSig] int Initialize(int shareMode, uint flags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
            [PreserveSig] int GetBufferSize(out uint bufferFrames);
            [PreserveSig] int GetStreamLatency(out long latency);
            [PreserveSig] int GetCurrentPadding(out uint paddingFrames);
            [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closestMatch);
            [PreserveSig] int GetMixFormat(out IntPtr format);
            [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
            [PreserveSig] int Start();
            [PreserveSig] int Stop();
            [PreserveSig] int Reset();
            [PreserveSig] int SetEventHandle(IntPtr eventHandle);
            [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
        }
        [ComImport, Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IAudioCaptureClient
        {
            [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
            [PreserveSig] int ReleaseBuffer(uint frames);
            [PreserveSig] int GetNextPacketSize(out uint frames);
        }
        [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IActivateAudioInterfaceAsyncOperation
        {
            [PreserveSig] int GetActivateResult(out int activationResult, [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct AUDIOCLIENT_ACTIVATION_PARAMS
        {
            internal int ActivationType;
            internal uint TargetProcessId;
            internal int ProcessLoopbackMode;
        }
        [StructLayout(LayoutKind.Sequential, Pack = 2)]
        private struct WAVEFORMATEX
        {
            internal ushort FormatTag, Channels;
            internal uint SamplesPerSec, AverageBytesPerSecond;
            internal ushort BlockAlign, BitsPerSample, ExtraSize;
        }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct PROCESSENTRY32
        {
            internal uint Size, Usage, ProcessId;
            internal IntPtr DefaultHeapId;
            internal uint ModuleId, Threads, ParentProcessId;
            internal int BasePriority;
            internal uint Flags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] internal string ExecutableFile;
        }
        [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool Process32First(IntPtr snapshot, ref PROCESSENTRY32 entry);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool Process32Next(IntPtr snapshot, ref PROCESSENTRY32 entry);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
    }
}
