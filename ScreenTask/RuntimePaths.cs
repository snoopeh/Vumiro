using System;
using System.IO;

namespace ScreenTask
{
    internal static class RuntimePaths
    {
        internal static string Ffmpeg()
        {
            var bundled = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ffmpeg.exe");
            if (File.Exists(bundled)) return bundled;
            // Visual Studio starts bin/Debug or bin/Release. Reuse a packaged
            // runtime from this checkout rather than silently falling back to GDI.
            var directory = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
            for (var depth = 0; directory != null && depth < 5; depth++, directory = directory.Parent)
            {
                if (!File.Exists(Path.Combine(directory.FullName, "ScreenTask.sln"))) continue;
                foreach (var package in new[] { "published-1.11.1", "published-1.10.0", "release/ScreenTask-win-x64" })
                {
                    var candidate = Path.Combine(directory.FullName, "dist", package, "ffmpeg.exe");
                    if (File.Exists(candidate)) return candidate;
                }
                break;
            }
            return bundled;
        }
    }
}
