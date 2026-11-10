# Window controls and nickname copy

Date: 2026-11-10
Source: user screenshot of the Windows sign-in window and Priority 1A nickname-copy item.

## Observed behavior

The sign-in screenshot places Minimize, Maximize and Close directly after the app name at the upper left. The source uses a fixed `.authTitlebar` with `inset: 0 0 auto` and flex `space-between`, but gives the bar no explicit width or separate right alignment for its controls. A Chromium browser fixture stretches the bar correctly; the screenshot shows that the native result differs. The source and installed sign-in CSS declarations match. This leaves the precise platform layout trigger unconfirmed.

The selected friend's nickname is rendered as a button with a copy title, but has no click handler. The separate tag button copies, and the pencil opens editing.

## Design

- Anchor the sign-in title bar to the top, left and right edges with an explicit viewport width. Give the caption controls `margin-left: auto` so they remain at the far right if the bar's flex distribution changes. Keep the app name at the left, the existing native drag behavior, and distinct accessible buttons. The friends/settings title bars retain their existing full-width flow.
- Connect the selected friend's nickname button to the existing `copyFriendTag` action. The pencil remains an independent edit target. The copy action must report success or a clipboard failure using existing status feedback and must not open editing.

Windows title bar guidance places caption controls at the upper right for left-to-right layouts and keeps them visible as the window narrows: https://learn.microsoft.com/en-us/windows/apps/design/basics/titlebar-design

## Acceptance and checks

- In the real Windows LOCAL QA sign-in window, caption buttons are at the upper right at normal, maximized, and wide window sizes; the app name stays left. Buttons still minimize, maximize/restore and close, and the free area still drags the window.
- In the friends view, clicking or keyboard activating a selected friend's nickname copies that friend's tag. Activating the pencil edits instead. Clipboard rejection gives an understandable error.
- Focused client checks and the LOCAL QA launcher pass. Browser layout checks support the CSS behavior but do not substitute for the native visual check. Human QA remains the final gate.
