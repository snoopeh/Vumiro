# Xbox Series controller artwork

- Original artwork: Nicolae (Xelu) Berbece / Those Awesome Guys, free input prompts.
- SVG extraction and arrangement: Haaldor.
- License: CC0-1.0; original dedication is included as `LICENSE-CC0.txt`.
- Upstream repository: <https://github.com/haaldor/Xelu_prompts_SVG>.
- Pinned revision: `9b8c47f76882dc79f9c30e8bc6e10b337baf575e`.
- Source asset: [`Vector Source.svg`](https://github.com/haaldor/Xelu_prompts_SVG/blob/9b8c47f76882dc79f9c30e8bc6e10b337baf575e/Vector%20Source.svg).
- Extracted group: `Xbox_Series-69` in the `Xbox_Series` layer.
- Selected standalone SVG SHA-256: `4ca7fc6b119b89eb2616f89e26bfe14f15b3c34cc76808d8403d74fc00fd2995`.

`xelu-xbox-series.svg` preserves the eight original controller diagram paths and
their original painting. Its canvas and enclosing layout transform are adjusted
to make the selected diagram a standalone source asset. No unrelated prompts,
Steam Deck artwork, or upstream fonts are included.

`Vumiro.Client/WebServer/controller-art.js` inlines those controller paths for
offline use. Vumiro adds shell gradients, stick cap shading, subtle grip texture,
trigger/bumper labels, accessible hit targets, and selected/pressed feedback.
The source geometry is retained. Runtime IDs belonging to the source paths are
removed because they have no references, and Vumiro's paint definitions receive
unique IDs per diagram instance.

The module performs no downloads and embeds no raster images, scripts, external
references, fonts or animation. Mapping behavior remains Vumiro application code.
Xbox is a trademark of Microsoft. This depiction identifies the controller
layout and does not imply endorsement.
