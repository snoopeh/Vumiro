using System;
using System.IO;
using System.Media;
using System.Threading;
using Vumiro.Client;

// Run --tone in a sibling process, then run this executable with an output path.
// A child tone process is intentionally excluded by Vumiro's feedback protection.
internal static class Program
{
    private static int Main(string[] args)
    {
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
}
