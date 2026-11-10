using System;
using System.IO;
using System.Media;
using System.Threading;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using Vumiro.Client;

// Run --tone in a sibling process, then run this executable with an output path.
// A child tone process is intentionally excluded by Vumiro's feedback protection.
internal static class Program
{
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--self-test") return CheckSourceRecovery();
        if (args.Length == 1 && args[0] == "--tone")
        {
            using (var wave = new MemoryStream())
            using (var writer = new BinaryWriter(wave))
            {
                const int rate = 48000, samples = rate * 2;
                writer.Write(System.Text.Encoding.ASCII.GetBytes("RIFF")); writer.Write(36 + samples * 2);
                writer.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt ")); writer.Write(16);
                writer.Write((short)1); writer.Write((short)1); writer.Write(rate); writer.Write(rate * 2);
                writer.Write((short)2); writer.Write((short)16);
                writer.Write(System.Text.Encoding.ASCII.GetBytes("data")); writer.Write(samples * 2);
                for (var i = 0; i < samples; i++) writer.Write((short)(Math.Sin(i * 2 * Math.PI * 880 / rate) * 1600));
                writer.Flush(); wave.Position = 0;
                using (var player = new SoundPlayer(wave)) { player.PlayLooping(); Thread.Sleep(16000); player.Stop(); }
            }
            return 0;
        }
        if (args.Length != 1) throw new ArgumentException("Supply a float32 output path, or --tone.");
        Console.WriteLine("Process loopback supported: " + StreamAudioCapture.IsSupported);
        string error = null; var blocks = 0; double peak = 0, strongestTone = 0;
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(args[0])));
        using (var output = new BinaryWriter(File.Create(args[0])))
        using (var capture = new StreamAudioCapture())
        {
            capture.Start(true, samples => {
                double cosine = 0, sine = 0;
                for (var i = 0; i < samples.Length; i++) { output.Write(samples[i]); peak = Math.Max(peak, Math.Abs(samples[i])); }
                for (var frame = 0; frame < 1920; frame++)
                {
                    var sample = (samples[frame * 2] + samples[frame * 2 + 1]) / 2;
                    cosine += sample * Math.Cos(frame * 2 * Math.PI * 880 / 48000);
                    sine += sample * Math.Sin(frame * 2 * Math.PI * 880 / 48000);
                }
                strongestTone = Math.Max(strongestTone, Math.Sqrt(cosine * cosine + sine * sine) * 2 / 1920);
                blocks++;
            }, message => { error = message; });
            Thread.Sleep(8500);
            capture.Stop();
            // The capture worker owns the callback. Give its 20ms loop time to exit before closing the output.
            Thread.Sleep(200);
        }
        Console.WriteLine("Blocks=" + blocks + " peak=" + peak.ToString("F6") + " 880Hz amplitude=" + strongestTone.ToString("F6"));
        if (error != null) { Console.Error.WriteLine(error); return 1; }
        if (blocks < 100 || strongestTone < 0.002) { Console.Error.WriteLine("The expected 880Hz test tone was not captured."); return 2; }
        return 0;
    }

    private static int CheckSourceRecovery()
    {
        CheckSessionEnumerationRecovery();
        var attempts = 0;
        var stop = false;
        var messages = new List<string>();
        var waits = new List<int>();
        Action capture = () => {
            attempts++;
            if (attempts <= 7) throw new COMException("Device disconnected", unchecked((int)0x88890004));
            stop = true; // Capture can run normally after a device returns.
        };
        StreamAudioCapture.RunSourceWithRecovery(() => stop, capture, messages.Add, waits.Add);
        if (attempts != 8) throw new Exception("The source never recovered after the device returned.");
        if (messages.Count != 1 || !messages[0].Contains("0x88890004")) throw new Exception("Capture diagnostics must report the device HRESULT once per failure episode.");
        if (waits.Count != 7 || waits[0] < 1000 || waits[6] > 5000 || waits[6] < waits[0]) throw new Exception("Failed sources must back off with bounded retry delays.");

        stop = false; attempts = 0; waits.Clear(); messages.Clear();
        StreamAudioCapture.RunSourceWithRecovery(
            () => stop,
            () => { attempts++; stop = true; throw new COMException("Device stopped", unchecked((int)0x88890004)); },
            messages.Add, waits.Add);
        if (attempts != 1 || messages.Count != 0 || waits.Count != 0) throw new Exception("Stopping capture must cancel recovery without stale warnings or retries.");

        stop = true; attempts = 0;
        StreamAudioCapture.RunSourceWithRecovery(() => stop, () => attempts++, messages.Add, waits.Add);
        if (attempts != 0) throw new Exception("A stopped source must not activate audio hardware.");
        Console.WriteLine("Passed native audio source/session recovery, diagnostic and cancellation checks.");
        return 0;
    }

    private static void CheckSessionEnumerationRecovery()
    {
        var messages = new List<string>();
        var failed = false;
        var sources = new HashSet<int> { 11, 22 };
        Func<Func<HashSet<int>>, bool> refresh = read => {
            HashSet<int> desired;
            var success = StreamAudioCapture.TryEnumerateProcesses(read, messages.Add, ref failed, out desired);
            if (success) sources = desired;
            else if (desired != null) throw new Exception("Failed enumeration must be distinct from an empty session list.");
            return success;
        };
        Func<HashSet<int>> deviceRemoved = () => { throw new COMException("No default output endpoint", unchecked((int)0x80070490)); };
        if (refresh(deviceRemoved) || !sources.SetEquals(new[] { 11, 22 }) || !failed)
            throw new Exception("Endpoint removal discarded active capture sources.");
        if (refresh(deviceRemoved) || messages.Count != 1 || !messages[0].Contains("0x80070490"))
            throw new Exception("Repeated endpoint failures must report one actionable warning per outage.");
        if (!refresh(() => new HashSet<int>()) || sources.Count != 0 || failed)
            throw new Exception("A successfully empty session list must remove stale sources after recovery.");
        Func<HashSet<int>> serviceRestart = () => { throw new COMException("Audio service restarting", unchecked((int)0x88890010)); };
        if (refresh(serviceRestart) || messages.Count != 2 || !messages[1].Contains("0x88890010"))
            throw new Exception("A later audio service outage must start a new diagnostic episode.");
        if (!refresh(() => new HashSet<int> { 33 }) || !sources.SetEquals(new[] { 33 }) || failed)
            throw new Exception("Audio capture did not rediscover sessions after service recovery.");
    }
}
