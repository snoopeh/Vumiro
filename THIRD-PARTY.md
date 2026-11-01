# Third-party components

The standalone **local friends client** includes only the WebView2 SDK assemblies/loader and ScreenTask client assets; the FFmpeg, NAudio and self-contained runtime components described below apply to the legacy server package.

ScreenTask derives from [EslaMx7/ScreenTask](https://github.com/EslaMx7/ScreenTask), by Eslam Hamouda, under GPL-3.0-or-later. Original history and notices are preserved. See COPYING.

## FFmpeg

The portable package includes the unmodified **FFmpeg 9.0.2 essentials build** by Gyan Doshi, built with GPL/version3 enabled. FFmpeg runs as a separate executable. GPLv3 text is included as FFMPEG-LICENSE.txt and COPYING.

- Exact binary distribution and build information: https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2
- Build provider and dependency list: https://www.gyan.dev/ffmpeg/builds/
- Corresponding FFmpeg source revision linked by the build provider: https://github.com/FFmpeg/FFmpeg/tree/946fcce07b
- FFmpeg source archive: https://github.com/FFmpeg/FFmpeg/archive/946fcce07b.tar.gz
- Dependency source and licenses: https://github.com/GyanD/codexffmpeg (build provider), https://ffmpeg.org/legal.html
- Tested ffmpeg.exe SHA-256: `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec`

The build includes external libraries such as x264, x265 and zimg; their own notices/licenses apply. FFmpeg's `-version` and `-buildconf` report the exact configuration.

## .NET and audio

- [NAudio](https://github.com/naudio/NAudio): MIT; 2.2.1 in the desktop app and NAudio.Wasapi 3.0.1 in the audio helper. License: https://github.com/naudio/NAudio/blob/master/license.txt
- [Microsoft .NET](https://github.com/dotnet/runtime): MIT and third-party notices; the self-contained audio helper contains its runtime. License: https://github.com/dotnet/runtime/blob/main/LICENSE.TXT ; notices: https://github.com/dotnet/runtime/blob/main/THIRD-PARTY-NOTICES.TXT
- Microsoft System.Resources.Extensions, System.Memory, System.Buffers, System.Numerics.Vectors, System.Runtime.CompilerServices.Unsafe: MIT, https://github.com/dotnet/runtime . Exact dependency versions are pinned in the project files/NuGet resolution.
- [Bootstrap](https://github.com/twbs/bootstrap): MIT; the bundled stylesheet retains its license header.

NuGet packages retain their upstream license metadata. Build the project with `dotnet restore` to obtain original packages and their full notices.

## Embedded calls

The Call tab uses [Microsoft.Web.WebView2 1.0.4314.35](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4314.35) and its x64 loader under Microsoft's WebView2 SDK license, included in the NuGet package metadata. Microsoft Edge WebView2 Runtime is a separate prerequisite. Its native screen/audio picker still requires participant interaction.

## Sora font

Vumiro embeds the Sora Latin variable font from Google Fonts (https://fonts.google.com/specimen/Sora). The unmodified font is distributed under the following license.

Copyright 2019 The Sora Project Authors (https://github.com/sora-xor/sora-font)

This Font Software is licensed under the SIL Open Font License, Version 1.1.

This license is copied below, and is also available with a FAQ at: https://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
